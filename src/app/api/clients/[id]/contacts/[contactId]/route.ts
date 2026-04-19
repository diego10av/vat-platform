// ════════════════════════════════════════════════════════════════════════
// PATCH  /api/clients/[id]/contacts/[contactId] — update a contact
// DELETE /api/clients/[id]/contacts/[contactId] — remove a contact
//
// Ensures the updated contact belongs to the right client (defence
// against id-swapping). Demotes any other main contact when is_main
// is switched on. Cascades via entity_approvers.client_contact_id FK
// (ON DELETE SET NULL).
// ════════════════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { queryOne, execute, logAudit } from '@/lib/db';
import { apiError, apiOk, apiFail } from '@/lib/api-errors';
import { logger } from '@/lib/logger';

const log = logger.bind('client-contacts/[id]');

function isSchemaMissing(err: unknown): boolean {
  const msg = (err as { message?: string } | null)?.message ?? '';
  return /relation ["']?client_contacts["']? does not exist/i.test(msg);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; contactId: string }> },
) {
  try {
    const { id: clientId, contactId } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const existing = await queryOne<{ id: string; is_main: boolean }>(
      `SELECT id, is_main FROM client_contacts WHERE id = $1 AND client_id = $2`,
      [contactId, clientId],
    );
    if (!existing) return apiError('not_found', 'Contact not found for this client.', { status: 404 });

    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;

    const stringFields = ['name', 'email', 'phone', 'role', 'organization', 'country', 'notes'] as const;
    for (const f of stringFields) {
      if (body[f] !== undefined) {
        const raw = body[f];
        if (raw !== null && typeof raw !== 'string') {
          return apiError(`bad_${f}`, `${f} must be a string or null.`, { status: 400 });
        }
        let value: string | null = typeof raw === 'string' ? raw.trim() : null;
        if (value === '') value = null;
        if (f === 'country' && value) value = value.toUpperCase().slice(0, 2);
        if (f === 'name' && (!value || value.length === 0)) {
          return apiError('bad_name', 'name cannot be empty.', { status: 400 });
        }
        if (f === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
          return apiError('bad_email', 'email is invalid.', { status: 400 });
        }
        sets.push(`${f} = $${i++}`);
        vals.push(value);
      }
    }

    if (body.is_main !== undefined) {
      const makeMain = body.is_main === true;
      if (makeMain && !existing.is_main) {
        // Demote any other main for this client before promoting.
        await execute(
          `UPDATE client_contacts SET is_main = FALSE WHERE client_id = $1 AND is_main = TRUE AND id != $2`,
          [clientId, contactId],
        );
      }
      sets.push(`is_main = $${i++}`);
      vals.push(makeMain);
    }

    if (sets.length === 0) return apiError('no_changes', 'Nothing to update.', { status: 400 });

    vals.push(contactId);
    await execute(`UPDATE client_contacts SET ${sets.join(', ')} WHERE id = $${i}`, vals);

    await logAudit({
      action: 'update',
      targetType: 'client_contact',
      targetId: contactId,
      newValue: JSON.stringify(body),
    });

    log.info('client contact updated', { contact_id: contactId, fields: Object.keys(body) });
    return apiOk({ ok: true });
  } catch (err) {
    if (isSchemaMissing(err)) {
      return apiError('schema_missing', 'Apply migration 012 first.', { status: 501 });
    }
    return apiFail(err, 'client-contacts/patch');
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; contactId: string }> },
) {
  try {
    const { id: clientId, contactId } = await params;

    const existing = await queryOne<{ id: string }>(
      `SELECT id FROM client_contacts WHERE id = $1 AND client_id = $2`,
      [contactId, clientId],
    );
    if (!existing) return apiError('not_found', 'Contact not found.', { status: 404 });

    // Check if any entity_approvers still link to this contact — if so,
    // the FK's ON DELETE SET NULL handles it, but we return the count
    // so the UI can warn the user.
    const linkedRow = await queryOne<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM entity_approvers WHERE client_contact_id = $1`,
      [contactId],
    );
    const linkedCount = Number(linkedRow?.n ?? 0);

    await execute(`DELETE FROM client_contacts WHERE id = $1`, [contactId]);

    await logAudit({
      action: 'delete',
      targetType: 'client_contact',
      targetId: contactId,
      newValue: JSON.stringify({ linked_approvers_unlinked: linkedCount }),
    });

    log.info('client contact deleted', { contact_id: contactId, unlinked_approvers: linkedCount });
    return apiOk({ ok: true, unlinked_approvers: linkedCount });
  } catch (err) {
    if (isSchemaMissing(err)) {
      return apiError('schema_missing', 'Apply migration 012 first.', { status: 501 });
    }
    return apiFail(err, 'client-contacts/delete');
  }
}
