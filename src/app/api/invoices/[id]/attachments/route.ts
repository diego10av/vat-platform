// ════════════════════════════════════════════════════════════════════════
// Attachments collection endpoints for a single invoice.
//
// GET  /api/invoices/[id]/attachments      → list
// POST /api/invoices/[id]/attachments      → upload (multipart)
//
// Uploads write the file to Supabase storage (bucket 'documents',
// path 'attachments/{invoice_id}/{attachment_id}_filename') and
// insert a row into invoice_attachments. Reviewer notes can be sent
// in the same POST or added later via PATCH on the item endpoint.
// ════════════════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { query, queryOne, execute, generateId, logAudit } from '@/lib/db';
import { apiError, apiOk, apiFail } from '@/lib/api-errors';
import { logger } from '@/lib/logger';

const log = logger.bind('invoices/attachments');

const ALLOWED_KINDS = ['contract', 'engagement_letter', 'advisory_email', 'other'] as const;
type Kind = typeof ALLOWED_KINDS[number];

const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024; // 15 MB — contracts can be long

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

function fileTypeFromName(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (ext === 'pdf') return 'pdf';
  if (['doc', 'docx'].includes(ext)) return 'word';
  if (['eml', 'msg'].includes(ext)) return 'email';
  if (['png', 'jpg', 'jpeg', 'tiff'].includes(ext)) return 'image';
  if (ext === 'txt') return 'text';
  return ext || 'other';
}

// ─────────────────────────── GET ───────────────────────────

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: invoiceId } = await params;
    const rows = await query<{
      id: string; invoice_id: string; kind: Kind;
      filename: string; file_path: string; file_size: number; file_type: string;
      user_note: string | null; legal_basis: string | null;
      ai_analysis: string | null; ai_summary: string | null;
      ai_suggested_treatment: string | null;
      ai_citations: unknown;
      ai_analyzed_at: string | null; ai_model: string | null;
      created_at: string; updated_at: string;
    }>(
      `SELECT id, invoice_id, kind, filename, file_path, file_size, file_type,
              user_note, legal_basis,
              ai_analysis, ai_summary, ai_suggested_treatment, ai_citations,
              ai_analyzed_at::text AS ai_analyzed_at, ai_model,
              created_at::text AS created_at, updated_at::text AS updated_at
         FROM invoice_attachments
        WHERE invoice_id = $1 AND deleted_at IS NULL
        ORDER BY created_at DESC`,
      [invoiceId],
    );
    return apiOk({ attachments: rows });
  } catch (err) {
    return apiFail(err, 'invoice-attachments/list');
  }
}

// ─────────────────────────── POST ───────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: invoiceId } = await params;

    // Invoice must exist; we also need declaration_id + entity_id for audit.
    const inv = await queryOne<{ id: string; declaration_id: string; entity_id: string }>(
      `SELECT i.id, i.declaration_id, d.entity_id
         FROM invoices i JOIN declarations d ON i.declaration_id = d.id
        WHERE i.id = $1`,
      [invoiceId],
    );
    if (!inv) return apiError('invoice_not_found', 'Invoice not found.', { status: 404 });

    const form = await request.formData();
    const file = form.get('file');
    const kindRaw = String(form.get('kind') ?? 'contract');
    const userNote = String(form.get('user_note') ?? '').trim();
    const legalBasis = String(form.get('legal_basis') ?? '').trim();
    if (!(file instanceof File)) {
      return apiError('file_required', 'Upload the file in the `file` field.', { status: 400 });
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      return apiError('file_too_large',
        `Max attachment size is ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB.`,
        { status: 400 });
    }
    const kind: Kind = (ALLOWED_KINDS as readonly string[]).includes(kindRaw)
      ? kindRaw as Kind
      : 'other';

    const id = generateId();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `attachments/${invoiceId}/${id}_${safeName}`;

    const sb = supabase();
    const bytes = await file.arrayBuffer();
    const { error: upErr } = await sb.storage
      .from('documents')
      .upload(storagePath, Buffer.from(bytes), {
        contentType: file.type || 'application/octet-stream',
      });
    if (upErr) {
      log.error('Supabase storage upload failed', upErr, { invoice_id: invoiceId, filename: file.name });
      return apiError('storage_failed', 'Could not save the file to storage.', { status: 500 });
    }

    await execute(
      `INSERT INTO invoice_attachments (
         id, invoice_id, kind, filename, file_path, file_size, file_type,
         user_note, legal_basis)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id, invoiceId, kind, file.name, storagePath, file.size, fileTypeFromName(file.name),
        userNote || null, legalBasis || null,
      ],
    );

    await logAudit({
      entityId: inv.entity_id,
      declarationId: inv.declaration_id,
      action: 'attach', targetType: 'invoice_attachment', targetId: id,
      field: 'kind', oldValue: '', newValue: kind,
      reason: userNote || legalBasis || undefined,
    });

    return apiOk({ id, filename: file.name, kind, file_size: file.size });
  } catch (err) {
    return apiFail(err, 'invoice-attachments/create');
  }
}
