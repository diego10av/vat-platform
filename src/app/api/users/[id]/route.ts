// ════════════════════════════════════════════════════════════════════════
// GET    /api/users/[id] — load one user
// PATCH  /api/users/[id] — update any of { display_name, email, role,
//                                          monthly_ai_cap_eur, active }
// DELETE /api/users/[id] — soft-delete (active = FALSE)
//
// Guardrail: refuse to deactivate the last active admin — without one,
// the firm would lock itself out of user management.
// ════════════════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { query, execute, queryOne, logAudit } from '@/lib/db';
import { apiError, apiOk, apiFail } from '@/lib/api-errors';
import { logger } from '@/lib/logger';

const log = logger.bind('users/[id]');

const VALID_ROLES = ['admin', 'member'] as const;
const MIN_CAP_EUR = 0;
const MAX_CAP_EUR = 100;

function isSchemaMissing(err: unknown): boolean {
  const msg = (err as { message?: string } | null)?.message ?? '';
  return /relation ["']?users["']? does not exist/i.test(msg);
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const user = await queryOne(
      `SELECT id, display_name, email, role,
              monthly_ai_cap_eur::float AS monthly_ai_cap_eur,
              created_at::text AS created_at,
              updated_at::text AS updated_at,
              active
         FROM users WHERE id = $1`,
      [id],
    );
    if (!user) return apiError('user_not_found', 'User not found.', { status: 404 });
    return apiOk({ user });
  } catch (err) {
    if (isSchemaMissing(err)) {
      return apiError('schema_missing', 'Run migration 001 first.', { status: 501 });
    }
    return apiFail(err, 'users/get');
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const existing = await queryOne<{ id: string; role: string; active: boolean }>(
      'SELECT id, role, active FROM users WHERE id = $1',
      [id],
    );
    if (!existing) return apiError('user_not_found', 'User not found.', { status: 404 });

    // Build a dynamic SET clause from the provided fields.
    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;

    if (typeof body.display_name === 'string') {
      const v = body.display_name.trim();
      if (!v) return apiError('bad_display_name', 'display_name cannot be empty.', { status: 400 });
      sets.push(`display_name = $${i++}`);
      vals.push(v);
    }

    if (body.email !== undefined) {
      const v = body.email === null || body.email === '' ? null : String(body.email).trim();
      if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
        return apiError('bad_email', 'email is not valid.', { status: 400 });
      }
      sets.push(`email = $${i++}`);
      vals.push(v);
    }

    if (typeof body.role === 'string') {
      if (!VALID_ROLES.includes(body.role as 'admin' | 'member')) {
        return apiError('bad_role', "role must be 'admin' or 'member'.", { status: 400 });
      }
      // Guardrail: refuse to demote the last admin.
      if (existing.role === 'admin' && body.role !== 'admin') {
        const adminCount = await queryOne<{ n: string }>(
          `SELECT COUNT(*)::text AS n FROM users WHERE role = 'admin' AND active = TRUE`,
        );
        if (Number(adminCount?.n) <= 1) {
          return apiError(
            'last_admin',
            'Cannot demote the last active admin. Promote someone else first.',
            { status: 409 },
          );
        }
      }
      sets.push(`role = $${i++}`);
      vals.push(body.role);
    }

    if (body.monthly_ai_cap_eur !== undefined) {
      const n = typeof body.monthly_ai_cap_eur === 'number' ? body.monthly_ai_cap_eur : NaN;
      if (!Number.isFinite(n) || n < MIN_CAP_EUR || n > MAX_CAP_EUR) {
        return apiError(
          'bad_cap',
          `monthly_ai_cap_eur must be a number between ${MIN_CAP_EUR} and ${MAX_CAP_EUR}.`,
          { status: 400 },
        );
      }
      sets.push(`monthly_ai_cap_eur = $${i++}`);
      vals.push(Math.round(n * 100) / 100);
    }

    if (typeof body.active === 'boolean') {
      // Guardrail: refuse to deactivate the last admin.
      if (existing.role === 'admin' && body.active === false) {
        const adminCount = await queryOne<{ n: string }>(
          `SELECT COUNT(*)::text AS n FROM users WHERE role = 'admin' AND active = TRUE`,
        );
        if (Number(adminCount?.n) <= 1) {
          return apiError(
            'last_admin',
            'Cannot deactivate the last active admin. Promote someone else first.',
            { status: 409 },
          );
        }
      }
      sets.push(`active = $${i++}`);
      vals.push(body.active);
    }

    if (sets.length === 0) {
      return apiError('no_changes', 'Nothing to update.', { status: 400 });
    }

    vals.push(id);
    await execute(`UPDATE users SET ${sets.join(', ')} WHERE id = $${i}`, vals);

    await logAudit({
      action: 'update_user',
      targetType: 'user',
      targetId: id,
      newValue: JSON.stringify(body),
    });

    log.info('user updated', { user_id: id, fields: Object.keys(body) });

    return apiOk({ ok: true });
  } catch (err) {
    if (isSchemaMissing(err)) {
      return apiError('schema_missing', 'Run migration 001 first.', { status: 501 });
    }
    return apiFail(err, 'users/patch');
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const existing = await queryOne<{ id: string; role: string; active: boolean }>(
      'SELECT id, role, active FROM users WHERE id = $1',
      [id],
    );
    if (!existing) return apiError('user_not_found', 'User not found.', { status: 404 });
    if (!existing.active) return apiOk({ already_inactive: true });

    if (existing.role === 'admin') {
      const adminCount = await queryOne<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM users WHERE role = 'admin' AND active = TRUE`,
      );
      if (Number(adminCount?.n) <= 1) {
        return apiError(
          'last_admin',
          'Cannot deactivate the last active admin. Promote someone else first.',
          { status: 409 },
        );
      }
    }

    await execute('UPDATE users SET active = FALSE WHERE id = $1', [id]);
    await logAudit({
      action: 'deactivate_user',
      targetType: 'user',
      targetId: id,
    });

    log.info('user deactivated', { user_id: id });
    return apiOk({ ok: true });
  } catch (err) {
    if (isSchemaMissing(err)) {
      return apiError('schema_missing', 'Run migration 001 first.', { status: 501 });
    }
    return apiFail(err, 'users/delete');
  }
}
