import { NextRequest, NextResponse } from 'next/server';
import { execute, queryOne, logAudit } from '@/lib/db';
import { apiError, apiFail } from '@/lib/api-errors';
import { requireSession } from '@/lib/require-role';

// POST /api/legal-watch/queue/[id]/reject-patch
//
// Discards an AI-drafted patch from the queue row. The item itself
// remains — the reviewer may still want to manually triage it with
// Recordar / Descartar. Only the ai_patch_* columns are cleared so
// a subsequent scan can regenerate a fresh draft against a newer
// HEAD.
//
// Admin-only. Idempotent (second click is a no-op).

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;

    const roleFail = await requireSession(request);
    if (roleFail) return roleFail;

    const row = await queryOne<{ id: string; ai_patch_diff: string | null; patch_applied_at: string | null }>(
      `SELECT id, ai_patch_diff, patch_applied_at FROM legal_watch_queue WHERE id = $1`,
      [id],
    );
    if (!row) return apiError('not_found', 'queue item not found', { status: 404 });
    if (row.patch_applied_at) {
      return apiError(
        'already_applied',
        'This patch was already applied — it cannot be rejected. Revert via git if needed.',
        { status: 400 },
      );
    }
    if (!row.ai_patch_diff) {
      return apiError('no_patch', 'No draft to reject.', { status: 400 });
    }

    await execute(
      `UPDATE legal_watch_queue
          SET ai_patch_diff = NULL,
              ai_patch_target_files = '{}',
              ai_patch_reasoning = NULL,
              ai_patch_confidence = NULL,
              ai_patch_model = NULL,
              ai_patch_generated_at = NULL,
              ai_patch_tests_pass = NULL,
              ai_patch_tests_output = NULL,
              triage_note = COALESCE(triage_note, '')
                || CASE WHEN COALESCE(triage_note,'') = '' THEN '' ELSE E'\n' END
                || 'AI-drafted patch rejected by reviewer',
              updated_at = NOW()
        WHERE id = $1`,
      [id],
    );

    await logAudit({
      action: 'legal_watch_patch_rejected',
      targetType: 'legal_watch_queue',
      targetId: id,
      reason: 'AI-drafted patch rejected by reviewer',
    });

    return NextResponse.json({ ok: true, id });
  } catch (err) {
    return apiFail(err, 'legal-watch/reject-patch');
  }
}
