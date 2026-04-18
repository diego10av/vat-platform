// ════════════════════════════════════════════════════════════════════════
// POST /api/declarations/[id]/excel/import
//
// Phase 2 of the Excel ingestion flow. Receives the rows the reviewer
// confirmed in the preview step and inserts them as invoices +
// invoice_lines. No AI call — pure deterministic writes.
//
// Request:
//   { rows: Array<{
//       provider, provider_vat, country, invoice_number, invoice_date,
//       description, amount_eur, vat_rate, vat_applied,
//       direction, currency,
//     }> }
//
// Response:
//   { imported: number, errors: Array<{ idx, reason }>, invoice_ids: string[] }
//
// Guarantees:
//   - Atomic: either every valid row goes in, or none do (if a row
//     fails validation we skip it but record the error; the rest of
//     the batch still commits).
//   - Idempotency-friendly: every invoice gets a fresh generated id.
//     Rerunning the import creates duplicates (the reviewer is
//     expected to delete the original if re-importing).
//   - Each row becomes 1 invoice + 1 invoice_line. Extraction-source
//     set to 'excel_import' so downstream flows (classifier, reports)
//     can tell Excel rows from AI-extracted PDFs.
// ════════════════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { queryOne, execTx, tx, logAuditTx, generateId } from '@/lib/db';
import { apiError, apiOk, apiFail } from '@/lib/api-errors';
import { checkRateLimit } from '@/lib/rate-limit';

interface ImportRow {
  provider: string | null;
  provider_vat: string | null;
  country: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  description: string | null;
  amount_eur: number | null;
  vat_rate: number | null;
  vat_applied: number | null;
  direction: 'incoming' | 'outgoing' | null;
  currency: string | null;
}

const LOCKED_STATUSES = new Set(['approved', 'filed', 'paid']);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const rl = checkRateLimit(request, { max: 10, windowMs: 60_000, scope: 'excel/import' });
    if (!rl.ok) return rl.response;

    const { id: declarationId } = await params;
    const body = await request.json().catch(() => ({}));
    const rows = Array.isArray(body?.rows) ? (body.rows as ImportRow[]) : null;
    if (!rows || rows.length === 0) {
      return apiError('no_rows', 'Provide a non-empty `rows` array.', { status: 400 });
    }
    if (rows.length > 500) {
      return apiError('too_many_rows', 'Max 500 rows per import.', { status: 400 });
    }

    const decl = await queryOne<{ id: string; entity_id: string; status: string }>(
      `SELECT id, entity_id, status FROM declarations WHERE id = $1`,
      [declarationId],
    );
    if (!decl) return apiError('declaration_not_found', 'Declaration not found.', { status: 404 });
    if (LOCKED_STATUSES.has(decl.status)) {
      return apiError('declaration_locked',
        `Declaration is ${decl.status}. Reopen before importing.`,
        { hint: 'Move the declaration back to "review" status.', status: 409 });
    }

    const errors: Array<{ idx: number; reason: string }> = [];
    const invoiceIds: string[] = [];

    await tx(async (txSql) => {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        // Minimum viable invoice: must have provider + amount_eur.
        if (!row.provider || row.amount_eur == null) {
          errors.push({
            idx: i,
            reason: !row.provider ? 'missing provider' : 'missing amount_eur',
          });
          continue;
        }

        const invoiceId = generateId();
        const direction = row.direction || 'incoming';
        const currency = row.currency || 'EUR';
        const netAmount = row.amount_eur;
        const vatApplied = row.vat_applied ?? 0;
        const amountIncl = netAmount + vatApplied;

        await execTx(txSql,
          `INSERT INTO invoices (
             id, document_id, declaration_id,
             provider, provider_vat, country,
             invoice_number, invoice_date,
             direction,
             currency, currency_amount,
             total_ex_vat, total_vat, total_incl_vat,
             extraction_source)
           VALUES (
             $1, NULL, $2,
             $3, $4, $5,
             $6, $7,
             $8,
             $9, $10,
             $11, $12, $13,
             'excel_import')`,
          [
            invoiceId, declarationId,
            row.provider, row.provider_vat, row.country,
            row.invoice_number, row.invoice_date,
            direction,
            currency, currency === 'EUR' ? null : netAmount + vatApplied,
            netAmount, vatApplied, amountIncl,
          ],
        );

        await execTx(txSql,
          `INSERT INTO invoice_lines (
             id, invoice_id, declaration_id, description,
             amount_eur, vat_rate, vat_applied, rc_amount, amount_incl,
             sort_order, state)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9, 'extracted')`,
          [
            generateId(), invoiceId, declarationId,
            row.description ?? row.provider,
            netAmount, row.vat_rate, vatApplied, amountIncl,
            i,
          ],
        );

        await logAuditTx(txSql, {
          entityId: decl.entity_id,
          declarationId,
          action: 'import', targetType: 'invoice', targetId: invoiceId,
          field: 'source', oldValue: '', newValue: 'excel_import',
        });

        invoiceIds.push(invoiceId);
      }
    });

    return apiOk({
      imported: invoiceIds.length,
      errors,
      invoice_ids: invoiceIds,
    });
  } catch (err) {
    return apiFail(err, 'declaration/excel-import');
  }
}
