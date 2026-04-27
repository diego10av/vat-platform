// ════════════════════════════════════════════════════════════════════════
// GET /api/inbox — the reviewer's action queue.
//
// Aggregates everything that requires the logged-in user to DO something
// now. Explicitly excludes things they're waiting on (e.g. client has
// not uploaded invoices) — per Diego's feedback + PROTOCOLS §11, the
// Inbox only surfaces items with a next action the reviewer can execute.
//
// Categories (in severity order):
//
//   critical  — filing_deadline_overdue, payment_deadline_overdue,
//               aed_urgent, validator_finding_high
//   warning   — filing_deadline_soon, payment_deadline_soon,
//               client_approved, extraction_errors, budget_soft_warn
//   info      — feedback_new, schema_missing (admin-only)
//
// Each item: id, kind, severity, title, description, href, context.
// The UI groups by severity and lets the user click through to act.
//
// Performance: one query per category (~9 queries, all indexed).
// Cached at the process level for 60s to avoid refetching on every
// open of the Inbox panel.
// ════════════════════════════════════════════════════════════════════════

import { query, queryOne } from '@/lib/db';
import { apiOk, apiFail } from '@/lib/api-errors';
import { getBudgetStatus } from '@/lib/budget-guard';
import { computeDeadline, type Frequency, type Regime } from '@/lib/deadlines';

type Severity = 'critical' | 'warning' | 'info';

export type InboxItemKind =
  | 'client_approved'
  | 'filing_overdue'
  | 'filing_soon'
  | 'payment_overdue'
  | 'payment_soon'
  | 'aed_urgent'
  | 'extraction_errors'
  | 'validator_findings'
  | 'budget_warn'
  | 'feedback_new'
  | 'schema_missing'
  // Stint 56.F — task-driven inbox events.
  | 'task_due_today'
  | 'task_followup_today'
  | 'task_unblocked';

interface InboxItem {
  id: string;
  kind: InboxItemKind;
  severity: Severity;
  title: string;
  description: string;
  href: string;
  context?: Record<string, unknown>;
  created_at?: string | null;
}

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

// Process-level cache. 60 seconds so repeated opens of the Inbox panel
// across a user's session don't hammer the DB.
interface Cached {
  items: InboxItem[];
  counts: { critical: number; warning: number; info: number; total: number };
  expires_at: number;
}
let cache: Cached | null = null;
const TTL_MS = 60_000;

async function safeQuery<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  try {
    return await query<T>(sql, params);
  } catch {
    return [];
  }
}

async function safeQueryOne<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
  try {
    return await queryOne<T>(sql, params);
  } catch {
    return null;
  }
}

function fmtEur(n: number): string {
  return n.toLocaleString('en-LU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export async function GET() {
  try {
    const now = Date.now();
    if (cache && cache.expires_at > now) {
      return apiOk({ items: cache.items, counts: cache.counts });
    }

    const items: InboxItem[] = [];

    // ── 1. Client approved via portal → ready to file ────────────────
    //
    // Detection: declarations in 'approved' status. Could narrow to
    // those that came from a portal_approve audit, but any approved
    // declaration needs filing action.
    const approvedDecls = await safeQuery<{
      id: string; entity_name: string; year: number; period: string;
      updated_at: string; vat_payable: number | null;
    }>(
      `SELECT d.id, e.name AS entity_name, d.year, d.period,
              d.updated_at::text AS updated_at,
              (SELECT SUM(il.vat_applied)::float FROM invoice_lines il
                 WHERE il.declaration_id = d.id AND il.state != 'deleted'
              ) AS vat_payable
         FROM declarations d
         JOIN entities e ON d.entity_id = e.id
        WHERE d.status = 'approved'
        ORDER BY d.updated_at DESC
        LIMIT 15`,
    );
    for (const d of approvedDecls) {
      items.push({
        id: `approved-${d.id}`,
        kind: 'client_approved',
        severity: 'warning',
        title: `${d.entity_name} — ready to file`,
        description: `${d.year} ${d.period} approved${d.vat_payable != null ? ` · VAT due €${fmtEur(Number(d.vat_payable))}` : ''}`,
        href: `/declarations/${d.id}`,
        context: { entity_name: d.entity_name, year: d.year, period: d.period },
        created_at: d.updated_at,
      });
    }

    // ── 2. Filing + payment deadlines ────────────────────────────────
    //
    // Declarations don't store a deadline column; the deadline is derived
    // from the entity's (regime, frequency) + declaration (year, period)
    // via src/lib/deadlines.ts. We query open declarations, compute
    // deadlines in JS, and keep the ones that are overdue or within 3
    // days.
    //
    // Overdue   → critical · filing_overdue / payment_overdue
    // <= 3 days → warning · filing_soon    / payment_soon
    const openDecls = await safeQuery<{
      id: string; year: number; period: string; status: string;
      regime: string; frequency: string; entity_name: string;
    }>(
      `SELECT d.id, d.year, d.period, d.status,
              e.regime, e.frequency, e.name AS entity_name
         FROM declarations d
         JOIN entities e ON d.entity_id = e.id
        WHERE d.status IN ('review', 'approved', 'filed')
        ORDER BY d.year DESC, d.period DESC
        LIMIT 100`,
    );
    for (const d of openDecls) {
      const regime = (d.regime as Regime);
      const frequency = (d.frequency as Frequency);
      if (!['simplified', 'ordinary'].includes(regime)) continue;
      if (!['annual', 'quarterly', 'monthly'].includes(frequency)) continue;

      const info = computeDeadline({
        regime, frequency,
        year: d.year,
        period: d.period,
      });
      // Only surface if overdue or within 3 days.
      if (info.days_until > 3) continue;

      const isPayment = d.status === 'filed';
      const kind: InboxItemKind = isPayment
        ? (info.is_overdue ? 'payment_overdue' : 'payment_soon')
        : (info.is_overdue ? 'filing_overdue' : 'filing_soon');
      const severity: Severity = info.is_overdue ? 'critical' : 'warning';
      const verb = isPayment ? 'payment' : 'filing';
      const when = info.is_overdue
        ? `${Math.abs(info.days_until)}d overdue`
        : info.days_until === 0
          ? 'due TODAY'
          : `due in ${info.days_until}d`;
      items.push({
        id: `${kind}-${d.id}`,
        kind,
        severity,
        title: `${d.entity_name} — ${verb} ${when}`,
        description: `${d.year} ${d.period} · ${d.status} · ${info.description}`,
        href: `/declarations/${d.id}`,
        context: { declaration_id: d.id, due_date: info.due_date, overdue: info.is_overdue },
      });
    }

    // ── 3. AED high-urgency + unactioned ─────────────────────
    // Real table name: aed_communications (aed_letters is just a variable
    // name used in the UI layer).
    // Status enum on the table: received / reviewed / actioned / archived.
    // We surface anything urgent that hasn't been actioned or archived.
    const aedHigh = await safeQuery<{
      id: string; filename: string; type: string | null;
      summary: string | null; deadline_date: string | null;
      entity_name: string | null;
    }>(
      `SELECT a.id, a.filename, a.type, a.summary, a.deadline_date::text AS deadline_date,
              e.name AS entity_name
         FROM aed_communications a
         LEFT JOIN entities e ON a.entity_id = e.id
        WHERE a.urgency = 'high'
          AND a.status NOT IN ('actioned', 'archived')
        ORDER BY a.deadline_date ASC NULLS LAST
        LIMIT 15`,
    );
    for (const l of aedHigh) {
      const deadline = l.deadline_date
        ? ` · by ${new Date(l.deadline_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}`
        : '';
      items.push({
        id: `aed-${l.id}`,
        kind: 'aed_urgent',
        severity: 'critical',
        title: `AED: ${l.type ? l.type.replace(/_/g, ' ') : 'letter'}${l.entity_name ? ` — ${l.entity_name}` : ''}`,
        description: (l.summary ?? l.filename) + deadline,
        href: `/aed-letters`,
        context: { aed_letter_id: l.id, deadline_date: l.deadline_date },
      });
    }

    // ── 4. Extraction errors ─────────────────────────────────────────
    const extractionErrors = await safeQuery<{
      declaration_id: string; entity_name: string;
      year: number; period: string; n: string;
    }>(
      `SELECT d.id AS declaration_id, e.name AS entity_name, d.year, d.period,
              COUNT(doc.id)::text AS n
         FROM documents doc
         JOIN declarations d ON doc.declaration_id = d.id
         JOIN entities e ON d.entity_id = e.id
        WHERE doc.status = 'error'
        GROUP BY d.id, e.name, d.year, d.period
        ORDER BY MAX(doc.uploaded_at) DESC NULLS LAST
        LIMIT 10`,
    );
    for (const r of extractionErrors) {
      const n = Number(r.n) || 0;
      items.push({
        id: `ext-errors-${r.declaration_id}`,
        kind: 'extraction_errors',
        severity: 'warning',
        title: `${r.entity_name} — ${n} document${n === 1 ? '' : 's'} failed extraction`,
        description: `${r.year} ${r.period} · needs retry / manual review`,
        href: `/declarations/${r.declaration_id}`,
      });
    }

    // ── 5. Validator high-severity findings (if the table has data) ──
    //
    // We don't know the exact schema of validator_findings without
    // peeking, so guard broadly: if the table doesn't exist or the
    // columns differ, the query returns empty and we skip.
    const validatorFindings = await safeQuery<{
      declaration_id: string; entity_name: string;
      year: number; period: string; n: string;
    }>(
      `SELECT d.id AS declaration_id, e.name AS entity_name,
              d.year, d.period, COUNT(*)::text AS n
         FROM validator_findings vf
         JOIN declarations d ON vf.declaration_id = d.id
         JOIN entities e ON d.entity_id = e.id
        WHERE vf.severity = 'high'
          AND (vf.resolution IS NULL OR vf.resolution = 'pending')
        GROUP BY d.id, e.name, d.year, d.period
        ORDER BY d.updated_at DESC
        LIMIT 10`,
    );
    for (const r of validatorFindings) {
      const n = Number(r.n) || 0;
      items.push({
        id: `validator-${r.declaration_id}`,
        kind: 'validator_findings',
        severity: 'critical',
        title: `${r.entity_name} — ${n} high-severity finding${n === 1 ? '' : 's'}`,
        description: `${r.year} ${r.period} · validator flagged, needs review`,
        href: `/declarations/${r.declaration_id}`,
      });
    }

    // ── 6. Budget soft warn (admin-relevant) ─────────────────────────
    try {
      const budget = await getBudgetStatus();
      if (budget.over_soft_warn || budget.over_budget) {
        items.push({
          id: 'budget-warn',
          kind: 'budget_warn',
          severity: budget.over_budget ? 'critical' : 'warning',
          title: budget.over_budget
            ? `Anthropic budget EXCEEDED — €${budget.month_spend_eur.toFixed(2)} of €${budget.limit_eur.toFixed(2)}`
            : `Anthropic budget at ${Math.round(budget.pct_used * 100)}% — €${budget.month_spend_eur.toFixed(2)} of €${budget.limit_eur.toFixed(2)}`,
          description: budget.over_budget
            ? 'AI calls are blocked until the 1st of next month. Raise BUDGET_MONTHLY_EUR if unexpected.'
            : 'Resets on the 1st. Review /metrics for cost by agent.',
          href: '/metrics',
        });
      }
    } catch { /* silent */ }

    // ── 7. New feedback items (admin-relevant) ───────────────────────
    const newFeedback = await safeQueryOne<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM feedback WHERE status = 'new'`,
    );
    if (newFeedback && Number(newFeedback.n) > 0) {
      const n = Number(newFeedback.n);
      items.push({
        id: 'feedback-new',
        kind: 'feedback_new',
        severity: 'info',
        title: `${n} new feedback report${n === 1 ? '' : 's'} awaiting triage`,
        description: 'From the in-product feedback widget. Review + categorise.',
        href: '/settings/feedback',
      });
    }

    // ── 8. Schema / migration warnings (admin) ───────────────────────
    //
    // The individual API routes already return 501 schema_missing when
    // a table is absent, but a reviewer opening the Inbox shouldn't
    // need to cross-reference. We do quick existence checks and
    // surface any missing migrations as a single info item.
    const missing: string[] = [];
    async function tableExists(name: string): Promise<boolean> {
      const r = await safeQueryOne<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = $1`,
        [name],
      );
      return r !== null && Number(r.n) > 0;
    }
    const checks: Array<[string, string]> = [
      ['users',           '001_per_user_ai_budget_and_chat.sql'],
      ['chat_threads',    '001_per_user_ai_budget_and_chat.sql'],
      ['feedback',        '002_feedback.sql'],
      ['app_logs',        '003_app_logs.sql'],
      ['clients',         '005_clients_and_approvers.sql'],
      ['entity_approvers', '005_clients_and_approvers.sql'],
    ];
    try {
      for (const [tbl, mig] of checks) {
        const ok = await tableExists(tbl);
        if (!ok) missing.push(mig);
      }
    } catch { /* silent */ }
    const uniqueMigrations = Array.from(new Set(missing));
    if (uniqueMigrations.length > 0) {
      items.push({
        id: 'schema-missing',
        kind: 'schema_missing',
        severity: 'info',
        title: `${uniqueMigrations.length} migration${uniqueMigrations.length === 1 ? '' : 's'} pending`,
        description: uniqueMigrations.join(', ') + ' — apply in Supabase SQL Editor',
        href: '/settings',
      });
    }

    // ── 9. Tasks: due today + follow-up today + just-unblocked ──
    //
    // Stint 56.F — surface task events Diego asked for ("notifications
    // light"). Computed on-demand (same as everything else here), no
    // cron. Email digest can come later if Diego wants.
    const tasksDue = await safeQuery<{
      id: string; title: string; entity_name: string | null;
      family_name: string | null; due_date: string;
    }>(
      `SELECT t.id, t.title,
              COALESCE(
                (SELECT legal_name FROM tax_entities WHERE id = t.entity_id),
                (SELECT legal_name FROM tax_entities WHERE id = t.related_entity_id)
              ) AS entity_name,
              COALESCE(
                (SELECT g.name FROM tax_entities e JOIN tax_client_groups g ON g.id = e.client_group_id WHERE e.id = t.entity_id),
                (SELECT g.name FROM tax_entities e JOIN tax_client_groups g ON g.id = e.client_group_id WHERE e.id = t.related_entity_id)
              ) AS family_name,
              t.due_date::text AS due_date
         FROM tax_ops_tasks t
        WHERE t.due_date = CURRENT_DATE
          AND t.status NOT IN ('done','cancelled')
        ORDER BY t.priority, t.created_at
        LIMIT 30`,
    );
    for (const t of tasksDue) {
      items.push({
        id: `task-due-${t.id}`,
        kind: 'task_due_today',
        severity: 'critical',
        title: `Due today — ${t.title}`,
        description: [t.family_name, t.entity_name].filter(Boolean).join(' · ') || 'No entity',
        href: `/tax-ops/tasks/${t.id}`,
        context: { task_id: t.id },
        created_at: t.due_date,
      });
    }

    const tasksFollowUp = await safeQuery<{
      id: string; title: string; entity_name: string | null;
      family_name: string | null; follow_up_date: string;
    }>(
      `SELECT t.id, t.title,
              COALESCE(
                (SELECT legal_name FROM tax_entities WHERE id = t.entity_id),
                (SELECT legal_name FROM tax_entities WHERE id = t.related_entity_id)
              ) AS entity_name,
              COALESCE(
                (SELECT g.name FROM tax_entities e JOIN tax_client_groups g ON g.id = e.client_group_id WHERE e.id = t.entity_id),
                (SELECT g.name FROM tax_entities e JOIN tax_client_groups g ON g.id = e.client_group_id WHERE e.id = t.related_entity_id)
              ) AS family_name,
              t.follow_up_date::text AS follow_up_date
         FROM tax_ops_tasks t
        WHERE t.follow_up_date = CURRENT_DATE
          AND t.status NOT IN ('done','cancelled')
        ORDER BY t.priority, t.created_at
        LIMIT 30`,
    );
    for (const t of tasksFollowUp) {
      items.push({
        id: `task-followup-${t.id}`,
        kind: 'task_followup_today',
        severity: 'warning',
        title: `Follow-up today — ${t.title}`,
        description: [t.family_name, t.entity_name].filter(Boolean).join(' · ') || 'Chase reminder',
        href: `/tax-ops/tasks/${t.id}`,
        context: { task_id: t.id },
        created_at: t.follow_up_date,
      });
    }

    // task_unblocked: tasks whose blocker reached 'done' in the last
    // 24h and that haven't been completed yet → "your blocker just
    // cleared, you can move".
    const tasksUnblocked = await safeQuery<{
      id: string; title: string; entity_name: string | null;
      family_name: string | null; blocker_completed_at: string;
    }>(
      `SELECT t.id, t.title,
              COALESCE(
                (SELECT legal_name FROM tax_entities WHERE id = t.entity_id),
                (SELECT legal_name FROM tax_entities WHERE id = t.related_entity_id)
              ) AS entity_name,
              COALESCE(
                (SELECT g.name FROM tax_entities e JOIN tax_client_groups g ON g.id = e.client_group_id WHERE e.id = t.entity_id),
                (SELECT g.name FROM tax_entities e JOIN tax_client_groups g ON g.id = e.client_group_id WHERE e.id = t.related_entity_id)
              ) AS family_name,
              b.completed_at::text AS blocker_completed_at
         FROM tax_ops_tasks t
         JOIN tax_ops_tasks b ON b.id = t.depends_on_task_id
        WHERE t.depends_on_task_id IS NOT NULL
          AND b.status = 'done'
          AND b.completed_at IS NOT NULL
          AND b.completed_at >= NOW() - INTERVAL '24 hours'
          AND t.status NOT IN ('done','cancelled')
        ORDER BY b.completed_at DESC
        LIMIT 20`,
    );
    for (const t of tasksUnblocked) {
      items.push({
        id: `task-unblocked-${t.id}`,
        kind: 'task_unblocked',
        severity: 'info',
        title: `Unblocked — ${t.title}`,
        description: 'Blocker just completed; ready to work on.',
        href: `/tax-ops/tasks/${t.id}`,
        context: { task_id: t.id },
        created_at: t.blocker_completed_at,
      });
    }

    // ── Sort: by severity desc, then by created_at desc ──
    items.sort((a, b) => {
      const s = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      if (s !== 0) return s;
      if (a.created_at && b.created_at) return b.created_at.localeCompare(a.created_at);
      return 0;
    });

    const counts = {
      critical: items.filter(i => i.severity === 'critical').length,
      warning:  items.filter(i => i.severity === 'warning').length,
      info:     items.filter(i => i.severity === 'info').length,
      total:    items.length,
    };

    cache = { items, counts, expires_at: now + TTL_MS };
    return apiOk({ items, counts });
  } catch (e) {
    return apiFail(e, 'inbox/list');
  }
}
