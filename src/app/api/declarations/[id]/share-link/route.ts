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
  approver_role: 'approver' | 'cc' | 'both';
  is_primary: boolean;
}

interface EngagedViaSlim {
  engaged_via_name: string | null;
  engaged_via_contact_name: string | null;
  engaged_via_contact_email: string | null;
  engaged_via_contact_role: string | null;
}

/**
 * Fetch approvers for the entity behind a declaration. Tolerant of
 * migration 005 / 016 not applied — returns empty list silently so
 * the share-link endpoint still issues a token.
 */
async function loadApprovers(declarationId: string): Promise<ApproverSlim[]> {
  try {
    return await query<ApproverSlim>(
      `SELECT a.id, a.name, a.email, a.role, a.organization,
              a.country, a.approver_type, a.approver_role, a.is_primary
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
    // Fallback for pre-migration-016 schemas: retry without approver_role.
    if (/column.*approver_role.*does not exist/i.test(msg)) {
      const legacy = await query<Omit<ApproverSlim, 'approver_role'>>(
        `SELECT a.id, a.name, a.email, a.role, a.organization,
                a.country, a.approver_type, a.is_primary
           FROM entity_approvers a
           JOIN declarations d ON a.entity_id = d.entity_id
          WHERE d.id = $1
          ORDER BY a.is_primary DESC, a.sort_order ASC, lower(a.name) ASC`,
        [declarationId],
      );
      return legacy.map(a => ({ ...a, approver_role: 'approver' as const }));
    }
    throw err;
  }
}

/**
 * Fetch the engaged-via intermediary for this declaration's client,
 * if any. Returns null when the client has no intermediary or when
 * the migration 016 columns don't exist.
 */
async function loadEngagedVia(declarationId: string): Promise<EngagedViaSlim | null> {
  try {
    return await queryOne<EngagedViaSlim>(
      `SELECT c.engaged_via_name, c.engaged_via_contact_name,
              c.engaged_via_contact_email, c.engaged_via_contact_role
         FROM clients c
         JOIN entities e ON e.client_id = c.id
         JOIN declarations d ON d.entity_id = e.id
        WHERE d.id = $1
          AND c.engaged_via_name IS NOT NULL`,
      [declarationId],
    );
  } catch {
    return null;
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

    // Approvers + engaged-via contact. Post-migration-016 we distinguish
    // approver_role ∈ {'approver', 'cc', 'both'}:
    //   - To:  is_primary === true AND approver_role in ('approver','both')
    //          (fallback: any approver with email when no explicit primary)
    //   - Cc:  everyone else with an email whose role permits CC
    //          ('cc' or 'both'), plus the engaged-via intermediary email
    //          if present.
    const approvers = await loadApprovers(id);
    const engagedVia = await loadEngagedVia(id);

    const approversWithEmail = approvers.filter(a => !!a.email);
    const primaryCandidate = approversWithEmail.find(a =>
      a.is_primary && (a.approver_role === 'approver' || a.approver_role === 'both'),
    )
      ?? approversWithEmail.find(a => a.is_primary)
      ?? approversWithEmail.find(a => a.approver_role === 'approver' || a.approver_role === 'both')
      ?? approversWithEmail[0]
      ?? null;

    const ccs = approversWithEmail.filter(a => {
      if (primaryCandidate && a.id === primaryCandidate.id) return false;
      return a.approver_role === 'cc' || a.approver_role === 'both';
    });
    const ccEmails = ccs.map(a => a.email!).filter(Boolean);

    // Include the intermediary contact (JTC-type) as an additional CC
    // when present. The reviewer can remove it from the mailto before
    // sending.
    if (engagedVia?.engaged_via_contact_email
        && engagedVia.engaged_via_contact_email !== primaryCandidate?.email
        && !ccEmails.includes(engagedVia.engaged_via_contact_email)) {
      ccEmails.push(engagedVia.engaged_via_contact_email);
    }

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
      primary_email: primaryCandidate?.email ?? null,
      cc_emails: ccEmails,
      engaged_via: engagedVia,
    });
  } catch (e) {
    return apiFail(e, 'declarations/share-link');
  }
}
