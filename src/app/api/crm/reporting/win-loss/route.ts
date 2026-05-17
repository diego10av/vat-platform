import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

// ════════════════════════════════════════════════════════════════════════
// GET /api/crm/reporting/win-loss
//
// Stint 92 (post-CRM-audit). The CRM had captured loss_reason for a
// while + won_reason since stint 91 — but no widget surfaced the
// signal. This endpoint returns the YTD funnel snapshot the
// WinLossWidget renders:
//
//   - won_count / lost_count (this calendar year)
//   - win_rate_pct = won / (won + lost)
//   - avg_won_value_eur
//   - top_won_reason / top_loss_reason (most-cited bucket)
//   - top_source (where wins are coming from — actionable for biz dev)
//
// Rule §11 check: every number leads to a click — drilldown links are
// rendered client-side in WinLossWidget.
// ════════════════════════════════════════════════════════════════════════

interface Snapshot {
  year: number;
  won_count: number;
  lost_count: number;
  win_rate_pct: number | null;
  avg_won_value_eur: number | null;
  top_won_reason: string | null;
  top_loss_reason: string | null;
  top_won_source: string | null;
}

export async function GET() {
  const year = new Date().getUTCFullYear();
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year + 1}-01-01`;

  try {
    const [counts, avgWon, topWonReason, topLossReason, topWonSource] = await Promise.all([
      query<{ stage: string; n: number }>(
        `SELECT stage, COUNT(*)::int AS n
           FROM crm_opportunities
          WHERE stage IN ('won','lost')
            AND (actual_close_date >= $1 AND actual_close_date < $2
              OR (actual_close_date IS NULL AND stage_entered_at >= $1::timestamptz
                                          AND stage_entered_at < $2::timestamptz))
          GROUP BY stage`,
        [yearStart, yearEnd],
      ),
      query<{ avg: number | null }>(
        `SELECT AVG(estimated_value_eur)::numeric AS avg
           FROM crm_opportunities
          WHERE stage = 'won'
            AND (actual_close_date >= $1 AND actual_close_date < $2
              OR (actual_close_date IS NULL AND stage_entered_at >= $1::timestamptz
                                          AND stage_entered_at < $2::timestamptz))`,
        [yearStart, yearEnd],
      ),
      query<{ won_reason: string; n: number }>(
        `SELECT won_reason, COUNT(*)::int AS n
           FROM crm_opportunities
          WHERE stage = 'won'
            AND won_reason IS NOT NULL
            AND (actual_close_date >= $1 AND actual_close_date < $2
              OR (actual_close_date IS NULL AND stage_entered_at >= $1::timestamptz
                                          AND stage_entered_at < $2::timestamptz))
          GROUP BY won_reason ORDER BY n DESC LIMIT 1`,
        [yearStart, yearEnd],
      ),
      query<{ loss_reason: string; n: number }>(
        `SELECT loss_reason, COUNT(*)::int AS n
           FROM crm_opportunities
          WHERE stage = 'lost'
            AND loss_reason IS NOT NULL
            AND (actual_close_date >= $1 AND actual_close_date < $2
              OR (actual_close_date IS NULL AND stage_entered_at >= $1::timestamptz
                                          AND stage_entered_at < $2::timestamptz))
          GROUP BY loss_reason ORDER BY n DESC LIMIT 1`,
        [yearStart, yearEnd],
      ),
      query<{ source: string; n: number }>(
        `SELECT source, COUNT(*)::int AS n
           FROM crm_opportunities
          WHERE stage = 'won'
            AND source IS NOT NULL
            AND (actual_close_date >= $1 AND actual_close_date < $2
              OR (actual_close_date IS NULL AND stage_entered_at >= $1::timestamptz
                                          AND stage_entered_at < $2::timestamptz))
          GROUP BY source ORDER BY n DESC LIMIT 1`,
        [yearStart, yearEnd],
      ),
    ]);

    const wonCount = counts.find(r => r.stage === 'won')?.n ?? 0;
    const lostCount = counts.find(r => r.stage === 'lost')?.n ?? 0;
    const winRate = (wonCount + lostCount) === 0
      ? null
      : Math.round((wonCount / (wonCount + lostCount)) * 100);

    const snapshot: Snapshot = {
      year,
      won_count: wonCount,
      lost_count: lostCount,
      win_rate_pct: winRate,
      avg_won_value_eur: avgWon[0]?.avg != null ? Number(avgWon[0].avg) : null,
      top_won_reason: topWonReason[0]?.won_reason ?? null,
      top_loss_reason: topLossReason[0]?.loss_reason ?? null,
      top_won_source: topWonSource[0]?.source ?? null,
    };
    return NextResponse.json(snapshot);
  } catch {
    // Defensive: schema column missing in older deployments → empty payload.
    return NextResponse.json({
      year,
      won_count: 0,
      lost_count: 0,
      win_rate_pct: null,
      avg_won_value_eur: null,
      top_won_reason: null,
      top_loss_reason: null,
      top_won_source: null,
    } satisfies Snapshot);
  }
}
