import { NextRequest, NextResponse } from 'next/server';
import { execute, query, logAudit } from '@/lib/db';
import { requireSession } from '@/lib/require-role';

// PATCH /api/legal-watch/queue/[id]
//
// Body: { status: 'flagged'|'dismissed'|'escalated', triage_note?: string }
//
// Lifecycle (see migration 020):
//   new -> flagged     reviewer wants to come back to it
//   new -> dismissed   false positive, not relevant
//   new -> escalated   we added a LegalSource entry + rule flag
//   (flagged can move to dismissed or escalated too)
export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const roleFail = await requireSession(request);
  if (roleFail) return roleFail;

  const body = (await request.json().catch(() => ({}))) as {
    status?: string;
    triage_note?: string;
  };

  const status = (body.status || '').toLowerCase();
  if (!['flagged', 'dismissed', 'escalated'].includes(status)) {
    return NextResponse.json(
      { error: { code: 'invalid_status', message: 'status must be flagged | dismissed | escalated' } },
      { status: 400 },
    );
  }

  const before = await query<{ id: string; status: string; title: string }>(
    `SELECT id, status, title FROM legal_watch_queue WHERE id = $1`,
    [id],
  );
  if (before.length === 0) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'queue item not found' } },
      { status: 404 },
    );
  }

  await execute(
    `UPDATE legal_watch_queue
        SET status = $1,
            triage_note = $2,
            triaged_at = NOW(),
            triaged_by = 'founder',
            updated_at = NOW()
      WHERE id = $3`,
    [status, body.triage_note ?? null, id],
  );

  await logAudit({
    action: 'legal_watch_triage',
    targetType: 'legal_watch_queue',
    targetId: id,
    field: 'status',
    oldValue: before[0].status,
    newValue: status,
  });

  return NextResponse.json({ ok: true, id, status });
}

// DELETE — permanent removal. Same admin gate. Rare — prefer `dismissed`
// so we retain the audit trail of "this was seen and judged not useful".
export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const roleFail = await requireSession(request);
  if (roleFail) return roleFail;

  await execute(`DELETE FROM legal_watch_queue WHERE id = $1`, [id]);

  await logAudit({
    action: 'legal_watch_delete',
    targetType: 'legal_watch_queue',
    targetId: id,
  });

  return NextResponse.json({ ok: true, id });
}
