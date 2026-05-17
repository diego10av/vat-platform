import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';

// ════════════════════════════════════════════════════════════════════════
// GET /api/home — aggregator for the home dashboard.
//
// Returns a flat snapshot of "what needs Diego's attention right now"
// (today's focus) plus a 1-line stat per module. Each query is wrapped
// in a try/catch so a missing table or column degrades gracefully —
// the affected card shows 0 instead of breaking the whole page.
//
// Design: every count must pass Rule §11 (actionable-first). If the
// number is 0, the corresponding card renders an "all clear" state.
// ════════════════════════════════════════════════════════════════════════

interface HomeSnapshot {
  todayFocus: {
    overdueFilings: number;
    aedUrgent: number;
    taxOpsTasksToday: number;
    crmTasksToday: number;
    declarationsInReview: number;
  };
  modules: {
    vat: number;
    taxOps: number;
    crm: number;
  };
}

async function safeCount(sql: string, params: unknown[] = []): Promise<number> {
  try {
    const row = await queryOne<{ count: number }>(sql, params);
    return Number(row?.count ?? 0);
  } catch {
    return 0;
  }
}

export async function GET() {
  const [
    overdueFilings,
    aedUrgent,
    taxOpsTasksToday,
    crmTasksToday,
    declarationsInReview,
    vatInFlight,
    taxOpsThisWeek,
    crmActive,
  ] = await Promise.all([
    safeCount(
      `SELECT COUNT(*)::int AS count
         FROM tax_filings
        WHERE deadline_date < CURRENT_DATE
          AND status NOT IN ('filed', 'paid', 'waived')`,
    ),
    safeCount(
      `SELECT COUNT(*)::int AS count
         FROM aed_communications
        WHERE urgency = 'high'
          AND status NOT IN ('actioned', 'archived')`,
    ),
    safeCount(
      // Tax-Ops tasks (engagements + workstreams + atomic) due today or
      // overdue. waiting_on_* excluded — those have their own surface
      // in ChaseToday (chase reminders >5 days without an update).
      `SELECT COUNT(*)::int AS count
         FROM tax_ops_tasks
        WHERE status NOT IN ('done', 'cancelled', 'waiting_on_external', 'waiting_on_internal')
          AND due_date IS NOT NULL
          AND due_date <= CURRENT_DATE`,
    ),
    safeCount(
      // CRM tasks due today or overdue. Tracked separately from the
      // Tax-Ops queue per Rule §14 (independent modules) — Home is the
      // meta-surface where both modules' queues coexist.
      `SELECT COUNT(*)::int AS count
         FROM crm_tasks
        WHERE status != 'done'
          AND due_date::date <= CURRENT_DATE`,
    ),
    safeCount(
      `SELECT COUNT(*)::int AS count
         FROM declarations
        WHERE status = 'review'`,
    ),
    safeCount(
      `SELECT COUNT(*)::int AS count
         FROM declarations
        WHERE status NOT IN ('paid')`,
    ),
    safeCount(
      `SELECT COUNT(*)::int AS count
         FROM tax_filings
        WHERE deadline_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
          AND status NOT IN ('filed', 'paid', 'waived')`,
    ),
    safeCount(
      `SELECT COUNT(*)::int AS count
         FROM crm_matters
        WHERE status = 'active'`,
    ),
  ]);

  const snapshot: HomeSnapshot = {
    todayFocus: {
      overdueFilings,
      aedUrgent,
      taxOpsTasksToday,
      crmTasksToday,
      declarationsInReview,
    },
    modules: {
      vat: vatInFlight,
      taxOps: taxOpsThisWeek,
      crm: crmActive,
    },
  };

  return NextResponse.json(snapshot);
}
