import { NextRequest, NextResponse } from 'next/server';
import { query, execute, generateId, logAudit } from '@/lib/db';

// ════════════════════════════════════════════════════════════════════════
// GET /api/cron/stuck-followups — stint 64.L Layer 3
//
// Creates a CRM task for every filing that has been "stuck waiting on
// the client" for ≥ 14 days (red threshold) and doesn't already have
// an open auto-generated task. Idempotent: re-running it on the same
// day creates zero rows.
//
// Triggered by Vercel Cron (see vercel.json) once a day at 07:00 CET
// so Diego's morning brief reflects an up-to-date task list. Manual
// runs are accepted but require the same Bearer token.
//
// Auth: requires `Authorization: Bearer <CRON_SECRET>` matching the
// CRON_SECRET env var. Vercel cron auto-injects this header. If the
// env var is unset (e.g. during local development) the endpoint is
// disabled and returns 503 — fail-closed by design.
//
// Lifecycle of a task once created:
//   • Diego completes it → status='done', completed_at=NOW.
//     The next stuck-followup pass skips this row for 7 days
//     (cooldown after manual completion). After 7 days, if the
//     filing is still red, a fresh task is created.
//   • Diego progresses the filing out of a waiting state → the
//     filings PATCH endpoint marks the related auto-task as done
//     (with completed_by='auto-resolver'). See stint 64.L (3/3)
//     in src/app/api/tax-ops/filings/[id]/route.ts.
// ════════════════════════════════════════════════════════════════════════

const PROVISION_WAITING_STATES = ['awaiting_fs', 'sent'];
const FILING_WAITING_STATES = [
  'info_to_request',
  'info_requested',
  'draft_sent',
  'awaiting_client_clarification',
];
const RED_DAYS = 14;
const COOLDOWN_DAYS_AFTER_MANUAL_COMPLETE = 7;

function authorised(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const got = request.headers.get('authorization');
  return got === `Bearer ${expected}`;
}

interface StuckCandidate {
  filing_id: string;
  entity_name: string;
  group_name: string | null;
  tax_type: string;
  service_kind: string;
  period_label: string;
  status: string;
  days_stuck: number;
}

export async function GET(request: NextRequest) {
  if (!authorised(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Find every filing that is stuck red AND doesn't already have an
  // open auto-generated task (or one completed within the cooldown
  // window). The NOT EXISTS clause is the idempotency guarantee.
  const candidates = await query<StuckCandidate>(
    `SELECT f.id  AS filing_id,
            e.legal_name AS entity_name,
            g.name       AS group_name,
            o.tax_type,
            o.service_kind,
            f.period_label,
            f.status,
            (CURRENT_DATE - f.last_action_at)::int AS days_stuck
       FROM tax_filings f
       JOIN tax_obligations o ON o.id = f.obligation_id
       JOIN tax_entities    e ON e.id = o.entity_id
       LEFT JOIN tax_client_groups g ON g.id = e.client_group_id
      WHERE o.is_active = TRUE
        AND e.is_active = TRUE
        AND f.last_action_at IS NOT NULL
        AND (CURRENT_DATE - f.last_action_at) >= $1
        AND (
          (o.service_kind = 'provision' AND f.status = ANY($2::text[]))
          OR
          (o.service_kind = 'review'    AND f.status = ANY($3::text[]))
        )
        AND NOT EXISTS (
          SELECT 1 FROM crm_tasks t
           WHERE t.related_type = 'tax_filing'
             AND t.related_id   = f.id
             AND t.auto_generated = TRUE
             AND (
               t.status IN ('open', 'in_progress', 'snoozed')
               OR (t.completed_at IS NOT NULL
                   AND t.completed_at > NOW() - ($4 || ' days')::interval)
             )
        )`,
    [
      RED_DAYS,
      PROVISION_WAITING_STATES,
      FILING_WAITING_STATES,
      String(COOLDOWN_DAYS_AFTER_MANUAL_COMPLETE),
    ],
  );

  const created: Array<{ task_id: string; filing_id: string; title: string }> = [];

  for (const c of candidates) {
    const id = generateId();
    const taxKindLabel = describeTaxKind(c.tax_type, c.service_kind);
    const title = `Follow up: ${c.entity_name} — ${taxKindLabel} ${c.period_label} stuck ${c.days_stuck}d`;
    const description = stuckTaskDescription(c);
    await execute(
      `INSERT INTO crm_tasks
         (id, title, description, status, priority,
          related_type, related_id, auto_generated, created_by, updated_at)
       VALUES ($1, $2, $3, 'open', 'high',
               'tax_filing', $4, TRUE, 'cifra-cron', NOW())`,
      [id, title, description, c.filing_id],
    );
    created.push({ task_id: id, filing_id: c.filing_id, title });
  }

  if (created.length > 0) {
    await logAudit({
      userId: 'cifra-cron',
      action: 'stuck_followup_tasks_created',
      targetType: 'crm_task',
      targetId: created.map(c => c.task_id).join(','),
      newValue: JSON.stringify({ count: created.length, filings: created.map(c => c.filing_id) }),
      reason: 'Daily stuck-follow-up pass',
    });
  }

  return NextResponse.json({
    candidates_evaluated: candidates.length,
    tasks_created: created.length,
    tasks: created,
  });
}

function describeTaxKind(taxType: string, serviceKind: string): string {
  // Render labels that match the column names on /tax-ops/cit so a
  // task title like "CIT Provision 2026" is unambiguous next to the
  // matrix.
  if (serviceKind === 'provision') {
    if (taxType === 'cit_annual') return 'CIT Provision';
    if (taxType === 'nwt_annual') return 'NWT Provision';
    return 'Provision';
  }
  if (serviceKind === 'review') {
    if (taxType === 'nwt_annual') return 'NWT Review';
    return 'Review';
  }
  return taxType.replace(/_/g, ' ');
}

function stuckTaskDescription(c: StuckCandidate): string {
  const lines: string[] = [];
  lines.push(`Filing has been in status "${c.status}" without a status change for ${c.days_stuck} days.`);
  if (c.group_name) lines.push(`Family: ${c.group_name}`);
  lines.push('');
  lines.push('Suggested next step: send a follow-up email to the client. Once you do, update the matrix cell or this task — both will close together.');
  return lines.join('\n');
}
