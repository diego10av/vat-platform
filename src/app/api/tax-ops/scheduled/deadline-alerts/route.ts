import { NextResponse } from 'next/server';
import { query, execute, generateId, logAudit } from '@/lib/db';

// ════════════════════════════════════════════════════════════════════════
// POST /api/tax-ops/scheduled/deadline-alerts
//
// Daily cron (07:00 CET via scheduled-tasks MCP) that creates an
// auto-task for every filing whose deadline falls inside a 14 / 7 /
// 3-day window, AND for every filing that's gone past its deadline
// without being filed/paid/waived.
//
// Idempotency: tax_filings.last_alert_sent_at + last_alert_kind track
// the most recent alert emitted for a given filing. A new alert is
// only created when the filing moves into a stricter window than it
// was last alerted at, or when it becomes overdue. That way running
// the cron twice in the same day doesn't spam tasks, and escalation
// flows (14d → 7d → 3d → overdue) always fire.
//
// Each alert becomes a tax_ops_tasks row with:
//   - auto_generated = TRUE
//   - priority = urgent (overdue) | high (3d) | medium (7d) | low (14d)
//   - related_filing_id = <filing_id>
//   - tags = ['deadline_alert', 'kind:<kind>']
//   - title = "[kind] {entity} — {tax_type} {period}"
// ════════════════════════════════════════════════════════════════════════

type AlertKind = '14d' | '7d' | '3d' | 'overdue';

interface Candidate {
  id: string;
  entity_name: string;
  tax_type: string;
  period_label: string;
  deadline_date: string;  // ISO date
  days_until: number;
  assigned_to: string | null;
  last_alert_kind: string | null;
}

// Escalation ranks: higher = more urgent. We only create a new alert
// when the current kind rank strictly exceeds the last one sent.
const KIND_RANK: Record<AlertKind, number> = {
  '14d': 1, '7d': 2, '3d': 3, overdue: 4,
};

const KIND_PRIORITY: Record<AlertKind, string> = {
  '14d': 'low', '7d': 'medium', '3d': 'high', overdue: 'urgent',
};

function kindFor(daysUntil: number): AlertKind | null {
  if (daysUntil < 0) return 'overdue';
  if (daysUntil <= 3) return '3d';
  if (daysUntil <= 7) return '7d';
  if (daysUntil <= 14) return '14d';
  return null;
}

function humanTaxType(t: string): string {
  return t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export async function POST() {
  const candidates = await query<Candidate>(
    `SELECT f.id,
            e.legal_name AS entity_name,
            o.tax_type,
            f.period_label,
            f.deadline_date::text AS deadline_date,
            (f.deadline_date - CURRENT_DATE)::int AS days_until,
            f.assigned_to,
            f.last_alert_kind
       FROM tax_filings f
       JOIN tax_obligations o ON o.id = f.obligation_id
       JOIN tax_entities e    ON e.id = o.entity_id
      WHERE f.deadline_date IS NOT NULL
        AND f.status NOT IN ('filed','paid','waived','assessment_received')
        AND e.is_active = TRUE
        AND o.is_active = TRUE
        AND (f.deadline_date - CURRENT_DATE)::int <= 14`,
  );

  let created = 0;
  const createdTasks: Array<{ task_id: string; filing_id: string; kind: AlertKind }> = [];

  for (const c of candidates) {
    const kind = kindFor(c.days_until);
    if (!kind) continue;

    const lastRank = c.last_alert_kind && c.last_alert_kind in KIND_RANK
      ? KIND_RANK[c.last_alert_kind as AlertKind]
      : 0;
    const thisRank = KIND_RANK[kind];
    if (thisRank <= lastRank) continue;  // already alerted at ≥ this level

    // Skip creating duplicate alerts for the same filing even if the cron
    // runs twice — the task would carry a unique-ish tag.
    const existingAlert = await query<{ id: string }>(
      `SELECT id FROM tax_ops_tasks
        WHERE related_filing_id = $1
          AND auto_generated = TRUE
          AND 'deadline_alert' = ANY(tags)
          AND ('kind:' || $2) = ANY(tags)
          AND status NOT IN ('done','cancelled')`,
      [c.id, kind],
    );
    if (existingAlert.length > 0) continue;

    const taskId = generateId();
    const title = kind === 'overdue'
      ? `OVERDUE: ${c.entity_name} — ${humanTaxType(c.tax_type)} ${c.period_label}`
      : `Deadline in ${kind}: ${c.entity_name} — ${humanTaxType(c.tax_type)} ${c.period_label}`;

    await execute(
      `INSERT INTO tax_ops_tasks
         (id, title, description, status, priority,
          due_date, tags, related_filing_id, assignee,
          auto_generated, created_by)
       VALUES ($1, $2, $3, 'queued', $4, $5, $6, $7, $8, TRUE, 'deadline_alerts_cron')`,
      [
        taskId,
        title,
        `Auto-generated reminder. Deadline: ${c.deadline_date} (${c.days_until}d).`,
        KIND_PRIORITY[kind],
        c.deadline_date,
        ['deadline_alert', `kind:${kind}`, `tax_type:${c.tax_type}`],
        c.id,
        c.assigned_to,
      ],
    );

    await execute(
      `UPDATE tax_filings
          SET last_alert_sent_at = NOW(),
              last_alert_kind    = $1,
              updated_at         = NOW()
        WHERE id = $2`,
      [kind, c.id],
    );

    createdTasks.push({ task_id: taskId, filing_id: c.id, kind });
    created += 1;
  }

  await logAudit({
    userId: 'system',
    action: 'tax_deadline_alerts_cron',
    targetType: 'tax_filings',
    targetId: `batch_${new Date().toISOString().slice(0, 10)}`,
    newValue: JSON.stringify({ candidates: candidates.length, created }),
  });

  return NextResponse.json({
    candidates: candidates.length,
    created,
    tasks: createdTasks,
  });
}
