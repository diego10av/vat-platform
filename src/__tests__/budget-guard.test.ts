import { describe, it, expect, vi, beforeEach } from 'vitest';

// We mock the DB layer so these tests are hermetic (no Supabase required).
vi.mock('@/lib/db', () => ({
  queryOne: vi.fn(),
}));

import { queryOne } from '@/lib/db';
import {
  getBudgetStatus,
  requireBudget,
  getUserBudgetStatus,
  requireUserBudget,
} from '@/lib/budget-guard';

const mockQueryOne = queryOne as unknown as ReturnType<typeof vi.fn>;

describe('firm-wide monthly budget', () => {
  beforeEach(() => {
    mockQueryOne.mockReset();
  });

  it('reports spend + remaining against the default €75 cap', async () => {
    mockQueryOne.mockResolvedValueOnce({ total: 12.5 });
    const s = await getBudgetStatus();
    expect(s.month_spend_eur).toBe(12.5);
    expect(s.limit_eur).toBe(75);
    expect(s.remaining_eur).toBe(62.5);
    expect(s.over_budget).toBe(false);
  });

  it('flags over_soft_warn at 80%', async () => {
    mockQueryOne.mockResolvedValueOnce({ total: 60 });
    const s = await getBudgetStatus();
    expect(s.over_soft_warn).toBe(true);
    expect(s.over_budget).toBe(false);
  });

  it('flags over_budget at 100%', async () => {
    mockQueryOne.mockResolvedValueOnce({ total: 80 });
    const s = await getBudgetStatus();
    expect(s.over_budget).toBe(true);
  });

  it('requireBudget returns ok when under the cap', async () => {
    mockQueryOne.mockResolvedValueOnce({ total: 10 });
    const r = await requireBudget();
    expect(r.ok).toBe(true);
  });

  it('requireBudget returns an error envelope when over', async () => {
    mockQueryOne.mockResolvedValueOnce({ total: 100 });
    const r = await requireBudget();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('budget_exceeded');
      expect(r.error.status).toBe(429);
      expect(r.error.message).toMatch(/budget reached/);
    }
  });
});

// Per-user monthly budget tests removed in single-user reset. The wrappers
// requireUserBudget / getUserBudgetStatus now delegate to the firm cap; the
// firm-cap tests above already cover the behavior.
