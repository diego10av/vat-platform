import { NextRequest, NextResponse } from 'next/server';
import { execute, queryOne, logAudit } from '@/lib/db';
import { apiError, apiFail } from '@/lib/api-errors';
import { requireSession } from '@/lib/require-role';
import { ALLOWED_FILES, extractFilePaths } from '@/lib/github-apply-patch';

// PATCH /api/legal-watch/queue/[id]/update-patch
//
// Saves a human-edited version of an AI-drafted patch. Used by the
// "Modificar" button in the PatchProposalBlock UI — the reviewer pulls
// the drafter's diff into a textarea, tweaks the wording/reasoning
// comments, and Saves before hitting Accept.
//
// Audit requirements (PROTOCOLS §13 + migration 025):
//   - The ORIGINAL AI-drafted diff is preserved in ai_patch_original_diff
//     on first edit. Subsequent edits overwrite ai_patch_diff only.
//   - ai_patch_modified_by_human → true (becomes the commit trailer).
//   - ai_patch_modified_by = session user.
//   - ai_patch_tests_pass/_output are cleared — previous test run
//     referenced the old diff and is no longer evidence.
//
// Safety:
//   - Admin-only.
//   - Re-enforces the ALLOWED_FILES whitelist. A human with bad intent
//     cannot widen the blast radius by editing the diff.
//   - Rejects edits to already-applied patches (idempotency — once
//     committed, the record is immutable).

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;

    const roleFail = await requireSession(request);
    if (roleFail) return roleFail;

    const body = (await request.json().catch(() => ({}))) as { diff?: unknown };
    const diff = typeof body.diff === 'string' ? body.diff.trim() : '';
    if (!diff) {
      return apiError('missing_diff', 'Request body must include a non-empty "diff" string.', {
        status: 400,
      });
    }
    if (diff.length > 60_000) {
      // Same cap as the drafter — keeps prod payloads bounded.
      return apiError('diff_too_large', 'Diff exceeds the 60 kB limit.', { status: 400 });
    }

    // Whitelist check — re-enforced here (defence in depth; accept-patch
    // also checks at apply time). No sense saving a diff that would fail
    // to apply.
    const paths = extractFilePaths(diff);
    if (paths.length === 0) {
      return apiError('invalid_diff', 'Could not parse any file paths from the diff.', {
        status: 400,
      });
    }
    const offWhitelist = paths.filter(p => !ALLOWED_FILES.has(p));
    if (offWhitelist.length > 0) {
      return apiError(
        'blast_radius',
        `Diff touches non-whitelisted files: ${offWhitelist.join(', ')}. Allowed files: ${[...ALLOWED_FILES].join(', ')}.`,
        { status: 400 },
      );
    }

    const row = await queryOne<{
      id: string;
      ai_patch_diff: string | null;
      ai_patch_original_diff: string | null;
      patch_applied_at: string | null;
    }>(
      `SELECT id, ai_patch_diff, ai_patch_original_diff, patch_applied_at
         FROM legal_watch_queue
        WHERE id = $1`,
      [id],
    );
    if (!row) return apiError('not_found', 'Queue item not found.', { status: 404 });
    if (row.patch_applied_at) {
      return apiError(
        'already_applied',
        'Cannot modify a patch that has already been applied to main. Revert via git if needed.',
        { status: 400 },
      );
    }
    if (!row.ai_patch_diff) {
      return apiError(
        'no_patch',
        'No AI-drafted patch exists on this item. Nothing to modify.',
        { status: 400 },
      );
    }
    if (row.ai_patch_diff.trim() === diff) {
      // No-op — the edit matches the existing diff. Treat as success without
      // bumping modified-by timestamps (avoid false audit entries).
      return NextResponse.json({ ok: true, id, changed: false });
    }

    // Stamp the editor. The role gate above already confirmed admin; the
    // session HMAC is single-tenant today so "founder" is the canonical
    // attribution (mirrors how accept-patch stamps patch_applied_by).
    const modifiedBy = 'founder';

    // Preserve original on first edit. Subsequent edits don't overwrite the
    // stored original — we want the ORIGINAL AI output, not the prior human
    // edit. Use COALESCE: if already non-null, keep it; else stash the
    // current ai_patch_diff.
    await execute(
      `UPDATE legal_watch_queue
          SET ai_patch_original_diff = COALESCE(ai_patch_original_diff, ai_patch_diff),
              ai_patch_diff              = $1,
              ai_patch_modified_by_human = true,
              ai_patch_modified_at       = NOW(),
              ai_patch_modified_by       = $2,
              ai_patch_tests_pass        = NULL,
              ai_patch_tests_output      = NULL,
              updated_at                 = NOW()
        WHERE id = $3`,
      [diff, modifiedBy, id],
    );

    await logAudit({
      action: 'legal_watch_patch_modified',
      targetType: 'legal_watch_queue',
      targetId: id,
      reason: `AI-drafted patch edited by reviewer (${modifiedBy}) — tests invalidated`,
    });

    return NextResponse.json({ ok: true, id, changed: true });
  } catch (err) {
    return apiFail(err, 'legal-watch/update-patch');
  }
}
