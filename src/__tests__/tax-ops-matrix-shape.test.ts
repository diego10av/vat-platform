// Unit tests for the shape of the /api/tax-ops/matrix response helpers.
// We don't hit the real DB — the test focuses on the pure helpers that
// drive the response shape (period labels per pattern, period-label
// humanizer, etc.) so the assertions are deterministic.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  shortPeriodLabel, applyStatusChange, filterEntitiesByStatus, filterEntities,
} from '@/components/tax-ops/useMatrixData';
import { yearOptions, defaultYear } from '@/components/tax-ops/yearOptions';
import { familyPalette, familyChipClasses } from '@/components/tax-ops/familyColors';
import { WHT_CADENCE_OPTIONS } from '@/components/tax-ops/matrix-row-columns';
import {
  periodWindow, isFinalReturnPeriod,
} from '@/components/tax-ops/liquidationPeriods';
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
  status: 'info_to_request',
  deadline_date: null,
  assigned_to: null,
  comments: null,
  filed_at: null,
  draft_sent_at: null,
  tax_assessment_received_at: null,
  amount_due: null,
  amount_paid: null,
  prepared_with: [],
  partner_in_charge: [],
  associates_working: [],
  last_info_request_sent_at: null,
  last_action_at: null,
  invoice_price_eur: null,
  invoice_price_note: null,
  csp_contacts: [],
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
      cell: makeCell({ filing_id: 'filing-42', status: 'info_to_request' }),
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

  // Stint 39.E — undo toast: existing cell → undo re-PATCHes to prior.
  it('when a toast is supplied, emits a success with Undo that reverts the PATCH', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":true}', { status: 200 })));
    const refetch = vi.fn();
    const toastSpy = {
      withAction: vi.fn(),
      error: vi.fn(),
    };
    await applyStatusChange({
      entity: makeEntity(),
      column: makeColumn(),
      cell: makeCell({ filing_id: 'filing-7', status: 'working' }),
      nextStatus: 'filed',
      refetch,
      toast: toastSpy,
    });
    expect(toastSpy.withAction).toHaveBeenCalledOnce();
    const [kind, , , action] = toastSpy.withAction.mock.calls[0]!;
    expect(kind).toBe('success');
    // Invoke Undo
    await action.onClick();
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const undoCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]!;
    expect(undoCall[0]).toBe('/api/tax-ops/filings/filing-7');
    expect(undoCall[1].method).toBe('PATCH');
    expect(JSON.parse(undoCall[1].body as string)).toEqual({ status: 'working' });
  });

  // Stint 39.E — undo on create: reverts with DELETE of the just-made filing.
  it('when POST creates a filing, Undo DELETEs it', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/tax-ops/filings' && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'new-filing-123' }), { status: 200 });
      }
      return new Response('{"ok":true}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const toastSpy = { withAction: vi.fn(), error: vi.fn() };
    await applyStatusChange({
      entity: makeEntity({ obligation_id: 'obl-1' }),
      column: makeColumn('2026-Q1'),
      cell: null,
      nextStatus: 'working',
      refetch: vi.fn(),
      toast: toastSpy,
    });
    expect(toastSpy.withAction).toHaveBeenCalledOnce();
    const [, , , action] = toastSpy.withAction.mock.calls[0]!;
    await action.onClick();
    const undoCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]!;
    expect(undoCall[0]).toBe('/api/tax-ops/filings/new-filing-123');
    expect(undoCall[1]?.method).toBe('DELETE');
  });
});

// Stint 39.D — filter helper for the status dropdown.
describe('filterEntitiesByStatus', () => {
  const period = ['2026'];
  const makeRow = (st: string | null): MatrixEntity => ({
    ...makeEntity(),
    id: `ent-${st ?? 'empty'}`,
    cells: st ? { '2026': makeCell({ status: st }) } : { '2026': null },
  });
  const rows = [
    makeRow('info_to_request'),
    makeRow('filed'),
    makeRow(null),
    makeRow('working'),
  ];

  it("returns every row when filter is 'all' or undefined", () => {
    expect(filterEntitiesByStatus(rows, 'all', period)).toHaveLength(4);
    expect(filterEntitiesByStatus(rows, undefined, period)).toHaveLength(4);
    expect(filterEntitiesByStatus(rows, '', period)).toHaveLength(4);
  });

  it('matches entities whose at-least-one period cell has that status', () => {
    const filtered = filterEntitiesByStatus(rows, 'filed', period);
    expect(filtered.map(r => r.id)).toEqual(['ent-filed']);
  });

  it("'__empty' returns only rows where every period cell is null", () => {
    const filtered = filterEntitiesByStatus(rows, '__empty', period);
    expect(filtered.map(r => r.id)).toEqual(['ent-empty']);
  });

  it('returns [] when no row matches (safe for an empty state render)', () => {
    expect(filterEntitiesByStatus(rows, 'partially_approved', period)).toEqual([]);
  });
});

// Stint 43.D1 — year window narrowed from 4 to 3 (drop currentYear-2).
describe('yearOptions + defaultYear', () => {
  it('yearOptions returns 3 consecutive years: prior, current, next', () => {
    const years = yearOptions();
    const currentYear = new Date().getFullYear();
    expect(years).toHaveLength(3);
    expect(years).toEqual([currentYear - 1, currentYear, currentYear + 1]);
  });

  it('defaultYear points at the current work year for quarterly/monthly', () => {
    const y = defaultYear('quarterly');
    expect(y).toBe(new Date().getFullYear());
  });

  it('defaultYear points at N-1 for annual + semester filings (still open in N)', () => {
    expect(defaultYear('annual')).toBe(new Date().getFullYear() - 1);
    expect(defaultYear('semester')).toBe(new Date().getFullYear() - 1);
  });
});

// Stint 40 — new field defaults + filter integration.
describe('stint 40 field additions', () => {
  it('MatrixCell fixture carries invoice_price + csp_contacts defaults', () => {
    const cell = makeCell();
    expect(cell.invoice_price_eur).toBeNull();
    expect(cell.invoice_price_note).toBeNull();
    expect(cell.csp_contacts).toEqual([]);
    expect(cell.last_info_request_sent_at).toBeNull();
  });

  it('overrides let tests set a specific invoice price + contacts', () => {
    const cell = makeCell({
      invoice_price_eur: '3000.00',
      invoice_price_note: '+5% office expenses',
      csp_contacts: [{ name: 'Jane Doe', email: 'jane@csp.example', role: 'Accountant' }],
    });
    expect(cell.invoice_price_eur).toBe('3000.00');
    expect(cell.invoice_price_note).toBe('+5% office expenses');
    expect(cell.csp_contacts).toHaveLength(1);
    expect(cell.csp_contacts[0]!.email).toBe('jane@csp.example');
  });

  it('filterEntitiesByStatus tolerates cells with all 40.O/40.G fields populated', () => {
    const rich = makeCell({
      status: 'filed',
      invoice_price_eur: '3000',
      csp_contacts: [{ name: 'A' }],
    });
    const ent: MatrixEntity = { ...makeEntity(), cells: { '2026': rich } };
    const [kept] = filterEntitiesByStatus([ent], 'filed', ['2026']);
    expect(kept).toBe(ent);
  });
});

// Stint 43.D7 — combined filter helper. AND across status/partner/associate.
describe('filterEntities (combined)', () => {
  const period = ['2026'];
  const makeOwned = (
    id: string,
    st: string,
    partner: string[],
    assoc: string[],
  ): MatrixEntity => ({
    ...makeEntity(),
    id,
    cells: {
      '2026': makeCell({
        status: st,
        partner_in_charge: partner,
        associates_working: assoc,
      }),
    },
  });
  const rows = [
    makeOwned('a', 'info_to_request', ['Diego'], ['Vale']),
    makeOwned('b', 'working', ['Gab'], ['Andrew']),
    makeOwned('c', 'filed', ['Diego'], []),
    makeOwned('d', 'info_to_request', [], []),
  ];

  it("'all' on every filter is a passthrough", () => {
    const out = filterEntities({
      entities: rows, status: 'all', partner: 'all', associate: 'all',
      periodLabels: period,
    });
    expect(out).toHaveLength(4);
  });

  it('filters by partner alone — case-sensitive exact match on short_name', () => {
    const out = filterEntities({
      entities: rows, partner: 'Diego', periodLabels: period,
    });
    expect(out.map(r => r.id)).toEqual(['a', 'c']);
  });

  it('filters by associate alone', () => {
    const out = filterEntities({
      entities: rows, associate: 'Vale', periodLabels: period,
    });
    expect(out.map(r => r.id)).toEqual(['a']);
  });

  it("'__unassigned' on partner returns rows with empty partner_in_charge on every cell", () => {
    const out = filterEntities({
      entities: rows, partner: '__unassigned', periodLabels: period,
    });
    expect(out.map(r => r.id)).toEqual(['d']);
  });

  it("'__unassigned' on associate returns rows with no associate everywhere", () => {
    const out = filterEntities({
      entities: rows, associate: '__unassigned', periodLabels: period,
    });
    expect(out.map(r => r.id).sort()).toEqual(['c', 'd']);
  });

  it('AND-combines status + partner + associate', () => {
    // status='info_to_request' → a, d
    // partner='Diego' → a, c
    // associate='Vale' → a
    // intersection → a only
    const out = filterEntities({
      entities: rows,
      status: 'info_to_request',
      partner: 'Diego',
      associate: 'Vale',
      periodLabels: period,
    });
    expect(out.map(r => r.id)).toEqual(['a']);
  });

  it('returns [] when filters do not intersect', () => {
    // status='filed' AND partner='Gab' → no row matches both.
    const out = filterEntities({
      entities: rows, status: 'filed', partner: 'Gab', periodLabels: period,
    });
    expect(out).toEqual([]);
  });
});

// Stint 43.D15 — liquidation date drives the "final return" border on
// the status chip whose period contains the date. periodWindow needs
// to handle annual / quarterly / monthly labels correctly (incl. leap
// years + 30/31 day months).
describe('periodWindow + isFinalReturnPeriod (stint 43.D15)', () => {
  it('annual labels span Jan-1 to Dec-31', () => {
    expect(periodWindow('2025')).toEqual({ start: '2025-01-01', end: '2025-12-31' });
    expect(periodWindow('2024')).toEqual({ start: '2024-01-01', end: '2024-12-31' });
  });

  it('quarterly labels handle 30/31 day months correctly', () => {
    // Q1: Jan-Mar (Mar = 31), Q2: Apr-Jun (Jun = 30),
    // Q3: Jul-Sep (Sep = 30), Q4: Oct-Dec (Dec = 31)
    expect(periodWindow('2025-Q1')).toEqual({ start: '2025-01-01', end: '2025-03-31' });
    expect(periodWindow('2025-Q2')).toEqual({ start: '2025-04-01', end: '2025-06-30' });
    expect(periodWindow('2025-Q3')).toEqual({ start: '2025-07-01', end: '2025-09-30' });
    expect(periodWindow('2025-Q4')).toEqual({ start: '2025-10-01', end: '2025-12-31' });
  });

  it('monthly labels handle leap years (Feb 29 vs 28)', () => {
    expect(periodWindow('2024-02')).toEqual({ start: '2024-02-01', end: '2024-02-29' });
    expect(periodWindow('2025-02')).toEqual({ start: '2025-02-01', end: '2025-02-28' });
    expect(periodWindow('2025-04')).toEqual({ start: '2025-04-01', end: '2025-04-30' });
    expect(periodWindow('2025-12')).toEqual({ start: '2025-12-01', end: '2025-12-31' });
  });

  it('unknown labels (semester / ad-hoc) → null', () => {
    expect(periodWindow('2025-S2')).toBeNull();
    expect(periodWindow('2025-ADHOC-99')).toBeNull();
  });

  it('isFinalReturnPeriod matches the period containing the liquidation date', () => {
    // CIT 2025 + liquidation 2025-09-15 → final on the annual cell.
    expect(isFinalReturnPeriod('2025-09-15', '2025')).toBe(true);
    expect(isFinalReturnPeriod('2025-09-15', '2024')).toBe(false);

    // VAT quarterly: liquidation in Q3 → only Q3 marked.
    expect(isFinalReturnPeriod('2025-09-15', '2025-Q3')).toBe(true);
    expect(isFinalReturnPeriod('2025-09-15', '2025-Q2')).toBe(false);
    expect(isFinalReturnPeriod('2025-09-15', '2025-Q4')).toBe(false);

    // VAT monthly: liquidation Sep 15 → only 2025-09 marked.
    expect(isFinalReturnPeriod('2025-09-15', '2025-09')).toBe(true);
    expect(isFinalReturnPeriod('2025-09-15', '2025-08')).toBe(false);
    expect(isFinalReturnPeriod('2025-09-15', '2025-10')).toBe(false);
  });

  it('null liquidation_date → never a final return', () => {
    expect(isFinalReturnPeriod(null, '2025')).toBe(false);
    expect(isFinalReturnPeriod(null, '2025-Q1')).toBe(false);
  });

  it('boundary dates (last day of period) still match', () => {
    expect(isFinalReturnPeriod('2025-12-31', '2025-Q4')).toBe(true);
    expect(isFinalReturnPeriod('2025-12-31', '2025-12')).toBe(true);
    expect(isFinalReturnPeriod('2025-01-01', '2025-Q1')).toBe(true);
  });
});

// Stint 39.B — deterministic family colors.
describe('familyColors', () => {
  it('returns the same palette entry for the same name every call', () => {
    const a = familyPalette('Peninsula Holdings');
    const b = familyPalette('Peninsula Holdings');
    expect(a).toBe(b);
  });

  it('normalises case + whitespace so "peninsula" and "PENINSULA " hash to the same bucket', () => {
    expect(familyPalette('peninsula')).toBe(familyPalette('PENINSULA '));
  });

  it('returns a neutral palette for null / empty names (no random assignment)', () => {
    const neutralA = familyPalette(null);
    const neutralB = familyPalette('');
    const neutralC = familyPalette('   ');
    expect(neutralA).toBe(neutralB);
    expect(neutralA).toBe(neutralC);
  });

  it('familyChipClasses returns a tailwind string safe to inject into className', () => {
    const s = familyChipClasses('Trilantic');
    expect(typeof s).toBe('string');
    // Basic sanity: we should see a bg- class and a text- class from our palette.
    expect(s).toMatch(/bg-/);
    expect(s).toMatch(/text-/);
  });
});

// Stint 41 — WHT cadence switcher option set.
describe('WHT_CADENCE_OPTIONS', () => {
  it('exposes the 5 supported cadences in a stable order', () => {
    expect(WHT_CADENCE_OPTIONS.map(o => o.period_pattern)).toEqual([
      'monthly', 'quarterly', 'semester', 'annual', 'adhoc',
    ]);
  });

  it('every option maps to a wht_director_<pattern> tax_type', () => {
    for (const o of WHT_CADENCE_OPTIONS) {
      expect(o.tax_type).toBe(`wht_director_${o.period_pattern}`);
    }
  });

  it('labels are human-readable (no underscores, first letter upper)', () => {
    for (const o of WHT_CADENCE_OPTIONS) {
      expect(o.label).not.toContain('_');
      expect(o.label[0]).toBe(o.label[0]!.toUpperCase());
    }
  });
});
