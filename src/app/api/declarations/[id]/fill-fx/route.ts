import { NextRequest, NextResponse } from 'next/server';
import { query, execute, logAudit, queryOne } from '@/lib/db';
import { fetchECBRate } from '@/lib/ecb';

// POST /api/declarations/[id]/fill-fx
// Iterates every line where currency != EUR and ecb_rate is null, fetches the
// ECB reference rate for the invoice_date, and updates ecb_rate + amount_eur.
//
// Idempotent: lines that already have an ecb_rate are not touched.
// Lines with no invoice_date or no currency_amount are skipped.
//
// Returns: { processed, updated, skipped, errors }
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const decl = await queryOne<{ entity_id: string }>(
    'SELECT entity_id FROM declarations WHERE id = $1',
    [id]
  );
  if (!decl) return NextResponse.json({ error: 'Declaration not found' }, { status: 404 });

  // Find candidate lines: non-EUR, no rate yet, has invoice_date and currency_amount.
  const rows = await query<{
    line_id: string; invoice_id: string; currency: string; invoice_date: string;
    currency_amount: number;
  }>(
    `SELECT il.id AS line_id, i.id AS invoice_id, i.currency,
            i.invoice_date, i.currency_amount::float AS currency_amount
       FROM invoice_lines il
       JOIN invoices i ON il.invoice_id = i.id
      WHERE il.declaration_id = $1
        AND il.state != 'deleted'
        AND i.currency IS NOT NULL
        AND UPPER(i.currency) != 'EUR'
        AND i.ecb_rate IS NULL
        AND i.invoice_date IS NOT NULL
        AND i.invoice_date ~ '^\\d{4}-\\d{2}-\\d{2}'
        AND i.currency_amount IS NOT NULL`,
    [id]
  );

  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];

  // Group by invoice (invoice-level fields are currency / ecb_rate)
  const byInvoice = new Map<string, { currency: string; date: string; lineIds: string[] }>();
  for (const r of rows) {
    const k = r.invoice_id;
    const entry = byInvoice.get(k) || { currency: r.currency, date: r.invoice_date, lineIds: [] };
    entry.lineIds.push(r.line_id);
    byInvoice.set(k, entry);
  }

  for (const [invoiceId, info] of byInvoice) {
    try {
      const rate = await fetchECBRate(info.currency, info.date);
      if (!rate || rate <= 0) { skipped += 1; continue; }

      // The previous implementation selected `invoice_lines.currency_amount`,
      // a column that doesn't exist on that table — every fill-fx run
      // errored out silently inside the try/catch and left ecb_rate unset.
      // When `needs_fx = true`, the extractor stores the ORIGINAL-currency
      // numbers in amount_eur / vat_applied / amount_incl (per the rewritten
      // extractor prompt). Converting those by dividing by the ECB rate
      // produces the EUR values.
      const lines = await query<{
        id: string; amount_eur: number | null; vat_applied: number | null; amount_incl: number | null;
      }>(
        `SELECT id,
                amount_eur::float AS amount_eur,
                vat_applied::float AS vat_applied,
                amount_incl::float AS amount_incl
           FROM invoice_lines
          WHERE invoice_id = $1 AND state != 'deleted'`,
        [invoiceId]
      );
      for (const l of lines) {
        await execute(
          `UPDATE invoice_lines
              SET amount_eur = $1,
                  vat_applied = $2,
                  amount_incl = $3,
                  updated_at = NOW()
            WHERE id = $4`,
          [
            l.amount_eur != null ? l.amount_eur / rate : null,
            l.vat_applied != null ? l.vat_applied / rate : null,
            l.amount_incl != null ? l.amount_incl / rate : null,
            l.id,
          ]
        );
      }

      // Also convert the invoice-header totals so the review UI shows EUR
      // figures consistent with the lines. needs_fx is cleared because the
      // conversion is now done.
      await execute(
        `UPDATE invoices
            SET ecb_rate = $1,
                total_ex_vat   = CASE WHEN total_ex_vat   IS NULL THEN NULL ELSE total_ex_vat::float / $1 END,
                total_vat      = CASE WHEN total_vat      IS NULL THEN NULL ELSE total_vat::float / $1 END,
                total_incl_vat = CASE WHEN total_incl_vat IS NULL THEN NULL ELSE total_incl_vat::float / $1 END,
                needs_fx = FALSE
          WHERE id = $2`,
        [rate, invoiceId]
      );
      await logAudit({
        entityId: decl.entity_id,
        declarationId: id,
        action: 'update',
        targetType: 'invoice',
        targetId: invoiceId,
        field: 'ecb_rate',
        oldValue: '',
        newValue: `${info.currency} on ${info.date} = ${rate} (line amounts + header totals converted to EUR)`,
      });
      updated += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${info.currency}/${info.date}: ${msg}`);
    }
  }

  return NextResponse.json({
    processed: byInvoice.size,
    updated,
    skipped,
    errors,
  });
}
