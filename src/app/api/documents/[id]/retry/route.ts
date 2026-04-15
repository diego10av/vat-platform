import { NextRequest, NextResponse } from 'next/server';
import { queryOne, execute, logAudit } from '@/lib/db';

// POST /api/documents/:id/retry
// Body: {
//   force_triage_as?: 'invoice' | 'credit_note',
//   force_direction?: 'incoming' | 'outgoing'   // optional hint for extractor / post-process
// }
// - Without force: reset to 'uploaded' so the next Extract All reprocesses normally.
// - With force_triage_as: override the triage decision (used by "Include as ..." on
//   documents the triage agent excluded as wrong_entity / receipt / etc).
// - With force_direction: after extraction, flip the invoice direction to this value.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const forceTriage = body.force_triage_as as string | undefined;

  const doc = await queryOne('SELECT * FROM documents WHERE id = $1', [id]);
  if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 });

  if (forceTriage && !['invoice', 'credit_note'].includes(forceTriage)) {
    return NextResponse.json({ error: 'force_triage_as must be invoice or credit_note' }, { status: 400 });
  }

  if (forceTriage) {
    // User overrides triage. Mark as already triaged so the extractor picks it up.
    await execute(
      `UPDATE documents
         SET status = 'uploaded',
             error_message = NULL,
             triage_result = $1,
             triage_confidence = 1.0
       WHERE id = $2`,
      [forceTriage, id]
    );
    await logAudit({
      declarationId: doc.declaration_id as string,
      action: 'update',
      targetType: 'document',
      targetId: id,
      field: 'triage_result',
      oldValue: String(doc.triage_result ?? ''),
      newValue: `${forceTriage} (manual override)`,
    });
  } else {
    await execute(
      `UPDATE documents
         SET status = 'uploaded',
             error_message = NULL,
             triage_result = NULL,
             triage_confidence = NULL
       WHERE id = $1`,
      [id]
    );
  }

  return NextResponse.json({ success: true });
}
