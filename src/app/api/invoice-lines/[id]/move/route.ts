import { NextRequest, NextResponse } from 'next/server';
import { queryOne, execute, logAudit } from '@/lib/db';
import { apiError } from '@/lib/api-errors';

const LOCKED_STATUSES = new Set(['approved', 'filed', 'paid']);

// POST /api/invoice-lines/:id/move
// Body: { target: 'incoming' | 'outgoing' | 'excluded' }
//
// - target='incoming' or 'outgoing' → set the parent invoice.direction,
//   reset treatment (so the user re-classifies in the new direction), restore if deleted
// - target='excluded' → soft-delete line with reason 'Moved to excluded by user'
// Every move is logged in audit_log with old section → new section.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { target } = await request.json();
  if (!['incoming', 'outgoing', 'excluded'].includes(target)) {
    return NextResponse.json({ error: "target must be 'incoming', 'outgoing', or 'excluded'" }, { status: 400 });
  }

  const line = await queryOne<{
    id: string;
    invoice_id: string;
    declaration_id: string;
    state: string;
    direction: string;
    entity_id: string;
    decl_status: string;
  }>(
    `SELECT il.id, il.invoice_id, il.declaration_id, il.state,
            i.direction,
            d2.entity_id,
            d2.status AS decl_status
       FROM invoice_lines il
       JOIN invoices i ON il.invoice_id = i.id
       JOIN declarations d2 ON i.declaration_id = d2.id
      WHERE il.id = $1`,
    [id]
  );

  if (!line) return NextResponse.json({ error: 'Invoice line not found' }, { status: 404 });

  // Lock check — an approved / filed / paid declaration must be reopened
  // before lines can be re-assigned to a different section. Previously the
  // move endpoint silently mutated direction and reset the treatment even
  // on locked declarations, which would re-classify a filed return without
  // any visible state transition.
  if (LOCKED_STATUSES.has(line.decl_status)) {
    return apiError('declaration_locked',
      `This line belongs to a ${line.decl_status} declaration and cannot be moved.`,
      { hint: 'Reopen the declaration first (approved → review).', status: 409 });
  }

  const wasSection =
    line.state === 'deleted' ? 'excluded'
    : line.direction === 'outgoing' ? 'outgoing'
    : 'incoming';

  if (target === 'excluded') {
    await execute(
      `UPDATE invoice_lines
          SET state = 'deleted',
              deleted_at = NOW(),
              deleted_reason = 'Moved to excluded by user',
              updated_at = NOW()
        WHERE id = $1`,
      [id]
    );
  } else {
    // target is incoming or outgoing
    await execute(
      `UPDATE invoices SET direction = $1 WHERE id = $2`,
      [target, line.invoice_id]
    );
    // If it was deleted, restore it and reset to classified so rules can re-apply if needed
    if (line.state === 'deleted') {
      await execute(
        `UPDATE invoice_lines
            SET state = 'classified',
                deleted_at = NULL,
                deleted_reason = NULL,
                updated_at = NOW()
          WHERE id = $1`,
        [id]
      );
    }
    // If the treatment was for the old direction, it probably no longer fits.
    // Reset to unclassified only when direction actually changed.
    if (line.direction !== target) {
      await execute(
        `UPDATE invoice_lines
            SET treatment = NULL,
                treatment_source = NULL,
                classification_rule = NULL,
                updated_at = NOW()
          WHERE id = $1`,
        [id]
      );
    }
  }

  await logAudit({
    entityId: line.entity_id,
    declarationId: line.declaration_id,
    action: 'update',
    targetType: 'invoice_line',
    targetId: id,
    field: 'section',
    oldValue: wasSection,
    newValue: target,
  });

  return NextResponse.json({ success: true, from: wasSection, to: target });
}
