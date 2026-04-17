// ════════════════════════════════════════════════════════════════════════
// GET  /api/users — list all active users with their current-month spend.
// POST /api/users — create a new user.
//
// The users table comes from migration 001. If the table doesn't exist
// yet we return a structured `schema_missing` error so the UI can say
// "apply migration 001 first" instead of crashing.
// ════════════════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { query, execute, logAudit } from '@/lib/db';
import { apiError, apiOk, apiFail } from '@/lib/api-errors';
import { logger } from '@/lib/logger';

const log = logger.bind('users');

const VALID_ROLES = ['admin', 'member'] as const;
const MIN_CAP_EUR = 0;
const MAX_CAP_EUR = 100;

interface UserRow {
  id: string;
  display_name: string;
  email: string | null;
  role: 'admin' | 'member';
  monthly_ai_cap_eur: number;
  created_at: string;
  updated_at: string;
  active: boolean;
}

interface UserWithSpend extends UserRow {
  month_spend_eur: number;
  pct_used: number;
}

function isSchemaMissing(err: unknown): boolean {
  const msg = (err as { message?: string } | null)?.message ?? '';
  return /relation ["']?users["']? does not exist/i.test(msg);
}

export async function GET() {
  try {
    const users = await query<UserRow & { monthly_ai_cap_eur: string | number }>(
      `SELECT id, display_name, email, role,
              monthly_ai_cap_eur::float AS monthly_ai_cap_eur,
              created_at::text AS created_at,
              updated_at::text AS updated_at,
              active
         FROM users
        WHERE active = TRUE
        ORDER BY role DESC, created_at ASC`,
    );

    // Bolt on the current-month spend for each user. Single query, not
    // N+1: GROUP BY user_id.
    const spend = await query<{ user_id: string; total: string | number | null }>(
      `SELECT user_id, COALESCE(SUM(cost_eur), 0)::float AS total
         FROM api_calls
        WHERE created_at >= date_trunc('month', NOW())
          AND status != 'error'
        GROUP BY user_id`,
    );
    const spendMap = new Map<string, number>();
    for (const row of spend) {
      spendMap.set(row.user_id, Number(row.total) || 0);
    }

    const enriched: UserWithSpend[] = users.map((u) => {
      const cap = Number(u.monthly_ai_cap_eur) || 0;
      const spent = spendMap.get(u.id) || 0;
      return {
        ...u,
        monthly_ai_cap_eur: cap,
        month_spend_eur: Math.round(spent * 100) / 100,
        pct_used: cap > 0 ? Math.round((spent / cap) * 1000) / 1000 : 0,
      };
    });

    return apiOk({ users: enriched });
  } catch (err) {
    if (isSchemaMissing(err)) {
      return apiError(
        'schema_missing',
        'The users table does not exist yet. Apply migration 001 in the Supabase SQL Editor.',
        { hint: 'See migrations/001_per_user_ai_budget_and_chat.sql', status: 501 },
      );
    }
    return apiFail(err, 'users/list');
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      id?: string;
      display_name?: string;
      email?: string | null;
      role?: string;
      monthly_ai_cap_eur?: number;
    };

    const id = typeof body.id === 'string' ? body.id.trim() : '';
    const displayName = typeof body.display_name === 'string' ? body.display_name.trim() : '';
    const email = body.email ? String(body.email).trim() || null : null;
    const role = VALID_ROLES.includes(body.role as 'admin' | 'member')
      ? (body.role as 'admin' | 'member')
      : 'member';

    if (!id) return apiError('bad_id', 'id is required.', { status: 400 });
    if (!displayName) return apiError('bad_display_name', 'display_name is required.', { status: 400 });
    if (!/^[a-z0-9_-]{2,40}$/i.test(id)) {
      return apiError(
        'bad_id_format',
        'id must be 2–40 chars, letters/digits/_/- only.',
        { status: 400 },
      );
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return apiError('bad_email', 'email is not valid.', { status: 400 });
    }

    const cap = clampCap(body.monthly_ai_cap_eur);

    await execute(
      `INSERT INTO users (id, display_name, email, role, monthly_ai_cap_eur)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [id, displayName, email, role, cap],
    );

    // Check if the insert actually created a row (vs. ON CONFLICT path).
    const existing = await query<UserRow>(
      'SELECT id FROM users WHERE id = $1',
      [id],
    );
    const created = existing.length > 0;

    await logAudit({
      action: 'create_user',
      targetType: 'user',
      targetId: id,
      newValue: JSON.stringify({ display_name: displayName, email, role, monthly_ai_cap_eur: cap }),
    });

    log.info('user created', { user_id: id, role, cap_eur: cap });

    return apiOk({ ok: created, id });
  } catch (err) {
    if (isSchemaMissing(err)) {
      return apiError(
        'schema_missing',
        'The users table does not exist yet. Apply migration 001 in the Supabase SQL Editor.',
        { hint: 'See migrations/001_per_user_ai_budget_and_chat.sql', status: 501 },
      );
    }
    return apiFail(err, 'users/create');
  }
}

function clampCap(raw: unknown): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : 2;
  return Math.min(MAX_CAP_EUR, Math.max(MIN_CAP_EUR, Math.round(n * 100) / 100));
}
