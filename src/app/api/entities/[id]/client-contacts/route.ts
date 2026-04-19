// ════════════════════════════════════════════════════════════════════════
// GET /api/entities/[id]/client-contacts — list contacts on this entity's
// parent CLIENT, so the ApproversCard "Pick from client contacts"
// dropdown can populate without a second round-trip that knows the
// client id.
//
// Added stint 11 (2026-04-19) as part of the multi-contact + auto-inherit
// feature (ROADMAP P0 #11).
// ════════════════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { apiError, apiOk, apiFail } from '@/lib/api-errors';

function isSchemaMissing(err: unknown): boolean {
  const msg = (err as { message?: string } | null)?.message ?? '';
  return /relation ["']?client_contacts["']? does not exist/i.test(msg);
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const entity = await queryOne<{ client_id: string | null }>(
      'SELECT client_id FROM entities WHERE id = $1',
      [id],
    );
    if (!entity) return apiError('not_found', 'Entity not found.', { status: 404 });
    if (!entity.client_id) return apiOk({ contacts: [], client_id: null });

    const rows = await query(
      `SELECT id, client_id, name, email, phone, role, organization, country,
              is_main, notes
         FROM client_contacts
        WHERE client_id = $1
        ORDER BY is_main DESC, lower(name) ASC`,
      [entity.client_id],
    );
    return apiOk({ contacts: rows, client_id: entity.client_id });
  } catch (err) {
    if (isSchemaMissing(err)) {
      return apiOk({ contacts: [], client_id: null, schema_missing: true });
    }
    return apiFail(err, 'entity-client-contacts');
  }
}
