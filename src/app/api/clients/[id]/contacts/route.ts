// ════════════════════════════════════════════════════════════════════════
// GET  /api/clients/[id]/contacts — list all contacts for this client
// POST /api/clients/[id]/contacts — create a new contact
//
// Multi-contact per client (stint 11, 2026-04-19). Each client can have
// a main contact + N additional CCs. Entity approvers can link to a
// client_contact via entity_approvers.client_contact_id so the same
// fund manager is re-usable across every entity under the client.
// ════════════════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { query, queryOne, execute, logAudit } from '@/lib/db';
import { apiError, apiOk, apiFail } from '@/lib/api-errors';
import { logger } from '@/lib/logger';

const log = logger.bind('client-contacts');

function isSchemaMissing(err: unknown): boolean {
  const msg = (err as { message?: string } | null)?.message ?? '';
  return /relation ["']?client_contacts["']? does not exist/i.test(msg);
}

function generateId(): string {
  // Short id prefixed for scanability in the DB.
  const rand = Math.random().toString(36).slice(2, 10);
  return `cc-${Date.now().toString(36)}${rand}`;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const rows = await query(
      `SELECT id, client_id, name, email, phone, role, organization, country,
              is_main, notes,
              created_at::text AS created_at,
              updated_at::text AS updated_at
         FROM client_contacts
        WHERE client_id = $1
        ORDER BY is_main DESC, lower(name) ASC`,
      [id],
    );
    return apiOk({ contacts: rows });
  } catch (err) {
    if (isSchemaMissing(err)) {
      return apiError('schema_missing', 'Apply migration 012 first.', { status: 501 });
    }
    return apiFail(err, 'client-contacts/list');
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    // Client must exist
    const clientRow = await queryOne<{ id: string }>(
      'SELECT id FROM clients WHERE id = $1',
      [id],
    );
    if (!clientRow) return apiError('not_found', 'Client not found.', { status: 404 });

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return apiError('bad_name', 'name is required.', { status: 400 });

    const contactId = generateId();
    const email = typeof body.email === 'string' ? body.email.trim() || null : null;
    const phone = typeof body.phone === 'string' ? body.phone.trim() || null : null;
    const role = typeof body.role === 'string' ? body.role.trim() || null : null;
    const organization = typeof body.organization === 'string' ? body.organization.trim() || null : null;
    const country = typeof body.country === 'string' ? body.country.trim().toUpperCase().slice(0, 2) || null : null;
    const notes = typeof body.notes === 'string' ? body.notes.trim() || null : null;
    const isMainRaw = body.is_main;
    const isMain = isMainRaw === true;

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return apiError('bad_email', 'email is invalid.', { status: 400 });
    }

    // If requesting is_main=true, demote any existing main for this client.
    if (isMain) {
      await execute(
        `UPDATE client_contacts SET is_main = FALSE WHERE client_id = $1 AND is_main = TRUE`,
        [id],
      );
    }

    await execute(
      `INSERT INTO client_contacts (id, client_id, name, email, phone, role, organization, country, is_main, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [contactId, id, name, email, phone, role, organization, country, isMain, notes],
    );

    await logAudit({
      action: 'create',
      targetType: 'client_contact',
      targetId: contactId,
      newValue: JSON.stringify({ client_id: id, name, email, is_main: isMain }),
    });

    log.info('client contact created', { contact_id: contactId, client_id: id });
    return apiOk({ id: contactId });
  } catch (err) {
    if (isSchemaMissing(err)) {
      return apiError('schema_missing', 'Apply migration 012 first.', { status: 501 });
    }
    return apiFail(err, 'client-contacts/create');
  }
}
