// GET /api/trash — list every soft-archived client + entity for the
// /settings/trash page. Admin + reviewer only (gated at the endpoint;
// junior is also blocked by the middleware's /settings deny-list).

import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { apiOk, apiFail } from '@/lib/api-errors';
import { requireSession } from '@/lib/require-role';

export async function GET(request: NextRequest) {
  const roleFail = await requireSession(request);
  if (roleFail) return roleFail;

  try {
    // Archived clients.
    const clients = await query<{
      id: string; name: string; kind: string;
      archived_at: string;
      entity_count: string;
    }>(
      `SELECT c.id, c.name, c.kind,
              c.archived_at::text AS archived_at,
              (SELECT COUNT(*)::text FROM entities e
                 WHERE e.client_id = c.id AND e.deleted_at IS NULL) AS entity_count
         FROM clients c
        WHERE c.archived_at IS NOT NULL
        ORDER BY c.archived_at DESC`,
    );

    // Soft-deleted entities (excluding entities whose client is also
    // archived — those are listed under the client so we don't
    // duplicate).
    const entities = await query<{
      id: string; name: string; client_id: string | null; client_name: string | null;
      deleted_at: string;
      deleted_reason: string | null;
      declaration_count: string;
    }>(
      `SELECT e.id, e.name, e.client_id, c.name AS client_name,
              e.deleted_at::text AS deleted_at,
              e.deleted_reason,
              (SELECT COUNT(*)::text FROM declarations d WHERE d.entity_id = e.id) AS declaration_count
         FROM entities e
    LEFT JOIN clients c ON e.client_id = c.id
        WHERE e.deleted_at IS NOT NULL
        ORDER BY e.deleted_at DESC`,
    );

    return apiOk({
      clients: clients.map(c => ({
        id: c.id,
        name: c.name,
        kind: c.kind,
        archived_at: c.archived_at,
        entity_count: Number(c.entity_count),
      })),
      entities: entities.map(e => ({
        id: e.id,
        name: e.name,
        client_id: e.client_id,
        client_name: e.client_name,
        deleted_at: e.deleted_at,
        deleted_reason: e.deleted_reason,
        declaration_count: Number(e.declaration_count),
      })),
    });
  } catch (err) {
    return apiFail(err, 'trash/list');
  }
}
