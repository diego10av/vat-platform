import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';

// GET /api/crm/forecast
//
// Weighted pipeline for the *current* calendar quarter — the sum of
// crm_opportunities.weighted_value_eur for open opps whose
// estimated_close_date falls between today's quarter start (inclusive)
// and the next quarter start (exclusive). Returns the number of opps
// and a human-readable quarter label ("Q2 2026") so the UI card
// doesn't have to recompute it.
//
// weighted_value_eur is a GENERATED column: estimated_value_eur *
// probability_pct / 100 (added in migration 031). We sum the stored
// column directly — no probability maths in application code.
export async function GET() {
  const row = await queryOne<{
    total: string;
    n: string;
    q_start: string;
    q_end: string;
  }>(
    `SELECT COALESCE(SUM(weighted_value_eur), 0)::text AS total,
            COUNT(*)::text AS n,
            date_trunc('quarter', CURRENT_DATE)::text AS q_start,
            (date_trunc('quarter', CURRENT_DATE) + INTERVAL '3 months')::text AS q_end
       FROM crm_opportunities
      WHERE deleted_at IS NULL
        AND stage NOT IN ('won', 'lost')
        AND estimated_close_date >= date_trunc('quarter', CURRENT_DATE)
        AND estimated_close_date <  date_trunc('quarter', CURRENT_DATE) + INTERVAL '3 months'`,
  );

  // Compose a "Q2 2026" label from the quarter start.
  const qStart = row?.q_start ? new Date(row.q_start) : new Date();
  const month = qStart.getMonth(); // 0-indexed
  const quarter = Math.floor(month / 3) + 1;
  const quarterLabel = `Q${quarter} ${qStart.getFullYear()}`;

  return NextResponse.json({
    weighted_total_eur: Number(row?.total ?? 0),
    opportunity_count: Number(row?.n ?? 0),
    quarter_label: quarterLabel,
    quarter_start: row?.q_start ?? null,
    quarter_end: row?.q_end ?? null,
  });
}
