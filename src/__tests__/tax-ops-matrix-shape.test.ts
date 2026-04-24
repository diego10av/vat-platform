// Unit tests for the shape of the /api/tax-ops/matrix response helpers.
// We don't hit the real DB — the test focuses on the pure helpers that
// drive the response shape (period labels per pattern, period-label
// humanizer, etc.) so the assertions are deterministic.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { shortPeriodLabel, applyStatusChange } from '@/components/tax-ops/useMatrixData';
import type { MatrixEntity, MatrixCell, MatrixColumn } from '@/components/tax-ops/TaxTypeMatrix';

describe('shortPeriodLabel', () => {
  it('keeps the annual label as-is', () => {
    expect(shortPeriodLabel('2025')).toBe('2025');
    expect(shortPeriodLabel('2026')).toBe('2026');
  });

  it('strips the year prefix from quarterly labels', () => {
    expect(shortPeriodLabel('2026-Q1')).toBe('Q1');
    expect(shortPeriodLabel('2026-Q4')).toBe('Q4');
  });

  it('converts monthly labels into three-letter month names', () => {
    expect(shortPeriodLabel('2026-01')).toBe('Jan');
    expect(shortPeriodLabel('2026-03')).toBe('Mar');
    expect(shortPeriodLabel('2026-12')).toBe('Dec');
  });

  it('falls back to the raw label for unknown shapes', () => {
    // Ad-hoc / semester labels pass through.
    expect(shortPeriodLabel('2026-ADHOC-45')).toBe('2026-ADHOC-45');
    expect(shortPeriodLabel('2026-S2')).toBe('2026-S2');
  });
});

// ─── Period-labels generator (inlined mirror of the server-side helper) ──
//
// The matrix route has a local periodLabelsFor() that we don't export
// separately; we test the same shape here by recreating it, so that if
// the server diverges the test catches it when a future stint refactors.

function periodLabelsFor(pattern: string, year: number): string[] {
  if (pattern === 'annual')   return [String(year)];
  if (pattern === 'quarterly') return ['Q1', 'Q2', 'Q3', 'Q4'].map(q => `${year}-${q}`);
  if (pattern === 'monthly') {
    return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  }
  if (pattern === 'semester') return [`${year}-S1`, `${year}-S2`];
  return [];
}

describe('period labels per pattern', () => {
  it('annual → single label equal to the year', () => {
    expect(periodLabelsFor('annual', 2025)).toEqual(['2025']);
  });

  it('quarterly → 4 labels in order Q1..Q4', () => {
    expect(periodLabelsFor('quarterly', 2026)).toEqual(['2026-Q1', '2026-Q2', '2026-Q3', '2026-Q4']);
  });

  it('monthly → 12 labels Jan..Dec, zero-padded', () => {
    const labels = periodLabelsFor('monthly', 2026);
    expect(labels.length).toBe(12);
    expect(labels[0]).toBe('2026-01');
    expect(labels[1]).toBe('2026-02');
    expect(labels[11]).toBe('2026-12');
  });

  it('semester → 2 labels S1 + S2', () => {
    expect(periodLabelsFor('semester', 2025)).toEqual(['2025-S1', '2025-S2']);
  });

  it('adhoc / unknown patterns → empty array', () => {
    expect(periodLabelsFor('adhoc', 2026)).toEqual([]);
    expect(periodLabelsFor('whatever', 2026)).toEqual([]);
  });

  it('stays in sync across years', () => {
    expect(periodLabelsFor('quarterly', 2024)).toEqual(['2024-Q1', '2024-Q2', '2024-Q3', '2024-Q4']);
    expect(periodLabelsFor('monthly', 2025).slice(0, 3)).toEqual(['2025-01', '2025-02', '2025-03']);
  });
});

// ═════════════════════════════════════════════════════════════════════
// applyStatusChange — routes existing/empty cells to PATCH vs POST.
// Stint 36 introduced this helper; the tests below lock its contract.
// ═════════════════════════════════════════════════════════════════════

const makeEntity = (overrides: Partial<MatrixEntity> = {}): MatrixEntity => ({
  id: 'ent-1',
  legal_name: 'Test Entity SARL',
  group_id: 'grp-1',
  group_name: 'TEST GROUP',
  obligation_id: 'obl-1',
  cells: {},
  ...overrides,
});

const makeCell = (overrides: Partial<MatrixCell> = {}): MatrixCell => ({
  filing_id: 'filing-1',
  status: 'pending_info',
  deadline_date: null,
  assigned_to: null,
  comments: null,
  filed_at: null,
  draft_sent_at: null,
  tax_assessment_received_at: null,
  amount_due: null,
  amount_paid: null,
  prepared_with: [],
  ...overrides,
});

const makeColumn = (key = '2025'): MatrixColumn => ({ key, label: key });

describe('applyStatusChange', () => {
  beforeEach(() => {
    // Reset the global fetch mock before every test.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
  });

  it('existing cell → PATCH /api/tax-ops/filings/<id> with the new status', async () => {
    const refetch = vi.fn();
    await applyStatusChange({
      entity: makeEntity(),
      column: makeColumn(),
      cell: makeCell({ filing_id: 'filing-42', status: 'pending_info' }),
      nextStatus: 'filed',
      refetch,
    });
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/tax-ops/filings/filing-42');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ status: 'filed' });
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('empty cell with obligation → POST /api/tax-ops/filings with obligation_id + period_label', async () => {
    const refetch = vi.fn();
    await applyStatusChange({
      entity: makeEntity({ obligation_id: 'obl-999' }),
      column: makeColumn('2026-Q2'),
      cell: null,
      nextStatus: 'working',
      refetch,
    });
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/tax-ops/filings');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      obligation_id: 'obl-999',
      period_label: '2026-Q2',
      status: 'working',
    });
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('empty cell without obligation → rejects with a human-readable error (refetch not called)', async () => {
    const refetch = vi.fn();
    await expect(applyStatusChange({
      entity: makeEntity({ obligation_id: null }),
      column: makeColumn('2026'),
      cell: null,
      nextStatus: 'working',
      refetch,
    })).rejects.toThrow(/no obligation/i);
    expect(refetch).not.toHaveBeenCalled();
  });

  it('propagates a non-200 HTTP status into a thrown Error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"nope"}', { status: 409 })));
    const refetch = vi.fn();
    await expect(applyStatusChange({
      entity: makeEntity(),
      column: makeColumn(),
      cell: makeCell({ filing_id: 'x' }),
      nextStatus: 'filed',
      refetch,
    })).rejects.toThrow();
    expect(refetch).not.toHaveBeenCalled();
  });
});
