// ════════════════════════════════════════════════════════════════════════
// GET /api/portal/[token]
//
// Public endpoint — reads a declaration via a signed approval token.
// Returns a minimal read-only summary appropriate for a client who is
// NOT logged into cifra. No provider-by-provider breakdown, no internal
// notes, no audit trail. Just: entity, period, total VAT due, line count.
//
// Middleware must allowlist /api/portal/* (see src/middleware.ts).
// ════════════════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { queryOne } from '@/lib/db';
import { apiError, apiOk, apiFail } from '@/lib/api-errors';
import { verifyApprovalToken } from '@/lib/approval-tokens';
import { checkRateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

const log = logger.bind('portal/token');

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    // Rate limit: public endpoint, tighter limit. 20/min per IP.
    const rl = checkRateLimit(request, { max: 20, windowMs: 60_000, scope: '/api/portal' });
    if (!rl.ok) return rl.response;

    const { token } = await params;

    const verified = await verifyApprovalToken(token);
    if (!verified.ok) {
      log.warn('portal token rejected', { reason: verified.reason });
      return apiError(
        `token_${verified.reason}`,
        tokenRejectionMessage(verified.reason),
        { status: 401 },
      );
    }

    const declId = verified.payload.decl_id;

    const decl = await queryOne<{
      id: string;
      year: number;
      period: string;
      status: string;
      entity_name: string;
      vat_number: string | null;
      matricule: string | null;
    }>(
      `SELECT d.id, d.year, d.period, d.status, e.name AS entity_name,
              e.vat_number, e.matricule
         FROM declarations d
         JOIN entities e ON d.entity_id = e.id
        WHERE d.id = $1`,
      [declId],
    );
    if (!decl) {
      return apiError('declaration_not_found', 'Declaration not found.', { status: 404 });
    }

    // Aggregate summary — only totals, no line-level detail.
    const summary = await queryOne<{
      line_count: string;
      total_ex_vat: number | null;
      total_vat: number | null;
    }>(
      `SELECT COUNT(*)::text AS line_count,
              COALESCE(SUM(l.amount_eur), 0)::float AS total_ex_vat,
              COALESCE(SUM(l.vat_applied), 0)::float AS total_vat
         FROM invoice_lines l
         JOIN invoices i ON l.invoice_id = i.id
        WHERE i.declaration_id = $1 AND l.state != 'deleted'`,
      [declId],
    );

    // Was this declaration already approved via the portal?
    // Look for a 'portal_approve' audit row.
    const approvedRow = await queryOne<{ created_at: string; new_value: string | null }>(
      `SELECT created_at, new_value
         FROM audit_log
        WHERE target_type = 'declaration'
          AND target_id = $1
          AND action = 'portal_approve'
        ORDER BY created_at DESC
        LIMIT 1`,
      [declId],
    );

    return apiOk({
      token_valid: true,
      expires_at_unix: verified.payload.exp,
      declaration: {
        id: decl.id,
        year: decl.year,
        period: decl.period,
        status: decl.status,
        entity_name: decl.entity_name,
        vat_number: decl.vat_number,
        matricule: decl.matricule,
      },
      summary: {
        line_count: Number(summary?.line_count ?? 0),
        total_ex_vat: Number(summary?.total_ex_vat ?? 0),
        total_vat: Number(summary?.total_vat ?? 0),
      },
      already_approved_via_portal: !!approvedRow,
      approved_at: approvedRow?.created_at ?? null,
    });
  } catch (e) {
    return apiFail(e, 'portal/token');
  }
}

function tokenRejectionMessage(reason: string): string {
  switch (reason) {
    case 'expired':         return 'This approval link has expired. Please ask the sender for a fresh link.';
    case 'malformed':       return 'This link is malformed. Please use the exact URL you were sent.';
    case 'bad_signature':   return 'This link has been tampered with or the server secret has rotated.';
    case 'invalid_payload': return 'This link cannot be read. Please ask the sender for a fresh link.';
    case 'no_secret':       return 'Approval portal is not configured on the server.';
    default:                return 'This link is not valid.';
  }
}
