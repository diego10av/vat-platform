import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
  logAudit: vi.fn(),
  generateId: vi.fn(() => 'gen-1'),
}));

import { query, queryOne, execute } from '@/lib/db';
import { GET as listUsers, POST as createUser } from '@/app/api/users/route';
import { PATCH as patchUser, DELETE as deleteUser } from '@/app/api/users/[id]/route';
import { NextRequest } from 'next/server';

const mockQuery = query as unknown as ReturnType<typeof vi.fn>;
const mockQueryOne = queryOne as unknown as ReturnType<typeof vi.fn>;
const mockExecute = execute as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockQuery.mockReset();
  mockQueryOne.mockReset();
  mockExecute.mockReset();
});

function makePostRequest(body: unknown): NextRequest {
  return new NextRequest('https://example.com/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makePatchRequest(body: unknown): NextRequest {
  return new NextRequest('https://example.com/api/users/foo', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('GET /api/users', () => {
  it('returns users with monthly spend rolled up from api_calls', async () => {
    mockQuery
      .mockResolvedValueOnce([
        { id: 'u1', display_name: 'Alice', email: null, role: 'admin',
          monthly_ai_cap_eur: '5.00', created_at: 'x', updated_at: 'x', active: true },
        { id: 'u2', display_name: 'Bob',   email: null, role: 'member',
          monthly_ai_cap_eur: '2.00', created_at: 'x', updated_at: 'x', active: true },
      ])
      .mockResolvedValueOnce([
        { user_id: 'u1', total: '1.50' },
        { user_id: 'u2', total: '0.10' },
      ]);

    const res = await listUsers();
    const body = await res.json() as { users: Array<{ id: string; month_spend_eur: number; pct_used: number }> };
    expect(body.users).toHaveLength(2);
    expect(body.users[0]!.id).toBe('u1');
    expect(body.users[0]!.month_spend_eur).toBe(1.5);
    expect(body.users[0]!.pct_used).toBeCloseTo(0.3, 3);
    expect(body.users[1]!.month_spend_eur).toBe(0.1);
  });

  it('returns 501 schema_missing when users table does not exist', async () => {
    mockQuery.mockRejectedValueOnce(new Error(`relation "users" does not exist`));
    const res = await listUsers();
    expect(res.status).toBe(501);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('schema_missing');
  });

  it('reports zero spend for users with no api_calls', async () => {
    mockQuery
      .mockResolvedValueOnce([
        { id: 'u1', display_name: 'Alice', email: null, role: 'admin',
          monthly_ai_cap_eur: '2.00', created_at: 'x', updated_at: 'x', active: true },
      ])
      .mockResolvedValueOnce([]); // no spend rows

    const res = await listUsers();
    const body = await res.json() as { users: Array<{ month_spend_eur: number }> };
    expect(body.users[0]!.month_spend_eur).toBe(0);
  });
});

describe('POST /api/users', () => {
  it('rejects missing id', async () => {
    const res = await createUser(makePostRequest({ display_name: 'Bob' }));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('bad_id');
  });

  it('rejects missing display_name', async () => {
    const res = await createUser(makePostRequest({ id: 'bob' }));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('bad_display_name');
  });

  it('rejects ids with bad characters', async () => {
    const res = await createUser(makePostRequest({ id: 'bo b!', display_name: 'Bob' }));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('bad_id_format');
  });

  it('rejects malformed email', async () => {
    const res = await createUser(makePostRequest({
      id: 'bob', display_name: 'Bob', email: 'not-an-email',
    }));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('bad_email');
  });

  it('clamps cap to the [0, 100] range', async () => {
    mockExecute.mockResolvedValueOnce(undefined);
    mockQuery.mockResolvedValueOnce([{ id: 'bob' }]);

    await createUser(makePostRequest({
      id: 'bob', display_name: 'Bob', monthly_ai_cap_eur: 99999,
    }));
    const params = mockExecute.mock.calls[0]![1] as unknown[];
    expect(params[4]).toBe(100);
  });

  it('defaults role to member + cap to 2 when unspecified', async () => {
    mockExecute.mockResolvedValueOnce(undefined);
    mockQuery.mockResolvedValueOnce([{ id: 'bob' }]);

    await createUser(makePostRequest({ id: 'bob', display_name: 'Bob' }));
    const params = mockExecute.mock.calls[0]![1] as unknown[];
    expect(params[3]).toBe('member');
    expect(params[4]).toBe(2);
  });

  it('returns schema_missing on missing table', async () => {
    mockExecute.mockRejectedValueOnce(new Error(`relation "users" does not exist`));
    const res = await createUser(makePostRequest({ id: 'bob', display_name: 'Bob' }));
    expect(res.status).toBe(501);
  });
});

describe('PATCH /api/users/[id]', () => {
  const paramsOf = (id: string) => ({ params: Promise.resolve({ id }) });

  it('404s when user missing', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const res = await patchUser(makePatchRequest({ display_name: 'x' }), paramsOf('ghost'));
    expect(res.status).toBe(404);
  });

  it('rejects empty body (nothing to change)', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'foo', role: 'member', active: true });
    const res = await patchUser(makePatchRequest({}), paramsOf('foo'));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('no_changes');
  });

  it('rejects demoting the last admin', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 'alice', role: 'admin', active: true }) // existing
      .mockResolvedValueOnce({ n: '1' });                                   // admin count
    const res = await patchUser(makePatchRequest({ role: 'member' }), paramsOf('alice'));
    expect(res.status).toBe(409);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('last_admin');
  });

  it('allows demoting an admin when another exists', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 'alice', role: 'admin', active: true })
      .mockResolvedValueOnce({ n: '3' });
    mockExecute.mockResolvedValueOnce(undefined);

    const res = await patchUser(makePatchRequest({ role: 'member' }), paramsOf('alice'));
    expect(res.status).toBe(200);
  });

  it('rejects out-of-range cap', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'foo', role: 'member', active: true });
    const res = await patchUser(makePatchRequest({ monthly_ai_cap_eur: 9999 }), paramsOf('foo'));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('bad_cap');
  });

  it('rejects invalid role', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'foo', role: 'member', active: true });
    const res = await patchUser(makePatchRequest({ role: 'owner' }), paramsOf('foo'));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('bad_role');
  });

  it('updates cap within range', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'foo', role: 'member', active: true });
    mockExecute.mockResolvedValueOnce(undefined);
    const res = await patchUser(makePatchRequest({ monthly_ai_cap_eur: 10 }), paramsOf('foo'));
    expect(res.status).toBe(200);
  });
});

describe('DELETE /api/users/[id]', () => {
  const paramsOf = (id: string) => ({ params: Promise.resolve({ id }) });

  it('404s when user missing', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const res = await deleteUser(new NextRequest('https://x.test'), paramsOf('ghost'));
    expect(res.status).toBe(404);
  });

  it('returns already_inactive if already deactivated', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'foo', role: 'member', active: false });
    const res = await deleteUser(new NextRequest('https://x.test'), paramsOf('foo'));
    expect(res.status).toBe(200);
    const body = await res.json() as { already_inactive?: boolean };
    expect(body.already_inactive).toBe(true);
  });

  it('blocks deactivating the last admin', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 'alice', role: 'admin', active: true })
      .mockResolvedValueOnce({ n: '1' });
    const res = await deleteUser(new NextRequest('https://x.test'), paramsOf('alice'));
    expect(res.status).toBe(409);
  });

  it('deactivates a regular user', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'bob', role: 'member', active: true });
    mockExecute.mockResolvedValueOnce(undefined);
    const res = await deleteUser(new NextRequest('https://x.test'), paramsOf('bob'));
    expect(res.status).toBe(200);
  });
});
