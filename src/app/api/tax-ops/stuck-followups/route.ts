import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

// ════════════════════════════════════════════════════════════════════════
// GET /api/tax-ops/stuck-followups
//
// Lists filings whose status is "waiting on the client" and whose
// last_action_at puts them past the amber (7d) or red (14d) threshold.
// Used by /tax-ops home StuckFollowUpsWidget for counts + click-through.
//
// Single source of truth for "what does stuck mean": same waiting-states
// tables as the front-end follow-up.ts.
// ════════════════════════════════════════════════════════════════════════

const PROVISION_WAITING_STATES = ['awaiting_fs', 'sent'];
const FILING_WAITING_STATES = [
  'info_to_request',
  'info_requested',
  'draft_sent',
  'awaiting_client_clarification',
];

const AMBER_DAYS = 7;
const RED_DAYS = 14;

export interface StuckRow {
  filing_id: string;
  obligation_id: string;
  entity_id: string;
  entity_name: string;
  group_name: string | null;
  tax_type: string;
  service_kind: string;
  period_label: string;
  status: string;
  last_action_at: string;
  days_stuck: number;
  tone: 'amber' | 'red';
}

export async function GET() {
  const rows = await query<StuckRow>(
    `SELECT f.id  AS filing_id,
            f.obligation_id,
            e.id  AS entity_id,
            e.legal_name AS entity_name,
            g.name       AS group_name,
            o.tax_type,
            o.service_kind,
            f.period_label,
            f.status,
            f.last_action_at::text AS last_action_at,
            (CURRENT_DATE - f.last_action_at)::int AS days_stuck,
            CASE
              WHEN (CURRENT_DATE - f.last_action_at) >= $1 THEN 'red'
              ELSE 'amber'
            END AS tone
       FROM tax_filings f
       JOIN tax_obligations o ON o.id = f.obligation_id
       JOIN tax_entities    e ON e.id = o.entity_id
       LEFT JOIN tax_client_groups g ON g.id = e.client_group_id
      WHERE o.is_active = TRUE
        AND e.is_active = TRUE
        AND f.last_action_at IS NOT NULL
        AND (CURRENT_DATE - f.last_action_at) >= $2
        AND (
          (o.service_kind = 'provision' AND f.status = ANY($3::text[]))
          OR
          (o.service_kind = 'review'    AND f.status = ANY($4::text[]))
        )
      ORDER BY (CURRENT_DATE - f.last_action_at) DESC, e.legal_name ASC
      LIMIT 200`,
    [RED_DAYS, AMBER_DAYS, PROVISION_WAITING_STATES, FILING_WAITING_STATES],
  );

  const summary = {
    total: rows.length,
    red:   rows.filter(r => r.tone === 'red').length,
    amber: rows.filter(r => r.tone === 'amber').length,
    oldest_days: rows[0]?.days_stuck ?? 0,
  };

  return NextResponse.json({ summary, items: rows });
}
