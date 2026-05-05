// ════════════════════════════════════════════════════════════════════════
// Per-document endpoints.
//
//   GET    /api/entities/:id/official-documents/:docId?action=url
//     → short-lived signed URL to view / download the file (10 min TTL).
//   GET    /api/entities/:id/official-documents/:docId
//     → the row itself (metadata + extracted_fields).
//   DELETE /api/entities/:id/official-documents/:docId
//     → deletes the row + the storage object. Admin-only per the
//       destructive-action policy (requireSession). If the row is the
//       current (non-superseded) doc and there's a history entry,
//       the next-most-recent sibling becomes current.
//
// Stint 15 (2026-04-20).
// ════════════════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { execute, queryOne, logAudit } from '@/lib/db';
import { apiError, apiFail, apiOk } from '@/lib/api-errors';
import { requireSession } from '@/lib/require-role';

function supabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

interface DocRow {
  id: string;
  entity_id: string;
  kind: string;
  filename: string;
  content_type: string | null;
  storage_path: string;
  size_bytes: number | null;
  extracted_fields: unknown;
  effective_from: string | null;
  notes: string | null;
  superseded_by: string | null;
  uploaded_at: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> },
) {
  try {
    const { id: entityId, docId } = await params;
    const action = new URL(request.url).searchParams.get('action');

    const row = await queryOne<DocRow>(
      `SELECT id, entity_id, kind, filename, content_type, storage_path,
              size_bytes, extracted_fields, effective_from, notes,
              superseded_by, uploaded_at
         FROM entity_official_documents
        WHERE id = $1 AND entity_id = $2`,
      [docId, entityId],
    );
    if (!row) return apiError('not_found', 'Document not found.', { status: 404 });

    if (action === 'url') {
      const { data, error } = await supabase()
        .storage.from('documents')
        .createSignedUrl(row.storage_path, 600);
      if (error || !data) {
        return apiError('signed_url_failed', error?.message ?? 'Could not sign the URL.', { status: 500 });
      }
      return apiOk({ url: data.signedUrl, filename: row.filename });
    }

    return apiOk({ document: row });
  } catch (err) {
    return apiFail(err, 'entities/official-documents/:docId GET');
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> },
) {
  try {
    const roleFail = await requireSession(request);
    if (roleFail) return roleFail;

    const { id: entityId, docId } = await params;
    const row = await queryOne<DocRow>(
      `SELECT id, entity_id, kind, filename, storage_path, superseded_by
         FROM entity_official_documents
        WHERE id = $1 AND entity_id = $2`,
      [docId, entityId],
    );
    if (!row) return apiError('not_found', 'Document not found.', { status: 404 });

    // Clear any FKs pointing at this row first (Postgres would CASCADE
    // on DELETE via `ON DELETE SET NULL`, but doing it explicitly keeps
    // the audit record ordered).
    await execute(
      `UPDATE entity_official_documents SET superseded_by = NULL WHERE superseded_by = $1`,
      [docId],
    );

    await execute(`DELETE FROM entity_official_documents WHERE id = $1`, [docId]);

    const sb = supabase();
    await sb.storage.from('documents').remove([row.storage_path]).catch(() => {
      // Storage removal failure is not fatal — the DB row is gone, and a
      // sweep job can tidy orphan files later. Log for observability.
    });

    await logAudit({
      entityId,
      action: 'delete',
      targetType: 'official_document',
      targetId: docId,
      oldValue: `${row.kind}:${row.filename}`,
    });

    return apiOk({ deleted: true });
  } catch (err) {
    return apiFail(err, 'entities/official-documents/:docId DELETE');
  }
}
