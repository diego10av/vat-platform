import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

// GET /api/legal-watch/queue
//
// Returns items from legal_watch_queue, most-recent first.
// Query params:
//   ?status=new|flagged|dismissed|escalated   (default: new + flagged + escalated)
//   ?include_dismissed=true                    (convenience: adds 'dismissed')
//   ?limit=50                                  (default 50, max 200)
//
// 2026-04-23 — default filter now returns escalated too, because the
// redesigned queue card renders escalated items in a "Pending rule
// update" section rather than hiding them.
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const statusParam = url.searchParams.get('status');
  const includeDismissed = url.searchParams.get('include_dismissed') === 'true';
  const limitParam = Math.min(
    200,
    Math.max(1, Number(url.searchParams.get('limit') ?? 50) || 50),
  );

  const statusFilter = statusParam
    ? [statusParam]
    : includeDismissed
      ? ['new', 'flagged', 'escalated', 'dismissed']
      : ['new', 'flagged', 'escalated'];

  const rows = await query(
    `SELECT id, source, external_id, title, url, summary, published_at,
            matched_keywords, status, triaged_at, triaged_by, triage_note,
            ai_triage_severity, ai_triage_affected_rules,
            ai_triage_summary, ai_triage_proposed_action,
            ai_triage_confidence, ai_triage_model, ai_triage_at,
            created_at
       FROM legal_watch_queue
      WHERE status = ANY($1::text[])
      ORDER BY CASE ai_triage_severity
                 WHEN 'critical' THEN 0
                 WHEN 'high'     THEN 1
                 WHEN 'medium'   THEN 2
                 WHEN 'low'      THEN 3
                 ELSE 4
               END,
               (status = 'new') DESC,
               published_at DESC NULLS LAST,
               created_at DESC
      LIMIT $2`,
    [statusFilter, limitParam],
  );

  return NextResponse.json(rows);
}
