// ════════════════════════════════════════════════════════════════════════
// GET  /api/entities/[id]/approvers — list approvers for an entity
// POST /api/entities/[id]/approvers — add a new approver
//
// An approver is someone who must sign off on this entity's VAT
// declarations. Diego's Avallon example: one director from the CSP
// based in LU + the head of finance at the client HQ in Poland. Both
// need to be reachable fast — hence the rich contact payload
// (name, email, phone, role, organization, country, type).
// ════════════════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { query, queryOne, execute, generateId, logAudit } from '@/lib/db';
import { apiError, apiOk, apiFail } from '@/lib/api-errors';

const VALID_TYPES = ['client', 'csp', 'other'] as const;

function isSchemaMissing(err: unknown): boolean {
  const msg = (err as { message?: string } | null)?.message ?? '';
  return /relation ["']?entity_approvers["']? does not exist/i.test(msg);
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const rows = await query(
      `SELECT id, entity_id, name, email, phone, role,
              organization, country, approver_type, is_primary,
              sort_order, notes, client_contact_id,
              created_at::text AS created_at,
              updated_at::text AS updated_at
         FROM entity_approvers
        WHERE entity_id = $1
        ORDER BY is_primary DESC, sort_order ASC, lower(name) ASC`,
      [id],
    );
    return apiOk({ approvers: rows });
  } catch (err) {
    if (isSchemaMissing(err)) {
      return apiOk({ approvers: [], schema_missing: true });
    }
    return apiFail(err, 'approvers/list');
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: entityId } = await params;

    const entity = await queryOne<{ id: string }>(
      'SELECT id FROM entities WHERE id = $1',
      [entityId],
    );
    if (!entity) return apiError('entity_not_found', 'Entity not found.', { status: 404 });

    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      email?: string | null;
      phone?: string | null;
      role?: string | null;
      organization?: string | null;
      country?: string | null;
      approver_type?: string;
      is_primary?: boolean;
      notes?: string | null;
      client_contact_id?: string | null;  // stint 11 — reuse a client_contact
    };

    // If client_contact_id is supplied, pre-fill missing fields from the
    // stored contact. The reviewer can still override any field; the FK
    // just records the origin for future syncing.
    let clientContactId: string | null = null;
    if (typeof body.client_contact_id === 'string' && body.client_contact_id.trim()) {
      clientContactId = body.client_contact_id.trim();
      try {
        const cc = await queryOne<{
          name: string | null; email: string | null; phone: string | null;
          role: string | null; organization: string | null; country: string | null;
        }>(
          `SELECT name, email, phone, role, organization, country
             FROM client_contacts WHERE id = $1`,
          [clientContactId],
        );
        if (cc) {
          body.name = body.name ?? cc.name ?? undefined;
          body.email = body.email ?? cc.email;
          body.phone = body.phone ?? cc.phone;
          body.role = body.role ?? cc.role;
          body.organization = body.organization ?? cc.organization;
          body.country = body.country ?? cc.country;
        }
      } catch {
        // client_contacts table might not exist (migration 012 not run) —
        // fall through with whatever was in the body.
      }
    }

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return apiError('bad_name', 'Approver name is required.', { status: 400 });

    const email = typeof body.email === 'string' ? body.email.trim() || null : null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return apiError('bad_email', 'email is invalid.', { status: 400 });
    }

    const approverType = (VALID_TYPES as readonly string[]).includes(body.approver_type ?? '')
      ? (body.approver_type as typeof VALID_TYPES[number])
      : 'client';

    const isPrimary = body.is_primary === true;

    // Enforce one-primary-per-entity at the application level in addition
    // to the DB partial-unique index. Give a friendlier error when the
    // user ticks the box for a second approver — offer to demote the
    // current one.
    if (isPrimary) {
      const current = await queryOne<{ id: string; name: string }>(
        `SELECT id, name FROM entity_approvers
          WHERE entity_id = $1 AND is_primary = TRUE`,
        [entityId],
      );
      if (current) {
        return apiError(
          'primary_exists',
          `${current.name} is already the primary approver. Demote them first or leave this one as secondary.`,
          { hint: current.id, status: 409 },
        );
      }
    }

    // Determine sort_order: primary gets 0, rest appended.
    let sortOrder = 0;
    if (!isPrimary) {
      const max = await queryOne<{ m: number | null }>(
        `SELECT MAX(sort_order) AS m FROM entity_approvers WHERE entity_id = $1`,
        [entityId],
      );
      sortOrder = Number(max?.m ?? 0) + 1;
    }

    const id = `appr-${generateId().slice(0, 10)}`;
    await execute(
      `INSERT INTO entity_approvers
         (id, entity_id, name, email, phone, role, organization,
          country, approver_type, is_primary, sort_order, notes,
          client_contact_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        id, entityId, name, email,
        body.phone?.trim() || null,
        body.role?.trim() || null,
        body.organization?.trim() || null,
        body.country?.trim()?.toUpperCase().slice(0, 2) || null,
        approverType,
        isPrimary,
        sortOrder,
        body.notes?.trim() || null,
        clientContactId,
      ],
    );

    await logAudit({
      entityId,
      action: 'add_approver',
      targetType: 'entity_approver',
      targetId: id,
      newValue: JSON.stringify({ name, email, approver_type: approverType, is_primary: isPrimary }),
    });

    return apiOk({ id, name, is_primary: isPrimary });
  } catch (err) {
    if (isSchemaMissing(err)) {
      return apiError('schema_missing', 'Apply migration 005 first.', { status: 501 });
    }
    return apiFail(err, 'approvers/create');
  }
}
