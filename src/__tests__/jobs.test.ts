import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  queryOne: vi.fn(),
  execute: vi.fn(),
  generateId: vi.fn(() => 'job-test-id'),
}));

import { queryOne, execute } from '@/lib/db';
import {
  createJob, updateJob, finishJob, getJob, isCancelRequested, requestCancel,
} from '@/lib/jobs';

const mockQueryOne = queryOne as unknown as ReturnType<typeof vi.fn>;
const mockExecute = execute as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockQueryOne.mockReset();
  mockExecute.mockReset();
});

describe('createJob', () => {
  it('writes a running job row with defaults', async () => {
    mockExecute.mockResolvedValueOnce(undefined);
    const id = await createJob({ kind: 'extract' });

    expect(id).toBe('job-test-id');
    expect(mockExecute).toHaveBeenCalledTimes(1);
    const [sql, params] = mockExecute.mock.calls[0]!;
    expect(sql).toMatch(/INSERT INTO jobs/);
    expect(params).toEqual([
      'job-test-id',
      null,     // no declaration_id passed
      'extract',
      0,        // default total
    ]);
  });

  it('carries declaration_id + total through when provided', async () => {
    mockExecute.mockResolvedValueOnce(undefined);
    await createJob({ kind: 'classify', declaration_id: 'd-1', total: 42 });

    const params = mockExecute.mock.calls[0]![1] as unknown[];
    expect(params[1]).toBe('d-1');
    expect(params[3]).toBe(42);
  });

  it('accepts each JobKind without complaint', async () => {
    mockExecute.mockResolvedValue(undefined);
    await createJob({ kind: 'extract' });
    await createJob({ kind: 'classify' });
    await createJob({ kind: 'fill_fx' });
    expect(mockExecute).toHaveBeenCalledTimes(3);
  });
});

describe('updateJob', () => {
  it('builds a dynamic UPDATE with only the provided fields', async () => {
    mockExecute.mockResolvedValueOnce(undefined);
    await updateJob('job-1', { processed: 5, current_item: 'doc.pdf' });

    const [sql, params] = mockExecute.mock.calls[0]!;
    expect(sql).toMatch(/UPDATE jobs SET/);
    // 2 provided fields + updated_at. Values: 5, "doc.pdf", id. id is the last parameter.
    expect(params).toEqual([5, 'doc.pdf', 'job-1']);
    expect(sql).toMatch(/processed = \$1/);
    expect(sql).toMatch(/current_item = \$2/);
    expect(sql).toMatch(/updated_at = NOW\(\)/);
    expect(sql).toMatch(/WHERE id = \$3/);
  });

  it('skips undefined fields entirely', async () => {
    mockExecute.mockResolvedValueOnce(undefined);
    await updateJob('job-1', { processed: 3, current_item: undefined, message: undefined });

    const [sql, params] = mockExecute.mock.calls[0]!;
    expect(sql).not.toMatch(/current_item/);
    expect(sql).not.toMatch(/message/);
    expect(params).toEqual([3, 'job-1']);
  });

  it('converts Date instances for finished_at', async () => {
    mockExecute.mockResolvedValueOnce(undefined);
    const when = new Date('2026-04-18T08:00:00Z');
    await updateJob('job-1', { finished_at: when });

    const [sql, params] = mockExecute.mock.calls[0]!;
    expect(sql).toMatch(/finished_at = \$1::timestamptz/);
    expect(params[0]).toBe(when.toISOString());
  });

  it('handles null finished_at (resetting)', async () => {
    mockExecute.mockResolvedValueOnce(undefined);
    await updateJob('job-1', { finished_at: null });
    const params = mockExecute.mock.calls[0]![1] as unknown[];
    expect(params[0]).toBe(null);
  });
});

describe('finishJob', () => {
  it('sets status + timestamp + optional messages', async () => {
    mockExecute.mockResolvedValueOnce(undefined);
    await finishJob('job-1', 'done');

    const [sql, params] = mockExecute.mock.calls[0]!;
    expect(sql).toMatch(/finished_at = NOW\(\)/);
    expect(params).toEqual(['done', null, null, 'job-1']);
  });

  it('passes through an error message', async () => {
    mockExecute.mockResolvedValueOnce(undefined);
    await finishJob('job-1', 'error', 'crashed', 'TypeError: oops');
    const params = mockExecute.mock.calls[0]![1] as unknown[];
    expect(params).toEqual(['error', 'crashed', 'TypeError: oops', 'job-1']);
  });
});

describe('getJob', () => {
  it('returns the row or null', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'job-1', kind: 'extract', status: 'running' });
    const j = await getJob('job-1');
    expect(j?.id).toBe('job-1');

    mockQueryOne.mockResolvedValueOnce(null);
    expect(await getJob('missing')).toBe(null);
  });
});

describe('isCancelRequested', () => {
  it('is true when the flag is set', async () => {
    mockQueryOne.mockResolvedValueOnce({ cancel_requested: true });
    expect(await isCancelRequested('job-1')).toBe(true);
  });

  it('is false when flag is false or row is missing', async () => {
    mockQueryOne.mockResolvedValueOnce({ cancel_requested: false });
    expect(await isCancelRequested('job-1')).toBe(false);

    mockQueryOne.mockResolvedValueOnce(null);
    expect(await isCancelRequested('missing')).toBe(false);
  });
});

describe('requestCancel', () => {
  it('flips the flag on the given id', async () => {
    mockExecute.mockResolvedValueOnce(undefined);
    await requestCancel('job-1');
    const [sql, params] = mockExecute.mock.calls[0]!;
    expect(sql).toMatch(/cancel_requested = TRUE/);
    expect(params).toEqual(['job-1']);
  });
});
