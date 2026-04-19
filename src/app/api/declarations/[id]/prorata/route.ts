// ════════════════════════════════════════════════════════════════════════
// GET /api/declarations/[id]/prorata — compute pro-rata breakdown for
// this declaration's period.
//
// Joins the declaration → entity → entity_prorata, picks the overlapping
// row, sums the declaration's input VAT from invoice_lines, and returns
// the ready-to-render breakdown (deductible / non-deductible / formula).
//
// The UI panel on /declarations/[id] calls this endpoint. The audit-
// trail PDF can call the same function directly (see
// src/lib/prorata.ts).
// ════════════════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { apiError, apiOk, apiFail } from '@/lib/api-errors';
import {
  computeProrataBreakdown,
  pickProrataForPeriod,
  type ProrataRecord,
} from '@/lib/prorata';

function isSchemaMissing(err: unknown): boolean {
  const msg = (err as { message?: string } | null)?.message ?? '';
  return /relation ["']?entity_prorata["']? does not exist/i.test(msg);
}

function periodBoundsFromDeclaration(
  year: number,
  period: string,
): { start: string; end: string } {
  // Declarations carry period as 'M01'..'M12' (monthly), 'Q1'..'Q4', 'S1'/'S2'
  // (semestrial), or 'Y' (annual). Convert to ISO dates.
  const pad = (n: number) => String(n).padStart(2, '0');
  const last = (y: number, m: number) => new Date(y, m, 0).getDate();
  if (/^M(0[1-9]|1[0-2])$/.test(period)) {
    const m = Number(period.slice(1));
    return { start: `${year}-${pad(m)}-01`, end: `${year}-${pad(m)}-${pad(last(year, m))}` };
  }
  if (/^Q[1-4]$/.test(period)) {
    const q = Number(period.slice(1));
    const mStart = (q - 1) * 3 + 1;
    const mEnd = mStart + 2;
    return { start: `${year}-${pad(mStart)}-01`, end: `${year}-${pad(mEnd)}-${pad(last(year, mEnd))}` };
  }
  if (/^S[12]$/.test(period)) {
    const s = Number(period.slice(1));
    const mStart = s === 1 ? 1 : 7;
    const mEnd = s === 1 ? 6 : 12;
    return { start: `${year}-${pad(mStart)}-01`, end: `${year}-${pad(mEnd)}-${pad(last(year, mEnd))}` };
  }
  // Annual or unknown → full calendar year.
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const decl = await queryOne<{
      id: string;
      entity_id: string;
      year: number;
      period: string;
    }>(
      `SELECT id, entity_id, year, period FROM declarations WHERE id = $1`,
      [id],
    );
    if (!decl) return apiError('not_found', 'Declaration not found.', { status: 404 });

    const { start: periodStart, end: periodEnd } = periodBoundsFromDeclaration(decl.year, decl.period);

    // Sum the declaration's input VAT. We use the same signal the eCDF
    // generator uses: positive VAT on incoming lines where the
    // treatment is deductible. For simplicity we sum across every
    // incoming line's vat_applied — the reviewer can drill down if
    // needed. Keep this aligned with the eCDF box 093 computation.
    const sumRow = await queryOne<{ total: string | null }>(
      `SELECT SUM(CASE
                    WHEN il.direction = 'incoming' AND il.vat_applied IS NOT NULL
                    THEN il.vat_applied::numeric
                    ELSE 0
                  END)::text AS total
         FROM invoice_lines il
         JOIN invoices i ON il.invoice_id = i.id
        WHERE i.declaration_id = $1`,
      [id],
    );
    const totalInputVat = Number(sumRow?.total ?? 0) || 0;

    // Load entity_prorata rows and pick the overlapping one.
    let rows: ProrataRecord[] = [];
    try {
      rows = await query<ProrataRecord>(
        `SELECT id, entity_id,
                period_start::text AS period_start,
                period_end::text AS period_end,
                method,
                ratio_num::float8 AS ratio_num,
                ratio_denom::float8 AS ratio_denom,
                ratio_pct::float8 AS ratio_pct,
                basis, notes
           FROM entity_prorata
          WHERE entity_id = $1
          ORDER BY period_start DESC`,
        [decl.entity_id],
      );
    } catch (err) {
      if (isSchemaMissing(err)) {
        return apiOk({
          breakdown: computeProrataBreakdown(totalInputVat, null),
          record: null,
          period: { start: periodStart, end: periodEnd },
          total_input_vat_eur: totalInputVat,
          schema_missing: true,
        });
      }
      throw err;
    }

    const record = pickProrataForPeriod(rows, periodStart, periodEnd);
    const breakdown = computeProrataBreakdown(totalInputVat, record);

    return apiOk({
      breakdown,
      record,
      period: { start: periodStart, end: periodEnd },
      total_input_vat_eur: totalInputVat,
    });
  } catch (err) {
    return apiFail(err, 'declarations/prorata');
  }
}
