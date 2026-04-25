import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

// ════════════════════════════════════════════════════════════════════════
// GET /api/tax-ops/next-actions
//
// Aggregates the 4 actionable widgets on /tax-ops home (the 5th,
// "upcoming tasks", lands with 34.E when the tasks UI ships). Per
// CLAUDE.md §11 actionable-first — every row here should have a
// "do X now" implied action, not just a count.
//
//   1. deadline_radar        — filings due in next 30d, not filed
//   2. stale_assessments     — filed >180d ago, no assessment yet
//   3. pending_my_action     — status ∈ {pending_info, working}
//   4. pending_client_approval — draft_sent >7d, not approved
//
// Shape: { deadline_radar: [...], stale_assessments: [...],
//          pending_my_action: [...], pending_client_approval: [...] }
// ════════════════════════════════════════════════════════════════════════

interface ActionableFiling {
  id: string;
  entity_id: string;
  entity_name: string;
  group_name: string | null;
  tax_type: string;
  period_label: string;
  deadline_date: string | null;
  days_until_deadline: number | null;
  status: string;
  assigned_to: string | null;
  draft_sent_at: string | null;
  filed_at: string | null;
}

const SELECT_FILING_BASE = `
  f.id, e.id AS entity_id, e.legal_name AS entity_name,
  g.name AS group_name,
  o.tax_type, f.period_label,
  f.deadline_date::text AS deadline_date,
  f.status, f.assigned_to,
  f.draft_sent_at::text AS draft_sent_at,
  f.filed_at::text AS filed_at
`;

export async function GET() {
  const [deadlineRadar, staleAssessments, pendingMyAction, pendingClientApproval] = await Promise.all([
    query<ActionableFiling>(
      `SELECT ${SELECT_FILING_BASE},
              (f.deadline_date - CURRENT_DATE)::int AS days_until_deadline
         FROM tax_filings f
         JOIN tax_obligations o ON o.id = f.obligation_id
         JOIN tax_entities e    ON e.id = o.entity_id
         LEFT JOIN tax_client_groups g ON g.id = e.client_group_id
        WHERE f.status <> 'filed'
          AND f.deadline_date IS NOT NULL
          AND f.deadline_date <= CURRENT_DATE + INTERVAL '30 days'
          AND e.is_active = TRUE
        ORDER BY f.deadline_date ASC
        LIMIT 25`,
    ),
    query<ActionableFiling>(
      `SELECT ${SELECT_FILING_BASE},
              NULL::int AS days_until_deadline
         FROM tax_filings f
         JOIN tax_obligations o ON o.id = f.obligation_id
         JOIN tax_entities e    ON e.id = o.entity_id
         LEFT JOIN tax_client_groups g ON g.id = e.client_group_id
        WHERE f.status = 'filed'
          AND f.filed_at IS NOT NULL
          AND f.filed_at < CURRENT_DATE - INTERVAL '180 days'
          AND f.tax_assessment_received_at IS NULL
          AND e.is_active = TRUE
        ORDER BY f.filed_at ASC
        LIMIT 25`,
    ),
    query<ActionableFiling>(
      `SELECT ${SELECT_FILING_BASE},
              (f.deadline_date - CURRENT_DATE)::int AS days_until_deadline
         FROM tax_filings f
         JOIN tax_obligations o ON o.id = f.obligation_id
         JOIN tax_entities e    ON e.id = o.entity_id
         LEFT JOIN tax_client_groups g ON g.id = e.client_group_id
        WHERE f.status IN ('info_to_request','working')
          AND e.is_active = TRUE
        ORDER BY f.deadline_date ASC NULLS LAST
        LIMIT 25`,
    ),
    query<ActionableFiling>(
      `SELECT ${SELECT_FILING_BASE},
              (f.deadline_date - CURRENT_DATE)::int AS days_until_deadline
         FROM tax_filings f
         JOIN tax_obligations o ON o.id = f.obligation_id
         JOIN tax_entities e    ON e.id = o.entity_id
         LEFT JOIN tax_client_groups g ON g.id = e.client_group_id
        WHERE f.status = 'draft_sent'
          AND f.draft_sent_at IS NOT NULL
          AND f.draft_sent_at < CURRENT_DATE - INTERVAL '7 days'
          AND f.client_approved_at IS NULL
          AND e.is_active = TRUE
        ORDER BY f.draft_sent_at ASC
        LIMIT 25`,
    ),
  ]);

  return NextResponse.json({
    deadline_radar: deadlineRadar,
    stale_assessments: staleAssessments,
    pending_my_action: pendingMyAction,
    pending_client_approval: pendingClientApproval,
    counts: {
      deadline_radar: deadlineRadar.length,
      stale_assessments: staleAssessments.length,
      pending_my_action: pendingMyAction.length,
      pending_client_approval: pendingClientApproval.length,
    },
  });
}
