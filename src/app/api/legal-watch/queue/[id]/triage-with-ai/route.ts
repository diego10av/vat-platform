import { NextRequest, NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { apiError, apiFail } from '@/lib/api-errors';
import { requireSession } from '@/lib/require-role';
import { triageQueueItem } from '@/lib/legal-watch-triage';

// POST /api/legal-watch/queue/[id]/triage-with-ai
//
// Runs (or re-runs) the Opus 4.7 legal-watch triage on a single queue
// row and persists the result on that row. Admin-only.
//
// Automatic triage also runs in the scanner post-insert (see
// src/lib/legal-watch-scan.ts) — this endpoint is for on-demand
// retrigger when the reviewer wants a fresh opinion after amending
// the item or when the prompt has been updated.

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
      summary: string | null;
      url: string | null;
      matched_keywords: string[];
      published_at: string | null;
    }>(
      `SELECT id, title, summary, url, matched_keywords,
              published_at::text AS published_at
         FROM legal_watch_queue
        WHERE id = $1`,
      [id],
    );
    if (!row) {
      return apiError('not_found', 'queue item not found', { status: 404 });
    }

    const result = await triageQueueItem({
      title: row.title,
      summary: row.summary,
      url: row.url,
      matched_keywords: row.matched_keywords ?? [],
      published_at: row.published_at,
    });

    if (!result) {
      return apiError(
        'triage_failed',
        'Opus 4.7 triage did not return a usable answer. The item remains untriaged — try again or triage manually.',
        { status: 502 },
      );
    }

    await execute(
      `UPDATE legal_watch_queue
          SET ai_triage_severity = $1,
              ai_triage_affected_rules = $2,
              ai_triage_summary = $3,
              ai_triage_proposed_action = $4,
              ai_triage_confidence = $5,
              ai_triage_model = $6,
              ai_triage_at = NOW(),
              updated_at = NOW()
        WHERE id = $7`,
      [
        result.severity,
        result.affected_rules,
        result.summary,
        result.proposed_action,
        result.confidence,
        result.model,
        id,
      ],
    );

    return NextResponse.json({ ok: true, id, triage: result });
  } catch (err) {
    return apiFail(err, 'legal-watch/queue/triage-with-ai');
  }
}
