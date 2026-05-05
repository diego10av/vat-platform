// ════════════════════════════════════════════════════════════════════════
// Budget guard — single hard cap on Anthropic spend.
//
// Single user (Diego) → single monthly cap. SUM(cost_eur) over the
// current month; refuses if ≥ BUDGET_MONTHLY_EUR. Soft-warns at 80%.
//
// requireUserBudget() is kept as a thin alias of requireBudget() so the
// 8 in-product callsites that pass userId don't need to change. The
// userId arg is ignored.
// ════════════════════════════════════════════════════════════════════════

import { queryOne } from '@/lib/db';

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
    pct_used: Math.round(pct * 10000) / 10000,
    over_soft_warn: pct >= SOFT_WARN_PCT,
    over_budget: pct >= HARD_BLOCK_PCT,
    remaining_eur: Math.max(0, Math.round((limit - spend) * 100) / 100),
  };
}

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

// ─────────────────── Back-compat thin wrappers ───────────────────
//
// Single-user reset: the in-product chat endpoints used to enforce a
// per-user cap on top of the firm cap. Now both collapse to the firm
// cap. The wrappers below preserve the old call signatures so
// callsites don't need editing — userId is ignored.

export interface UserBudgetStatus extends BudgetStatus {
  user_id: string;
  cap_eur: number;
}

export interface UserBudgetError extends BudgetError {
  code: 'budget_exceeded';
  cap_eur: number;
}

export async function getUserBudgetStatus(userId: string): Promise<UserBudgetStatus> {
  const status = await getBudgetStatus();
  return { ...status, user_id: userId, cap_eur: status.limit_eur };
}

export async function requireUserBudget(
  userId: string,
  _estimatedCostEur: number = 0,
): Promise<
  | { ok: true; status: UserBudgetStatus }
  | { ok: false; error: UserBudgetError; status: UserBudgetStatus }
> {
  const result = await requireBudget();
  const userStatus: UserBudgetStatus = {
    ...result.status,
    user_id: userId,
    cap_eur: result.status.limit_eur,
  };
  if (!result.ok) {
    return {
      ok: false,
      status: userStatus,
      error: { ...result.error, cap_eur: result.status.limit_eur },
    };
  }
  return { ok: true, status: userStatus };
}
