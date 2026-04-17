import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  queryOne: vi.fn(),
  query: vi.fn(),
  execute: vi.fn(),
  generateId: vi.fn(() => 'prec-gen-1'),
  logAudit: vi.fn(),
}));

import { queryOne, query, execute, logAudit } from '@/lib/db';
import { upsertPrecedentsFromDeclaration } from '@/lib/precedents';

const mockQueryOne = queryOne as unknown as ReturnType<typeof vi.fn>;
const mockQuery = query as unknown as ReturnType<typeof vi.fn>;
const mockExecute = execute as unknown as ReturnType<typeof vi.fn>;
const mockLogAudit = logAudit as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockQueryOne.mockReset();
  mockQuery.mockReset();
  mockExecute.mockReset();
  mockLogAudit.mockReset();
});

describe('upsertPrecedentsFromDeclaration', () => {
  it('throws when the declaration does not exist', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    await expect(upsertPrecedentsFromDeclaration('d-missing')).rejects.toThrow(/not found/i);
  });

  it('reports zeros when there are no eligible lines', async () => {
    mockQueryOne.mockResolvedValueOnce({ entity_id: 'ent-1' });
    mockQuery.mockResolvedValueOnce([]);

    const report = await upsertPrecedentsFromDeclaration('d-1');
    expect(report).toEqual({
      inserted: 0, updated: 0, skipped: 0, total_lines_considered: 0,
    });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('skips lines with empty or "unknown" provider', async () => {
    mockQueryOne.mockResolvedValueOnce({ entity_id: 'ent-1' });
    mockQuery.mockResolvedValueOnce([
      { provider: '', country: 'LU', treatment: 'LUX_17', description: null, amount_eur: 100 },
      { provider: 'unknown', country: 'LU', treatment: 'LUX_17', description: null, amount_eur: 100 },
      { provider: 'UNKNOWN', country: 'LU', treatment: 'LUX_17', description: null, amount_eur: 100 },
    ]);

    const report = await upsertPrecedentsFromDeclaration('d-1');
    expect(report.skipped).toBe(3);
    expect(report.inserted).toBe(0);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('inserts a new precedent when none matches', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ entity_id: 'ent-1' })     // declaration lookup
      .mockResolvedValueOnce(null);                       // existing precedent lookup

    mockQuery.mockResolvedValueOnce([
      { provider: 'Shell LU', country: 'LU', treatment: 'LUX_17', description: 'fuel', amount_eur: 50 },
    ]);
    mockExecute.mockResolvedValue(undefined);

    const report = await upsertPrecedentsFromDeclaration('d-1');
    expect(report.inserted).toBe(1);
    expect(report.updated).toBe(0);
    expect(report.total_lines_considered).toBe(1);

    // Insert audit log
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'create',
      targetType: 'precedent',
    }));

    // Insert SQL fired
    const sqls = mockExecute.mock.calls.map(c => c[0] as string);
    expect(sqls.some(s => /INSERT INTO precedents/.test(s))).toBe(true);
  });

  it('updates an existing precedent in place when found', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ entity_id: 'ent-1' })
      .mockResolvedValueOnce({ id: 'p-1', treatment: 'LUX_17', times_used: 4 });

    mockQuery.mockResolvedValueOnce([
      { provider: 'Shell LU', country: 'LU', treatment: 'LUX_17', description: 'fuel', amount_eur: 50 },
    ]);
    mockExecute.mockResolvedValue(undefined);

    const report = await upsertPrecedentsFromDeclaration('d-1');
    expect(report.updated).toBe(1);
    expect(report.inserted).toBe(0);

    const sqls = mockExecute.mock.calls.map(c => c[0] as string);
    expect(sqls.some(s => /UPDATE precedents/.test(s))).toBe(true);
    // Treatment didn't change — no treatment audit expected
    expect(mockLogAudit).not.toHaveBeenCalled();
  });

  it('audits when the treatment changes on an existing precedent', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ entity_id: 'ent-1' })
      .mockResolvedValueOnce({ id: 'p-1', treatment: 'LUX_17', times_used: 2 });

    mockQuery.mockResolvedValueOnce([
      { provider: 'Shell LU', country: 'LU', treatment: 'LUX_8', description: null, amount_eur: null },
    ]);
    mockExecute.mockResolvedValue(undefined);

    await upsertPrecedentsFromDeclaration('d-1');
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'update',
      field: 'treatment',
      oldValue: 'LUX_17',
      newValue: 'LUX_8',
    }));
  });

  it('trims provider whitespace and uppercases country to 2 chars', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ entity_id: 'ent-1' })
      .mockResolvedValueOnce(null);

    mockQuery.mockResolvedValueOnce([
      { provider: '  Shell LU  ', country: 'lux', treatment: 'LUX_17', description: null, amount_eur: null },
    ]);
    mockExecute.mockResolvedValue(undefined);

    await upsertPrecedentsFromDeclaration('d-1');

    // First execute call is the INSERT — inspect params
    const insertParams = mockExecute.mock.calls.find(c => /INSERT INTO precedents/.test(c[0] as string))![1] as unknown[];
    expect(insertParams[2]).toBe('Shell LU'); // trimmed
    expect(insertParams[3]).toBe('LU');        // uppercased + 2 chars
  });

  it('treats null country as null (not empty string)', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ entity_id: 'ent-1' })
      .mockResolvedValueOnce(null);

    mockQuery.mockResolvedValueOnce([
      { provider: 'ForeignCo', country: null, treatment: 'OUT_SCOPE', description: null, amount_eur: null },
    ]);
    mockExecute.mockResolvedValue(undefined);

    await upsertPrecedentsFromDeclaration('d-1');

    const insertParams = mockExecute.mock.calls.find(c => /INSERT INTO precedents/.test(c[0] as string))![1] as unknown[];
    expect(insertParams[3]).toBe(null);
  });

  it('handles a mix of inserted / updated / skipped in one pass', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ entity_id: 'ent-1' })
      // line 1: no existing precedent
      .mockResolvedValueOnce(null)
      // line 2: existing
      .mockResolvedValueOnce({ id: 'p-2', treatment: 'LUX_17', times_used: 1 });

    mockQuery.mockResolvedValueOnce([
      { provider: 'NewVendor', country: 'DE', treatment: 'RC_EU', description: null, amount_eur: 10 },
      { provider: 'Shell LU',  country: 'LU', treatment: 'LUX_17', description: null, amount_eur: 20 },
      { provider: '',          country: 'LU', treatment: 'LUX_17', description: null, amount_eur: 5 },
    ]);
    mockExecute.mockResolvedValue(undefined);

    const report = await upsertPrecedentsFromDeclaration('d-1');
    expect(report).toEqual({
      inserted: 1, updated: 1, skipped: 1, total_lines_considered: 3,
    });
  });
});
