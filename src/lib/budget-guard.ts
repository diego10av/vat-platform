// ════════════════════════════════════════════════════════════════════════
// Budget guard — hard cap on Anthropic spend.
//
// Two gates live here:
//
// 1. Firm-wide monthly cap  →  requireBudget()
//    SUM(cost_eur) across the month; refuses if ≥ BUDGET_MONTHLY_EUR.
//    Protects against runaway loops, stuck jobs, compromised endpoints.
//
// 2. Per-user monthly cap   →  requireUserBudget(userId)
//    SUM(cost_eur) for a specific user; refuses if ≥ users.monthly_ai_cap_eur.
//    Primarily gates the in-product chat so a single "crazy user" pasting
//    500k-token documents can't burn €50 on Opus in an afternoon.
//    Per Diego 2026-04-17: default €2/user/mo, raiseable by admin.
//
// Both gates call cheap SUM queries over indexed columns (created_at for
// the firm gate, (user_id, created_at) for the per-user gate — index
// added in migration 001).
//
// Env config:
// - BUDGET_MONTHLY_EUR  — firm cap (default 75).
// - Soft-warn at 80% (consumer may render a banner; not auto-enforced).
// - Hard-block at 100%.
//
// Graceful degradation:
// - If migration 001 hasn't been applied yet, the per-user query may
//   fail (missing column / missing table). In that case `requireUserBudget`
//   falls back to the firm-wide gate so the app stays functional during
//   rollout. Once the migration lands, per-user enforcement activates
//   automatically.
// ════════════════════════════════════════════════════════════════════════

import { queryOne } from '@/lib/db';
import { logger } from '@/lib/logger';

const log = logger.bind('budget-guard');

export interface BudgetStatus {
  month_spend_eur: number;
  limit_eur: number;
  pct_used: number;
  over_budget: boolean;
  over_soft_warn: boolean;
  remaining_eur: number;
}

export interface BudgetError {
  code: 'budget_exceeded';
  status: 429;
  message: string;
  hint: string;
  month_spend_eur: number;
  limit_eur: number;
}

const DEFAULT_MONTHLY_LIMIT_EUR = 75;
const SOFT_WARN_PCT = 0.80;
const HARD_BLOCK_PCT = 1.00;

function getBudgetLimitEur(): number {
  const raw = process.env.BUDGET_MONTHLY_EUR;
  if (!raw) return DEFAULT_MONTHLY_LIMIT_EUR;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MONTHLY_LIMIT_EUR;
}

/**
 * Snapshot the current month's Anthropic spend. Cheap query.
 */
export async function getBudgetStatus(): Promise<BudgetStatus> {
  const row = await queryOne<{ total: number | null }>(
    `SELECT COALESCE(SUM(cost_eur), 0)::float AS total
       FROM api_calls
      WHERE created_at >= date_trunc('month', NOW())
        AND status != 'error'`,
  );
  const spend = Number(row?.total ?? 0);
  const limit = getBudgetLimitEur();
  const pct = limit > 0 ? spend / limit : 0;
  return {
    month_spend_eur: Math.round(spend * 100) / 100,
    limit_eur: limit,
    pct_used: Math.round(pct * 10000) / 10000, // 4 decimals
    over_soft_warn: pct >= SOFT_WARN_PCT,
    over_budget: pct >= HARD_BLOCK_PCT,
    remaining_eur: Math.max(0, Math.round((limit - spend) * 100) / 100),
  };
}

/**
 * Enforce the monthly budget. Call at the top of every Anthropic-using
 * route, before any expensive call. Returns either `{ ok: true, status }`
 * — proceed — or `{ ok: false, error }` — the caller must respond 429.
 *
 * Safe to call every request; the query is SUM-over-index, single-digit
 * milliseconds on the current DB.
 */
export async function requireBudget(): Promise<
  | { ok: true; status: BudgetStatus }
  | { ok: false; error: BudgetError; status: BudgetStatus }
> {
  const status = await getBudgetStatus();
  if (status.over_budget) {
    return {
      ok: false,
      status,
      error: {
        code: 'budget_exceeded',
        status: 429,
        message:
          `Monthly Anthropic budget reached: €${status.month_spend_eur.toFixed(2)} ` +
          `of €${status.limit_eur.toFixed(2)}. New AI calls are blocked until the ` +
          `1st of next month.`,
        hint:
          'Raise BUDGET_MONTHLY_EUR in Vercel env if this was expected, or inspect ' +
          '/metrics for which agent consumed the budget.',
        month_spend_eur: status.month_spend_eur,
        limit_eur: status.limit_eur,
      },
    };
  }
  return { ok: true, status };
}

// ════════════════════════════════════════════════════════════════════════
// Per-user monthly cap
// ════════════════════════════════════════════════════════════════════════

export interface UserBudgetStatus {
  user_id: string;
  month_spend_eur: number;
  cap_eur: number;
  pct_used: number;
  remaining_eur: number;
  over_budget: boolean;
  over_soft_warn: boolean;
}

export interface UserBudgetError {
  code: 'user_budget_exceeded';
  status: 429;
  message: string;
  hint: string;
  month_spend_eur: number;
  cap_eur: number;
}

const DEFAULT_USER_CAP_EUR = 2.0;

/**
 * Snapshot one user's current-month AI spend against their cap.
 *
 * Tolerant of missing schema: if the `users` table or `api_calls.user_id`
 * column don't exist yet (migration 001 not applied), we return a
 * permissive status with cap = Infinity — never block in that case.
 */
export async function getUserBudgetStatus(userId: string): Promise<UserBudgetStatus> {
  let cap = DEFAULT_USER_CAP_EUR;
  let spent = 0;

  try {
    const userRow = await queryOne<{ cap: number }>(
      `SELECT monthly_ai_cap_eur::float AS cap FROM users WHERE id = $1`,
      [userId],
    );
    if (userRow && Number.isFinite(userRow.cap) && userRow.cap > 0) {
      cap = userRow.cap;
    }
  } catch {
    // Migration not applied → users table missing. Act permissively.
    log.warn('users table not queryable — falling back to default cap', {
      user_id: userId,
      default_cap_eur: DEFAULT_USER_CAP_EUR,
    });
    return {
      user_id: userId,
      month_spend_eur: 0,
      cap_eur: Number.POSITIVE_INFINITY,
      pct_used: 0,
      remaining_eur: Number.POSITIVE_INFINITY,
      over_budget: false,
      over_soft_warn: false,
    };
  }

  try {
    const spendRow = await queryOne<{ total: number | null }>(
      `SELECT COALESCE(SUM(cost_eur), 0)::float AS total
         FROM api_calls
        WHERE user_id = $1
          AND created_at >= date_trunc('month', NOW())
          AND status != 'error'`,
      [userId],
    );
    spent = Number(spendRow?.total ?? 0);
  } catch {
    // Migration not applied → user_id column missing. Act permissively
    // and return 0 spend so the request goes through (firm gate still
    // protects us).
    log.warn('api_calls.user_id not queryable — falling back to 0 spend', {
      user_id: userId,
    });
    spent = 0;
  }

  const pct = cap > 0 ? spent / cap : 0;
  return {
    user_id: userId,
    month_spend_eur: Math.round(spent * 100) / 100,
    cap_eur: Math.round(cap * 100) / 100,
    pct_used: Math.round(pct * 10000) / 10000,
    remaining_eur: Math.max(0, Math.round((cap - spent) * 100) / 100),
    over_budget: pct >= HARD_BLOCK_PCT,
    over_soft_warn: pct >= SOFT_WARN_PCT,
  };
}

/**
 * Enforce the per-user cap. Call at the top of every user-triggered
 * Anthropic-using route that is in-product and user-attributed
 * (primarily the chat endpoints).
 *
 * For a cost *estimate* (e.g. an "Ask Opus" button that knows the
 * prompt size up front), pass `estimatedCostEur` — we compare
 * projected-total against cap rather than current-total, so the
 * call refuses BEFORE spending the last euro.
 */
export async function requireUserBudget(
  userId: string,
  estimatedCostEur: number = 0,
): Promise<
  | { ok: true; status: UserBudgetStatus }
  | { ok: false; error: UserBudgetError; status: UserBudgetStatus }
> {
  const status = await getUserBudgetStatus(userId);
  const projected = status.month_spend_eur + Math.max(0, estimatedCostEur);

  // Infinity-cap = migration not applied; always pass.
  if (!Number.isFinite(status.cap_eur)) return { ok: true, status };

  if (projected >= status.cap_eur) {
    return {
      ok: false,
      status,
      error: {
        code: 'user_budget_exceeded',
        status: 429,
        message:
          `You've reached your AI quota for this month: €${status.month_spend_eur.toFixed(2)} ` +
          `of €${status.cap_eur.toFixed(2)}. Resets on the 1st of next month.`,
        hint:
          'Ask your firm admin to raise your monthly cap if you need more (up to €30 on Enterprise).',
        month_spend_eur: status.month_spend_eur,
        cap_eur: status.cap_eur,
      },
    };
  }

  return { ok: true, status };
}
