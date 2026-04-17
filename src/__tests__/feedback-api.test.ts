import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
  logAudit: vi.fn(),
  generateId: vi.fn(() => 'gen-1'),
}));

import { query, queryOne, execute } from '@/lib/db';
import { POST as submitFeedback, GET as listFeedback } from '@/app/api/feedback/route';
import { PATCH as patchFeedback, DELETE as deleteFeedback } from '@/app/api/feedback/[id]/route';
import { NextRequest } from 'next/server';
import { __resetRateLimitForTests } from '@/lib/rate-limit';

const mockQuery = query as unknown as ReturnType<typeof vi.fn>;
const mockQueryOne = queryOne as unknown as ReturnType<typeof vi.fn>;
const mockExecute = execute as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockQuery.mockReset();
  mockQueryOne.mockReset();
  mockExecute.mockReset();
  __resetRateLimitForTests();
});

function postReq(body: unknown): NextRequest {
  return new NextRequest('https://example.com/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function patchReq(body: unknown): NextRequest {
  return new NextRequest('https://example.com/api/feedback/fb-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/feedback', () => {
  it('rejects missing category', async () => {
    const res = await submitFeedback(postReq({ message: 'x', url: 'https://x' }));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('bad_category');
  });

  it('rejects bad category', async () => {
    const res = await submitFeedback(postReq({
      message: 'x', url: 'https://x', category: 'malicious',
    }));
    expect(res.status).toBe(400);
  });

  it('rejects missing message', async () => {
    const res = await submitFeedback(postReq({
      category: 'bug', url: 'https://x',
    }));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('bad_message');
  });

  it('rejects overly long message', async () => {
    const res = await submitFeedback(postReq({
      category: 'bug', url: 'https://x',
      message: 'x'.repeat(6000),
    }));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('message_too_long');
  });

  it('rejects missing url', async () => {
    const res = await submitFeedback(postReq({
      category: 'bug', message: 'broken',
    }));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('bad_url');
  });

  it('persists with default severity=medium when omitted', async () => {
    mockExecute.mockResolvedValueOnce(undefined);
    const res = await submitFeedback(postReq({
      category: 'bug', message: 'broken', url: 'https://example.com/',
    }));
    expect(res.status).toBe(200);
    const params = mockExecute.mock.calls[0]![1] as unknown[];
    // severity is at param index 7 (id, user_id, url, entity_id, decl_id, ua, category, severity, ...)
    expect(params[7]).toBe('medium');
  });

  it('infers entity_id from /entities/[id] URL', async () => {
    mockExecute.mockResolvedValueOnce(undefined);
    await submitFeedback(postReq({
      category: 'bug', message: 'broken',
      url: 'http://localhost:3000/entities/ent-abc/?tab=decls',
    }));
    const params = mockExecute.mock.calls[0]![1] as unknown[];
    expect(params[3]).toBe('ent-abc'); // entity_id
    expect(params[4]).toBe(null);      // declaration_id
  });

  it('infers declaration_id from /declarations/[id] URL', async () => {
    mockExecute.mockResolvedValueOnce(undefined);
    await submitFeedback(postReq({
      category: 'bug', message: 'broken',
      url: 'http://localhost:3000/declarations/decl-xyz',
    }));
    const params = mockExecute.mock.calls[0]![1] as unknown[];
    expect(params[3]).toBe(null);       // entity_id
    expect(params[4]).toBe('decl-xyz'); // declaration_id
  });

  it('returns 501 schema_missing when feedback table missing', async () => {
    mockExecute.mockRejectedValueOnce(new Error(`relation "feedback" does not exist`));
    const res = await submitFeedback(postReq({
      category: 'bug', message: 'x', url: 'https://x',
    }));
    expect(res.status).toBe(501);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('schema_missing');
  });

  it('accepts all five valid categories', async () => {
    mockExecute.mockResolvedValue(undefined);
    for (const cat of ['bug', 'ux', 'feature', 'question', 'other']) {
      const res = await submitFeedback(postReq({
        category: cat, message: 'x', url: 'https://x',
      }));
      expect(res.status).toBe(200);
    }
  });

  it('truncates user_agent at 500 chars', async () => {
    mockExecute.mockResolvedValueOnce(undefined);
    await submitFeedback(postReq({
      category: 'bug', message: 'x', url: 'https://x',
      user_agent: 'a'.repeat(800),
    }));
    const params = mockExecute.mock.calls[0]![1] as unknown[];
    expect((params[5] as string).length).toBeLessThanOrEqual(500);
  });
});

describe('GET /api/feedback', () => {
  it('returns rows ordered by status then time', async () => {
    mockQuery.mockResolvedValueOnce([
      { id: 'fb-1', status: 'new', message: 'a' },
      { id: 'fb-2', status: 'triaged', message: 'b' },
    ]);
    const res = await listFeedback(new NextRequest('https://example.com/api/feedback'));
    expect(res.status).toBe(200);
    const body = await res.json() as { feedback: unknown[] };
    expect(body.feedback).toHaveLength(2);
  });

  it('filters by status when query param valid', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 'fb-1', status: 'new' }]);
    const res = await listFeedback(new NextRequest('https://example.com/api/feedback?status=new'));
    expect(res.status).toBe(200);
    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toContain('WHERE f.status = $1');
  });

  it('ignores invalid status filter', async () => {
    mockQuery.mockResolvedValueOnce([]);
    await listFeedback(new NextRequest('https://example.com/api/feedback?status=bogus'));
    const sql = mockQuery.mock.calls[0]![0] as string;
    // Falls through to the unfiltered query (ORDER BY CASE)
    expect(sql).toContain('ORDER BY');
    expect(sql).not.toContain('WHERE f.status');
  });

  it('returns empty list + schema_missing flag when table absent', async () => {
    mockQuery.mockRejectedValueOnce(new Error(`relation "feedback" does not exist`));
    const res = await listFeedback(new NextRequest('https://example.com/api/feedback'));
    expect(res.status).toBe(200);
    const body = await res.json() as { feedback: unknown[]; schema_missing?: boolean };
    expect(body.schema_missing).toBe(true);
    expect(body.feedback).toEqual([]);
  });
});

describe('PATCH /api/feedback/[id]', () => {
  const paramsOf = (id: string) => ({ params: Promise.resolve({ id }) });

  it('404 when not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const res = await patchFeedback(patchReq({ status: 'resolved' }), paramsOf('fb-ghost'));
    expect(res.status).toBe(404);
  });

  it('rejects invalid status', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'fb-1' });
    const res = await patchFeedback(patchReq({ status: 'done' }), paramsOf('fb-1'));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('bad_status');
  });

  it('sets resolved_at when marking resolved', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'fb-1' });
    mockExecute.mockResolvedValueOnce(undefined);
    await patchFeedback(patchReq({ status: 'resolved' }), paramsOf('fb-1'));
    const sql = mockExecute.mock.calls[0]![0] as string;
    expect(sql).toContain('resolved_at = NOW()');
  });

  it('accepts resolution_note and truncates at 2000 chars', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'fb-1' });
    mockExecute.mockResolvedValueOnce(undefined);
    const longNote = 'a'.repeat(3000);
    await patchFeedback(patchReq({ resolution_note: longNote }), paramsOf('fb-1'));
    const params = mockExecute.mock.calls[0]![1] as unknown[];
    expect((params[0] as string).length).toBe(2000);
  });

  it('rejects empty body', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'fb-1' });
    const res = await patchFeedback(patchReq({}), paramsOf('fb-1'));
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/feedback/[id]', () => {
  const paramsOf = (id: string) => ({ params: Promise.resolve({ id }) });

  it('404 when not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const res = await deleteFeedback(new NextRequest('https://x.test'), paramsOf('fb-ghost'));
    expect(res.status).toBe(404);
  });

  it('hard-deletes', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'fb-1' });
    mockExecute.mockResolvedValueOnce(undefined);
    const res = await deleteFeedback(new NextRequest('https://x.test'), paramsOf('fb-1'));
    expect(res.status).toBe(200);
    const sql = mockExecute.mock.calls[0]![0] as string;
    expect(sql).toMatch(/DELETE FROM feedback/);
  });
});
