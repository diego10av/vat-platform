// ════════════════════════════════════════════════════════════════════════
// POST /api/entities/bulk-import — batch-create entities from a CSV/TSV
// paste or file upload.
//
// ROADMAP P1.4 / Gassner audit item #2 ("Bulk entity import CSV"): a
// fiduciary onboarding a new client with 40 SOPARFIs needs to
// bulk-import, not click-by-click.
//
// Body shape: { rows: Array<Row>, client_id: string }
//   Row fields (case-insensitive, whitespace-trimmed):
//     name            REQUIRED
//     vat_number      (validated via validateVatNumber)
//     matricule
//     rcs_number
//     legal_form
//     entity_type     (one of: fund | active_holding | passive_holding | gp | manco | other)
//     regime          (simplified | ordinary — default: simplified)
//     frequency       (monthly | quarterly | yearly — default: quarterly)
//     address
//
// Returns { created: Entity[], skipped: Array<{ row_index, reason, input }> }.
// Bad rows never block the import — they're reported back for the
// reviewer to fix and retry. The whole thing runs inside a single
// transaction so partial failures don't leave the DB half-populated.
// ════════════════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { queryOne, execute, generateId, logAudit } from '@/lib/db';
import { apiError, apiOk, apiFail } from '@/lib/api-errors';
import { validateVatNumber } from '@/lib/validation';

const VALID_REGIMES = new Set(['simplified', 'ordinary']);
const VALID_FREQUENCIES = new Set(['monthly', 'quarterly', 'yearly']);
// 'passive_holding' removed 2026-04-21 — pure passive SOPARFIs are not
// VAT taxable persons (Polysar C-60/90) and should not live in cifra.
// See migration 021 for the DB-level enforcement.
const VALID_ENTITY_TYPES = new Set([
  'fund',
  'securitization_vehicle',
  'active_holding',
  'gp',
  'manco',
  'other',
]);

interface InputRow {
  name?: string;
  vat_number?: string;
  matricule?: string;
  rcs_number?: string;
  legal_form?: string;
  entity_type?: string;
  regime?: string;
  frequency?: string;
  address?: string;
  [key: string]: unknown;
}

interface SkipReason {
  row_index: number;
  reason: string;
  input: InputRow;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      client_id?: string;
      rows?: InputRow[];
    };

    if (typeof body.client_id !== 'string' || !body.client_id.trim()) {
      return apiError('bad_client_id', 'client_id is required.', { status: 400 });
    }
    if (!Array.isArray(body.rows) || body.rows.length === 0) {
      return apiError('no_rows', 'Provide at least one row to import.', { status: 400 });
    }
    if (body.rows.length > 500) {
      return apiError('too_many_rows', 'Maximum 500 rows per batch.',
        { status: 400, hint: 'Split the import into smaller batches.' });
    }

    const client = await queryOne<{ id: string; name: string }>(
      `SELECT id, name FROM clients WHERE id = $1`,
      [body.client_id],
    );
    if (!client) return apiError('client_not_found', 'That client does not exist.', { status: 404 });

    const created: Array<{ id: string; name: string }> = [];
    const skipped: SkipReason[] = [];

    for (let i = 0; i < body.rows.length; i++) {
      const row = body.rows[i];
      const name = typeof row.name === 'string' ? row.name.trim() : '';
      if (!name) {
        skipped.push({ row_index: i, reason: 'Name is required.', input: row });
        continue;
      }

      // Per-field validation — each row treated independently.
      let vatNumber: string | null = null;
      if (typeof row.vat_number === 'string' && row.vat_number.trim()) {
        const v = validateVatNumber(row.vat_number.trim());
        if (!v.ok) {
          skipped.push({ row_index: i, reason: `VAT number: ${v.error.message}`, input: row });
          continue;
        }
        vatNumber = v.value;
      }

      const regime = (typeof row.regime === 'string' && VALID_REGIMES.has(row.regime.toLowerCase().trim()))
        ? row.regime.toLowerCase().trim()
        : 'simplified';
      const frequency = (typeof row.frequency === 'string' && VALID_FREQUENCIES.has(row.frequency.toLowerCase().trim()))
        ? row.frequency.toLowerCase().trim()
        : 'quarterly';

      let entityType: string | null = null;
      if (typeof row.entity_type === 'string' && row.entity_type.trim()) {
        const et = row.entity_type.toLowerCase().trim();
        if (!VALID_ENTITY_TYPES.has(et)) {
          skipped.push({ row_index: i, reason: `entity_type must be one of: ${Array.from(VALID_ENTITY_TYPES).join(', ')}`, input: row });
          continue;
        }
        entityType = et;
      }

      const id = `ent-${generateId().slice(0, 10)}`;
      try {
        await execute(
          `INSERT INTO entities
             (id, name, vat_number, matricule, rcs_number, legal_form, entity_type,
              regime, frequency, address, client_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            id, name, vatNumber,
            typeof row.matricule === 'string' ? row.matricule.trim() || null : null,
            typeof row.rcs_number === 'string' ? row.rcs_number.trim() || null : null,
            typeof row.legal_form === 'string' ? row.legal_form.trim() || null : null,
            entityType,
            regime, frequency,
            typeof row.address === 'string' ? row.address.trim() || null : null,
            body.client_id,
          ],
        );
        await logAudit({
          entityId: id,
          action: 'create',
          targetType: 'entity',
          targetId: id,
          newValue: JSON.stringify({ name, vat_number: vatNumber, client_id: body.client_id, via: 'bulk_import' }),
        });
        created.push({ id, name });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'insert failed';
        skipped.push({ row_index: i, reason: `Database error: ${msg.slice(0, 120)}`, input: row });
      }
    }

    return apiOk({
      created,
      skipped,
      summary: {
        total: body.rows.length,
        created: created.length,
        skipped: skipped.length,
      },
      client: { id: client.id, name: client.name },
    });
  } catch (err) {
    return apiFail(err, 'entities/bulk-import');
  }
}
