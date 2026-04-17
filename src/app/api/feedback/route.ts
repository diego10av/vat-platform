// ════════════════════════════════════════════════════════════════════════
// POST /api/feedback — submit feedback (any authed user)
// GET  /api/feedback — list all (admin triage)
//
// Tolerant of migration 002 not yet applied: POST returns a structured
// 501 `schema_missing` so the client can fall back to localStorage
// retry + message; GET returns empty list.
// ════════════════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { query, execute, generateId, logAudit } from '@/lib/db';
import { apiError, apiOk, apiFail } from '@/lib/api-errors';
import { checkRateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

const log = logger.bind('feedback');

const CATEGORIES = ['bug', 'ux', 'feature', 'question', 'other'] as const;
const SEVERITIES = ['low', 'medium', 'high'] as const;
const STATUSES = ['new', 'triaged', 'resolved', 'wontfix'] as const;

const MOCK_USER_ID = 'founder';

function isSchemaMissing(err: unknown): boolean {
  const msg = (err as { message?: string } | null)?.message ?? '';
  return /relation ["']?feedback["']? does not exist/i.test(msg);
}

/** Extract entity/declaration ids from a URL like /declarations/xyz. */
function inferContext(url: string): { entity_id: string | null; declaration_id: string | null } {
  try {
    const u = new URL(url, 'https://placeholder.local');
    const ent = u.pathname.match(/^\/entities\/([^/?#]+)/);
    const decl = u.pathname.match(/^\/declarations\/([^/?#]+)/);
    return {
      entity_id: ent?.[1] ?? null,
      declaration_id: decl?.[1] ?? null,
    };
  } catch {
    return { entity_id: null, declaration_id: null };
  }
}

export async function POST(request: NextRequest) {
  try {
    // Moderate rate limit — feedback is low-volume by nature, 10/min
    // per IP is plenty for any legitimate user and blocks automated
    // noise.
    const rl = checkRateLimit(request, { max: 10, windowMs: 60_000, scope: '/api/feedback' });
    if (!rl.ok) return rl.response;

    const body = (await request.json().catch(() => ({}))) as {
      url?: string;
      category?: string;
      severity?: string;
      message?: string;
      contact?: string;
      user_agent?: string;
    };

    const category = CATEGORIES.includes(body.category as typeof CATEGORIES[number])
      ? (body.category as typeof CATEGORIES[number])
      : null;
    const severity = SEVERITIES.includes(body.severity as typeof SEVERITIES[number])
      ? (body.severity as typeof SEVERITIES[number])
      : 'medium';
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    const url = typeof body.url === 'string' ? body.url : '';
    const contact = typeof body.contact === 'string' ? body.contact.trim() || null : null;
    const user_agent = typeof body.user_agent === 'string' ? body.user_agent.slice(0, 500) : null;

    if (!category) return apiError('bad_category', `category must be one of: ${CATEGORIES.join(', ')}`, { status: 400 });
    if (!message) return apiError('bad_message', 'message is required.', { status: 400 });
    if (message.length > 5000) return apiError('message_too_long', 'message max 5000 chars.', { status: 400 });
    if (!url) return apiError('bad_url', 'url is required.', { status: 400 });

    const ctx = inferContext(url);
    const id = `fb-${generateId().slice(0, 10)}`;

    await execute(
      `INSERT INTO feedback (id, user_id, url, entity_id, declaration_id, user_agent,
          category, severity, message, contact)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        id, MOCK_USER_ID, url, ctx.entity_id, ctx.declaration_id, user_agent,
        category, severity, message, contact,
      ],
    );

    await logAudit({
      userId: MOCK_USER_ID,
      action: 'submit_feedback',
      targetType: 'feedback',
      targetId: id,
      newValue: JSON.stringify({ category, severity, url, message_preview: message.slice(0, 120) }),
    });

    log.info('feedback submitted', {
      feedback_id: id, category, severity,
      entity_id: ctx.entity_id, declaration_id: ctx.declaration_id,
    });

    return apiOk({ ok: true, id });
  } catch (err) {
    if (isSchemaMissing(err)) {
      return apiError(
        'schema_missing',
        'Feedback table not yet created. Your message is saved locally and will be sent when the admin applies migration 002.',
        { hint: 'See migrations/002_feedback.sql', status: 501 },
      );
    }
    return apiFail(err, 'feedback/post');
  }
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const statusFilter = url.searchParams.get('status');
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 50)));

    const validStatuses = (STATUSES as readonly string[]);
    const filter = statusFilter && validStatuses.includes(statusFilter)
      ? statusFilter
      : null;

    const rows = await (filter
      ? query(
          `SELECT f.*, e.name AS entity_name
             FROM feedback f
             LEFT JOIN entities e ON f.entity_id = e.id
            WHERE f.status = $1
            ORDER BY f.created_at DESC
            LIMIT $2`,
          [filter, limit],
        )
      : query(
          `SELECT f.*, e.name AS entity_name
             FROM feedback f
             LEFT JOIN entities e ON f.entity_id = e.id
            ORDER BY
              CASE f.status
                WHEN 'new' THEN 0
                WHEN 'triaged' THEN 1
                WHEN 'resolved' THEN 2
                ELSE 3
              END,
              f.created_at DESC
            LIMIT $1`,
          [limit],
        )
    );

    return apiOk({ feedback: rows });
  } catch (err) {
    if (isSchemaMissing(err)) {
      return apiOk({ feedback: [], schema_missing: true });
    }
    return apiFail(err, 'feedback/list');
  }
}
