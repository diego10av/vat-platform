// ════════════════════════════════════════════════════════════════════════
// POST /api/declarations/[id]/share-link
//
// Generates a signed, expiring URL the reviewer can send to the fund
// manager for approval. No login required on the receiving end —
// `/portal/[token]` validates the signature + expiry.
//
// Body (optional):
//   { expiry_days?: number }   // 1 → 30, default 7
//
// Returns:
//   { url, expires_at, nonce }
//
// Gates:
//   - Rate-limited (5/min per IP).
//   - Only issues links for declarations in 'review' status. Approved,
//     filed, or paid declarations don't need a link.
// ════════════════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { queryOne, query, logAudit } from '@/lib/db';
import { apiError, apiOk, apiFail } from '@/lib/api-errors';
import { checkRateLimit } from '@/lib/rate-limit';
import { issueApprovalToken, DEFAULT_EXPIRY_DAYS } from '@/lib/approval-tokens';
import { logger } from '@/lib/logger';

const log = logger.bind('declarations/share-link');

interface ApproverSlim {
  id: string;
  name: string;
  email: string | null;
  role: string | null;
  organization: string | null;
  country: string | null;
  approver_type: 'client' | 'csp' | 'other';
  is_primary: boolean;
}

/**
 * Fetch approvers for the entity behind a declaration. Tolerant of
 * migration 005 not applied — returns empty list silently so the
 * share-link endpoint still issues a token.
 */
async function loadApprovers(declarationId: string): Promise<ApproverSlim[]> {
  try {
    return await query<ApproverSlim>(
      `SELECT a.id, a.name, a.email, a.role, a.organization,
              a.country, a.approver_type, a.is_primary
         FROM entity_approvers a
         JOIN declarations d ON a.entity_id = d.entity_id
        WHERE d.id = $1
        ORDER BY a.is_primary DESC, a.sort_order ASC, lower(a.name) ASC`,
      [declarationId],
    );
  } catch (err) {
    const msg = (err as { message?: string } | null)?.message ?? '';
    if (/relation ["']?entity_approvers["']? does not exist/i.test(msg)) {
      return [];
    }
    throw err;
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const rl = checkRateLimit(request, { max: 5, windowMs: 60_000 });
    if (!rl.ok) return rl.response;

    const { id } = await params;

    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const expiryDays = typeof body.expiry_days === 'number' && body.expiry_days > 0
      ? Math.min(30, Math.max(1, Math.floor(body.expiry_days)))
      : DEFAULT_EXPIRY_DAYS;

    const decl = await queryOne<{ id: string; status: string }>(
      'SELECT id, status FROM declarations WHERE id = $1',
      [id],
    );
    if (!decl) {
      return apiError('declaration_not_found', 'Declaration not found.', { status: 404 });
    }
    if (decl.status !== 'review') {
      return apiError(
        'wrong_status',
        `Share links are only issued for declarations in 'review'. This one is '${decl.status}'.`,
        { hint: 'Reopen the declaration first, or share the filing reference instead.', status: 409 },
      );
    }

    const { token, payload } = await issueApprovalToken({
      declarationId: id,
      issuedBy: 'founder',
      expiryDays,
    });

    const origin = request.nextUrl.origin;
    const url = `${origin}/portal/${token}`;

    // Approvers come from entity_approvers (migration 005). The modal
    // renders them so the reviewer sees exactly who will get the link,
    // and the "Open in mail client" button pre-fills To / Cc with the
    // primary / rest.
    const approvers = await loadApprovers(id);
    const primary = approvers.find(a => a.is_primary && a.email) ?? null;
    const ccs = approvers.filter(a => !a.is_primary && a.email);

    await logAudit({
      action: 'issue_share_link',
      targetType: 'declaration',
      targetId: id,
      declarationId: id,
      newValue: JSON.stringify({
        nonce: payload.nonce,
        expires_at: payload.exp,
        expiry_days: expiryDays,
        approver_count: approvers.length,
      }),
    });

    log.info('share link issued', {
      declaration_id: id,
      expires_at: payload.exp,
      nonce: payload.nonce,
      approvers: approvers.length,
    });

    return apiOk({
      url,
      token,
      expires_at: new Date(payload.exp * 1000).toISOString(),
      expires_at_unix: payload.exp,
      nonce: payload.nonce,
      expiry_days: expiryDays,
      approvers,
      primary_email: primary?.email ?? null,
      cc_emails: ccs.map(a => a.email!).filter(Boolean),
    });
  } catch (e) {
    return apiFail(e, 'declarations/share-link');
  }
}
