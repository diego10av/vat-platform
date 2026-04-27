// Stint 56.C — list + upload attachments for a task. Mirror of
// /api/invoices/[id]/attachments (mig 010 pattern). Files in Supabase
// Storage bucket "documents", prefix `task-attachments/<task_id>/`.
//
//   GET  /api/tax-ops/tasks/[id]/attachments  → list rows + signed download urls
//   POST /api/tax-ops/tasks/[id]/attachments  → multipart upload
//
// Reuses the same logAudit machinery; logs target_type='tax_ops_task_attachment'.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { query, execute, queryOne, generateId, logAudit } from '@/lib/db';

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // 25 MB — engagement letters can be large
const SIGNED_URL_TTL_SECONDS = 60 * 60;        // 1 hour

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

interface AttachmentRow {
  id: string;
  task_id: string;
  filename: string;
  file_path: string;
  file_size: number | null;
  file_type: string | null;
  uploaded_by: string | null;
  created_at: string;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: taskId } = await params;
  const rows = await query<AttachmentRow>(
    `SELECT id, task_id, filename, file_path, file_size, file_type,
            uploaded_by, created_at::text AS created_at
       FROM tax_ops_task_attachments
      WHERE task_id = $1
      ORDER BY created_at DESC`,
    [taskId],
  );

  // Generate signed URLs in batch so the client can render direct
  // download links without an extra round-trip per file.
  const sb = supabase();
  const enriched = await Promise.all(
    rows.map(async (r) => {
      const { data } = await sb.storage
        .from('documents')
        .createSignedUrl(r.file_path, SIGNED_URL_TTL_SECONDS);
      return { ...r, download_url: data?.signedUrl ?? null };
    }),
  );

  return NextResponse.json({ attachments: enriched });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: taskId } = await params;

  const task = await queryOne<{ id: string }>(
    `SELECT id FROM tax_ops_tasks WHERE id = $1`,
    [taskId],
  );
  if (!task) return NextResponse.json({ error: 'task_not_found' }, { status: 404 });

  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file_required' }, { status: 400 });
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return NextResponse.json(
      { error: 'file_too_large', max_bytes: MAX_ATTACHMENT_BYTES },
      { status: 400 },
    );
  }

  const id = generateId();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `task-attachments/${taskId}/${id}_${safeName}`;

  const sb = supabase();
  const bytes = await file.arrayBuffer();
  const { error: upErr } = await sb.storage
    .from('documents')
    .upload(storagePath, Buffer.from(bytes), {
      contentType: file.type || 'application/octet-stream',
    });
  if (upErr) {
    return NextResponse.json(
      { error: 'storage_failed', detail: upErr.message },
      { status: 500 },
    );
  }

  await execute(
    `INSERT INTO tax_ops_task_attachments
       (id, task_id, filename, file_path, file_size, file_type, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, taskId, file.name, storagePath, file.size, file.type || null, 'founder'],
  );

  await logAudit({
    userId: 'founder',
    action: 'task_attachment_added',
    targetType: 'tax_ops_task',
    targetId: taskId,
    newValue: JSON.stringify({
      attachment_id: id,
      filename: file.name,
      size: file.size,
    }),
  });

  return NextResponse.json({
    id,
    filename: file.name,
    file_size: file.size,
    file_type: file.type,
  });
}
