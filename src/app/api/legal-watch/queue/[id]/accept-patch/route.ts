import { NextRequest, NextResponse } from 'next/server';
import { execute, queryOne, logAudit } from '@/lib/db';
import { apiError, apiFail } from '@/lib/api-errors';
import { requireSession } from '@/lib/require-role';
import { applyPatchToRepo } from '@/lib/github-apply-patch';

// POST /api/legal-watch/queue/[id]/accept-patch
//
// Applies the Opus-4.7 drafted unified diff to main via the GitHub
// REST API. Admin-only. Stamps the queue row with patch_applied_at /
// patch_applied_by / patch_commit_sha and moves the item to
// status=escalated.
//
// Pre-conditions:
//   - GITHUB_TOKEN env var set (repo write scope on diego10av/cifra)
//   - ai_patch_diff non-null on the queue row
//   - patch_applied_at null (idempotency)
//
// Error codes the UI handles:
//   - 501 no_token           — env var missing, fall back to copy command
//   - 409 conflict           — diff no longer applies; reject + re-scan
//   - 400 no_patch           — drafter never produced a diff
//   - 400 already_applied    — patch_applied_at not null

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;

    const roleFail = await requireSession(request);
    if (roleFail) return roleFail;

    const row = await queryOne<{
      id: string;
      title: string;
      ai_patch_diff: string | null;
      ai_patch_target_files: string[] | null;
      ai_patch_reasoning: string | null;
      ai_patch_model: string | null;
      patch_applied_at: string | null;
      ai_triage_severity: string | null;
      ai_patch_modified_by_human: boolean | null;
      ai_patch_modified_by: string | null;
    }>(
      `SELECT id, title, ai_patch_diff, ai_patch_target_files,
              ai_patch_reasoning, ai_patch_model,
              patch_applied_at, ai_triage_severity,
              ai_patch_modified_by_human, ai_patch_modified_by
         FROM legal_watch_queue
        WHERE id = $1`,
      [id],
    );
    if (!row) return apiError('not_found', 'queue item not found', { status: 404 });
    if (!row.ai_patch_diff) {
      return apiError('no_patch', 'This item has no AI-drafted patch to apply.', { status: 400 });
    }
    if (row.patch_applied_at) {
      return apiError(
        'already_applied',
        'This patch was already applied. Inspect git log or the Rejected queue to recover.',
        { status: 400 },
      );
    }

    // Build the commit message. Include ai_drafted=true so
    // `git log --grep="ai_drafted"` surfaces all AI-authored commits
    // for audit. When the reviewer edited the diff before accepting
    // (Modificar flow, migration 025), add `human_edited: true` so we
    // can split AI-pure commits from human-edited ones.
    const reasoningLine = (row.ai_patch_reasoning ?? '').split('\n').slice(0, 2).join(' ').trim();
    const humanEdited = row.ai_patch_modified_by_human === true;
    const trailerLines = [
      `legal_watch_queue_id: ${id}`,
      `ai_drafted: true`,
      `model: ${row.ai_patch_model ?? 'unknown'}`,
      `severity: ${row.ai_triage_severity ?? 'unknown'}`,
    ];
    if (humanEdited) {
      trailerLines.push(`human_edited: true`);
      if (row.ai_patch_modified_by) {
        trailerLines.push(`modified_by: ${row.ai_patch_modified_by}`);
      }
    }
    const commitMessage = [
      `Rule update from legal-watch item ${id.slice(0, 8)}: ${row.title.slice(0, 60)}`,
      '',
      reasoningLine || 'AI-drafted patch accepted by reviewer.',
      '',
      ...trailerLines,
      '',
      'Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>',
    ].join('\n');

    let applyResult;
    try {
      applyResult = await applyPatchToRepo({
        diff: row.ai_patch_diff,
        commitMessage,
      });
    } catch (err) {
      const e = err as { code?: string; status?: number; message?: string };
      if (e.code === 'no_token') {
        return apiError(
          'no_token',
          'Auto-apply not configured: set GITHUB_TOKEN in Vercel env (repo-write PAT). Fallback: copy the git-apply command.',
          { status: 501 },
        );
      }
      if (e.code === 'conflict' || e.code === 'race_conflict') {
        return apiError(
          'conflict',
          e.message ?? 'Patch does not apply cleanly. Reject this draft and rerun the scanner so the drafter regenerates against fresh HEAD.',
          { status: 409 },
        );
      }
      if (e.code === 'blast_radius') {
        return apiError('blast_radius',
          e.message ?? 'Patch touches non-whitelisted files.',
          { status: 400 });
      }
      return apiFail(err, 'legal-watch/accept-patch');
    }

    // Persist the successful apply. Also move the item to status=escalated
    // (it's been actioned — no longer in the "new" queue) and record
    // the manual triage attribution separately from AI auto-dismiss.
    await execute(
      `UPDATE legal_watch_queue
          SET patch_applied_at = NOW(),
              patch_applied_by = 'founder',
              patch_commit_sha = $1,
              status = 'escalated',
              triaged_at = NOW(),
              triaged_by = 'founder',
              triage_note = COALESCE(triage_note, '')
                || CASE WHEN COALESCE(triage_note,'') = '' THEN '' ELSE E'\n' END
                || $2,
              updated_at = NOW()
        WHERE id = $3`,
      [
        applyResult.commit_sha,
        `Auto-applied AI-drafted patch as commit ${applyResult.commit_sha.slice(0, 7)}`,
        id,
      ],
    );

    await logAudit({
      action: 'legal_watch_patch_applied',
      targetType: 'legal_watch_queue',
      targetId: id,
      field: 'patch_commit_sha',
      newValue: applyResult.commit_sha,
      reason: `AI-drafted patch applied (${applyResult.files_changed.join(', ')})`,
    });

    return NextResponse.json({
      ok: true,
      id,
      commit_sha: applyResult.commit_sha,
      commit_url: applyResult.commit_url,
      files_changed: applyResult.files_changed,
    });
  } catch (err) {
    return apiFail(err, 'legal-watch/accept-patch');
  }
}
