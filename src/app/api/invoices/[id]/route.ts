// ════════════════════════════════════════════════════════════════════════
// DELETE /api/invoices/[id] — remove an invoice + all its lines.
//
// The declaration-level delete cascade already handles bulk cleanup, but
// reviewers often need to purge a single mistakenly-uploaded invoice
// (wrong supplier, duplicate, test data) without nuking the whole
// declaration. Added stint 11 (2026-04-19).
//
// Guard: refuses when the parent declaration is approved / filed / paid
// — the reviewer must Reopen first. Matches the declaration-delete
// guard so the audit trail never shows a post-approval invoice vanishing.
// ════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { queryOne, execute, logAudit } from '@/lib/db';
import { logger } from '@/lib/logger';

const log = logger.bind('invoices/[id]');

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const inv = await queryOne<{
    id: string; provider: string | null; declaration_id: string | null;
    document_id: string | null; direction: string | null;
  }>(
    `SELECT id, provider, declaration_id, document_id, direction FROM invoices WHERE id = $1`,
    [id],
  );
  if (!inv) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

  // Parent declaration status guard.
  if (inv.declaration_id) {
    const decl = await queryOne<{ status: string; entity_id: string }>(
      `SELECT status, entity_id FROM declarations WHERE id = $1`,
      [inv.declaration_id],
    );
    if (decl && (decl.status === 'approved' || decl.status === 'filed' || decl.status === 'paid')) {
      return NextResponse.json({
        error: 'declaration_locked',
        message: `This invoice belongs to a ${decl.status} declaration. Reopen the declaration first.`,
      }, { status: 409 });
    }
  }

  // Invoice_lines.invoice_id is NO ACTION in the current schema; delete
  // lines explicitly. invoice_attachments.invoice_id is CASCADE so it
  // unwinds automatically. validator_findings.invoice_id is CASCADE too.
  await execute(
    `WITH deleted_lines AS (
       DELETE FROM invoice_lines WHERE invoice_id = $1 RETURNING id
     )
     DELETE FROM invoices WHERE id = $1`,
    [id],
  );

  await logAudit({
    declarationId: inv.declaration_id ?? undefined,
    action: 'delete',
    targetType: 'invoice',
    targetId: id,
    oldValue: JSON.stringify({ provider: inv.provider, direction: inv.direction }),
  });

  log.info('invoice deleted', { invoice_id: id, provider: inv.provider });
  return NextResponse.json({ ok: true });
}
