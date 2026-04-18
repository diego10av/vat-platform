// GET /api/invoices/[id]/attachments/[attId]/download
//
// Returns a short-lived signed URL to the underlying file in Supabase
// storage. The reviewer clicks "View" in the UI; we generate the URL
// on-demand (60s TTL) instead of leaking a permanent public URL.

import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { queryOne } from '@/lib/db';
import { apiError, apiOk, apiFail } from '@/lib/api-errors';

const SIGNED_URL_TTL_SECONDS = 60;

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; attId: string }> },
) {
  try {
    const { id: invoiceId, attId } = await params;
    const row = await queryOne<{ file_path: string; filename: string }>(
      `SELECT file_path, filename FROM invoice_attachments
        WHERE id = $1 AND invoice_id = $2 AND deleted_at IS NULL`,
      [attId, invoiceId],
    );
    if (!row) return apiError('attachment_not_found', 'Attachment not found.', { status: 404 });

    const { data, error } = await supabase().storage
      .from('documents')
      .createSignedUrl(row.file_path, SIGNED_URL_TTL_SECONDS, { download: row.filename });
    if (error || !data?.signedUrl) {
      return apiError('signed_url_failed', 'Could not generate download URL.', { status: 500 });
    }
    return apiOk({ url: data.signedUrl, filename: row.filename, ttl: SIGNED_URL_TTL_SECONDS });
  } catch (err) {
    return apiFail(err, 'invoice-attachments/download');
  }
}
