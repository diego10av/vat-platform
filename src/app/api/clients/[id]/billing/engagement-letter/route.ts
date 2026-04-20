// ════════════════════════════════════════════════════════════════════════
// /api/clients/:id/billing/engagement-letter
//
// POST   → multipart upload of the signed engagement letter. Replaces
//          the existing one atomically (uploads the new file, swaps
//          the metadata, deletes the old storage object). Unlike VAT
//          registration letters, engagement letters aren't versioned —
//          only the latest signed copy is binding.
// GET ?action=url → short-lived signed URL for download / preview.
// DELETE → remove the attachment (keeps billing row intact).
//
// Stint 15 (2026-04-20).
// ════════════════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { execute, queryOne, logAudit, initializeSchema } from '@/lib/db';
import { apiError, apiFail, apiOk } from '@/lib/api-errors';

function supabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

interface BillingLite {
  client_id: string;
  engagement_letter_path: string | null;
}

async function ensureClientAndBilling(clientId: string) {
  const client = await queryOne<{ id: string; name: string }>(
    'SELECT id, name FROM clients WHERE id = $1 AND archived_at IS NULL',
    [clientId],
  );
  if (!client) return { ok: false as const, err: 'client_not_found' as const };
  let billing = await queryOne<BillingLite>(
    'SELECT client_id, engagement_letter_path FROM client_billing WHERE client_id = $1',
    [clientId],
  );
  // Auto-create the billing row on first engagement-letter upload so
  // the user doesn't have to save an empty fee schedule first.
  if (!billing) {
    await execute(
      'INSERT INTO client_billing (client_id) VALUES ($1) ON CONFLICT (client_id) DO NOTHING',
      [clientId],
    );
    billing = { client_id: clientId, engagement_letter_path: null };
  }
  return { ok: true as const, client, billing };
}

// ────────────────────────────────────────────────────────────────────────
// POST — upload / replace
// ────────────────────────────────────────────────────────────────────────
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await initializeSchema();
    const { id: clientId } = await params;

    const pre = await ensureClientAndBilling(clientId);
    if (!pre.ok) return apiError(pre.err, 'Client not found.', { status: 404 });

    const form = await request.formData();
    const file = form.get('file') as File | null;
    const signedOnRaw = form.get('signed_on') as string | null;
    if (!file) return apiError('file_required', 'No file attached.', { status: 400 });
    if (file.size > 25 * 1024 * 1024) {
      return apiError('file_too_large', 'Max 25 MB.', { status: 400 });
    }

    let signedOn: string | null = null;
    if (signedOnRaw && /^\d{4}-\d{2}-\d{2}$/.test(signedOnRaw)) {
      signedOn = signedOnRaw;
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `client-billing/${clientId}/${Date.now()}_${safeName}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const sb = supabase();
    const { error: upErr } = await sb.storage.from('documents').upload(path, buffer, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });
    if (upErr) return apiError('storage_failed', upErr.message, { status: 500 });

    // Swap metadata + clean up the prior object.
    const priorPath = pre.billing.engagement_letter_path;
    await execute(
      `UPDATE client_billing
          SET engagement_letter_filename = $1,
              engagement_letter_path = $2,
              engagement_letter_content_type = $3,
              engagement_letter_size_bytes = $4,
              engagement_letter_uploaded_at = NOW(),
              engagement_letter_signed_on = COALESCE($5, engagement_letter_signed_on),
              updated_at = NOW()
        WHERE client_id = $6`,
      [file.name, path, file.type || null, file.size, signedOn, clientId],
    );

    if (priorPath && priorPath !== path) {
      await sb.storage.from('documents').remove([priorPath]).catch(() => {
        // best-effort — DB is source of truth, orphaned files are swept later
      });
    }

    await logAudit({
      action: 'create',
      targetType: 'engagement_letter',
      targetId: clientId,
      newValue: file.name,
    });

    return apiOk({
      filename: file.name,
      path,
      size_bytes: file.size,
      signed_on: signedOn,
    });
  } catch (err) {
    return apiFail(err, 'clients/billing/engagement-letter POST');
  }
}

// ────────────────────────────────────────────────────────────────────────
// GET ?action=url — signed URL for the current engagement letter
// ────────────────────────────────────────────────────────────────────────
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await initializeSchema();
    const { id: clientId } = await params;
    const action = new URL(request.url).searchParams.get('action');

    const billing = await queryOne<{ engagement_letter_path: string | null; engagement_letter_filename: string | null }>(
      'SELECT engagement_letter_path, engagement_letter_filename FROM client_billing WHERE client_id = $1',
      [clientId],
    );
    if (!billing?.engagement_letter_path) {
      return apiError('no_engagement_letter', 'No engagement letter on file for this client.', { status: 404 });
    }

    if (action !== 'url') {
      return apiOk({
        filename: billing.engagement_letter_filename,
        path: billing.engagement_letter_path,
      });
    }

    const { data, error } = await supabase()
      .storage.from('documents')
      .createSignedUrl(billing.engagement_letter_path, 600);
    if (error || !data) {
      return apiError('signed_url_failed', error?.message ?? 'Could not sign URL.', { status: 500 });
    }
    return apiOk({ url: data.signedUrl, filename: billing.engagement_letter_filename });
  } catch (err) {
    return apiFail(err, 'clients/billing/engagement-letter GET');
  }
}

// ────────────────────────────────────────────────────────────────────────
// DELETE — remove the engagement letter (but keep the billing row)
// ────────────────────────────────────────────────────────────────────────
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await initializeSchema();
    const { id: clientId } = await params;

    const row = await queryOne<{ engagement_letter_path: string | null; engagement_letter_filename: string | null }>(
      'SELECT engagement_letter_path, engagement_letter_filename FROM client_billing WHERE client_id = $1',
      [clientId],
    );
    if (!row?.engagement_letter_path) {
      return apiError('no_engagement_letter', 'Nothing to delete.', { status: 404 });
    }

    await execute(
      `UPDATE client_billing
          SET engagement_letter_filename = NULL,
              engagement_letter_path = NULL,
              engagement_letter_content_type = NULL,
              engagement_letter_size_bytes = NULL,
              engagement_letter_uploaded_at = NULL,
              updated_at = NOW()
        WHERE client_id = $1`,
      [clientId],
    );

    await supabase().storage.from('documents').remove([row.engagement_letter_path]).catch(() => {});

    await logAudit({
      action: 'delete',
      targetType: 'engagement_letter',
      targetId: clientId,
      oldValue: row.engagement_letter_filename ?? row.engagement_letter_path,
    });

    return apiOk({ deleted: true });
  } catch (err) {
    return apiFail(err, 'clients/billing/engagement-letter DELETE');
  }
}
