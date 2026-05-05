import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne, execute, logAudit, initializeSchema } from '@/lib/db';
import { canTransition, type DeclarationStatus } from '@/lib/lifecycle';
import { upsertPrecedentsFromDeclaration } from '@/lib/precedents';
import { logger } from '@/lib/logger';
import { requireSession } from '@/lib/require-role';

const log = logger.bind('declarations/[id]');

// GET /api/declarations/:id
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await initializeSchema();
  const { id } = await params;

  const declaration = await queryOne(
    `SELECT d.*, e.name as entity_name, e.regime, e.frequency, e.has_fx, e.has_outgoing, e.has_recharges,
            e.vat_number, e.matricule,
            COALESCE(e.ai_mode, 'full') AS entity_ai_mode,
            COALESCE(e.requires_partner_review, false) AS requires_partner_review
     FROM declarations d JOIN entities e ON d.entity_id = e.id WHERE d.id = $1`,
    [id]
  );
  if (!declaration) return NextResponse.json({ error: 'Declaration not found' }, { status: 404 });

  const documentStats = await queryOne(
    `SELECT
      COUNT(*)::int as total,
      SUM(CASE WHEN status = 'uploaded' THEN 1 ELSE 0 END)::int as uploaded,
      SUM(CASE WHEN status = 'triaged' AND triage_result IN ('invoice','credit_note') THEN 1 ELSE 0 END)::int as invoices,
      SUM(CASE WHEN status = 'triaged' AND triage_result NOT IN ('invoice','credit_note') THEN 1 ELSE 0 END)::int as non_invoices,
      SUM(CASE WHEN status = 'extracted' THEN 1 ELSE 0 END)::int as extracted,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END)::int as errors,
      SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END)::int as rejected
    FROM documents WHERE declaration_id = $1`,
    [id]
  );

  const documents = await query(
    'SELECT * FROM documents WHERE declaration_id = $1 ORDER BY uploaded_at ASC',
    [id]
  );

  // LEFT JOIN on documents so manual outgoing invoices (document_id IS NULL) still appear.
  const lines = await query(
    `SELECT il.*, i.provider, i.provider_vat, i.country, i.invoice_date, i.invoice_number,
            i.direction, i.currency, i.currency_amount, i.ecb_rate, i.document_id,
            i.extraction_source,
            d.filename as source_filename
     FROM invoice_lines il
     JOIN invoices i ON il.invoice_id = i.id
     LEFT JOIN documents d ON i.document_id = d.id
     WHERE il.declaration_id = $1
     ORDER BY i.direction DESC, il.sort_order ASC, i.provider ASC`,
    [id]
  );

  return NextResponse.json({
    ...declaration,
    documentStats: documentStats || { total: 0, uploaded: 0, invoices: 0, non_invoices: 0, extracted: 0, errors: 0, rejected: 0 },
    documents,
    lines,
  });
}

// PATCH /api/declarations/:id
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await initializeSchema();
  const { id } = await params;
  const body = await request.json();

  const declaration = await queryOne('SELECT * FROM declarations WHERE id = $1', [id]);
  if (!declaration) return NextResponse.json({ error: 'Declaration not found' }, { status: 404 });

  let precedentReport = null;

  if (body.status) {
    const currentStatus = declaration.status as DeclarationStatus;
    const newStatus = body.status as DeclarationStatus;

    if (!canTransition(currentStatus, newStatus)) {
      return NextResponse.json({ error: `Cannot transition from ${currentStatus} to ${newStatus}` }, { status: 400 });
    }

    let extra = '';
    const values: unknown[] = [newStatus];
    let idx = 2;

    if (newStatus === 'approved') {
      extra += `, approved_at = NOW(), approved_by = 'founder'`;
      if (currentStatus === 'pending_review') {
        extra += `, partner_approved_at = NOW(), partner_approved_by = 'founder'`;
      }
    }
    if (newStatus === 'pending_review') {
      extra += `, submitted_for_review_at = NOW(), submitted_by = 'founder'`;
    }
    if (newStatus === 'filed') {
      // filing_ref is required for FILED
      if (!body.filing_ref) {
        return NextResponse.json({ error: 'filing_ref is required when transitioning to filed' }, { status: 400 });
      }
      extra += `, filing_ref = $${idx}, filed_at = NOW()`;
      values.push(body.filing_ref);
      idx++;
    }
    if (newStatus === 'paid') {
      extra += `, payment_confirmed_at = NOW()`;
      if (body.payment_ref) {
        extra += `, payment_ref = $${idx}`;
        values.push(body.payment_ref);
        idx++;
      }
    }

    // Reopen side-effects — clear the forward-state artefacts so the
    // active record is clean for a new approval cycle. The audit log
    // still carries the old_value so the history is recoverable.
    if (newStatus === 'review') {
      if (currentStatus === 'filed' || currentStatus === 'paid') {
        extra += `, filing_ref = NULL, filed_at = NULL`;
      }
      if (currentStatus === 'paid') {
        extra += `, payment_ref = NULL, payment_confirmed_at = NULL`;
      }
      if (currentStatus === 'approved' || currentStatus === 'filed' || currentStatus === 'paid') {
        extra += `, approved_at = NULL, approved_by = NULL, partner_approved_at = NULL, partner_approved_by = NULL`;
      }
      if (currentStatus === 'pending_review') {
        // Associate recalls their submission → clear submission stamps
        // so re-submission starts fresh.
        extra += `, submitted_for_review_at = NULL, submitted_by = NULL`;
      }
    }

    values.push(id);
    await execute(`UPDATE declarations SET status = $1, updated_at = NOW()${extra} WHERE id = $${idx}`, values);

    await logAudit({
      entityId: declaration.entity_id as string,
      declarationId: id,
      action:
        newStatus === 'approved' ? 'approve'
        : newStatus === 'filed' ? 'file'
        : newStatus === 'paid' ? 'pay'
        : newStatus === 'review' && (currentStatus === 'approved' || currentStatus === 'filed') ? 'reopen'
        : 'update',
      targetType: 'declaration', targetId: id,
      field: 'status', oldValue: currentStatus, newValue: newStatus,
    });

    // Side effect: upserting precedents on review→approved completes the
    // learning loop (per PRD §6.1). Done after the status change so the
    // declaration is locked first.
    if (newStatus === 'approved' && currentStatus === 'review') {
      try {
        precedentReport = await upsertPrecedentsFromDeclaration(id);
      } catch (e) {
        log.error('precedent upsert failed', e, { declaration_id: id });
      }
    }
  }

  if (body.notes !== undefined) {
    await execute('UPDATE declarations SET notes = $1, updated_at = NOW() WHERE id = $2', [body.notes, id]);
  }
  if (body.payment_ref !== undefined && !body.status) {
    await execute('UPDATE declarations SET payment_ref = $1, updated_at = NOW() WHERE id = $2', [body.payment_ref, id]);
  }

  const updated = await queryOne(
    `SELECT d.*, e.name as entity_name, e.regime, e.frequency, e.has_fx, e.has_outgoing
     FROM declarations d JOIN entities e ON d.entity_id = e.id WHERE d.id = $1`,
    [id]
  );
  return NextResponse.json({ ...(updated as object), precedent_report: precedentReport });
}

// DELETE /api/declarations/:id
//
// Defaults to "refuse unless status ∈ {created, review}" — the safety
// rail. A ?force=true query param bypasses the status check; callers
// (the UI confirm modal) must surface the stronger warning first.
//
// Added stint 11 (2026-04-19); extended stint 13 (2026-04-20) to
// allow cascade-delete of filed/paid declarations after a stronger
// UI confirmation, per Diego's "can't clear test data" feedback.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await initializeSchema();
  const { id } = await params;
  const url = new URL(request.url);
  const force = url.searchParams.get('force') === 'true';

  const decl = await queryOne<{
    id: string; status: string; year: number; period: string; entity_id: string;
  }>(
    `SELECT id, status, year, period, entity_id FROM declarations WHERE id = $1`,
    [id],
  );
  if (!decl) return NextResponse.json({ error: 'Declaration not found' }, { status: 404 });

  // Guard: approved/filed/paid → refuse UNLESS ?force=true.
  const locked = decl.status === 'approved' || decl.status === 'filed' || decl.status === 'paid';
  if (locked && !force) {
    return NextResponse.json({
      error: 'declaration_locked',
      message: `Cannot delete a ${decl.status} declaration without explicit force. The UI should ask the reviewer to confirm twice before sending ?force=true.`,
    }, { status: 409 });
  }

  // Admin-only gate when forcing deletion of a committed declaration.
  // Reviewer can delete `created`/`review`; admin required for
  // `approved` / `filed` / `paid`.
  if (locked && force) {
    const roleFail = await requireSession(request);
    if (roleFail) return roleFail;
  }

  // The schema's FK cascades don't chain through declarations →
  // invoices → invoice_lines (NO ACTION all the way — verified via
  // information_schema 2026-04-19). We delete explicitly in
  // dependency order inside a transaction to keep it atomic.
  await execute(
    `WITH deleted_lines AS (
       DELETE FROM invoice_lines WHERE declaration_id = $1 RETURNING id
     ),
     deleted_invoices AS (
       DELETE FROM invoices WHERE declaration_id = $1 RETURNING id
     ),
     deleted_documents AS (
       DELETE FROM documents WHERE declaration_id = $1 RETURNING id
     ),
     deleted_findings AS (
       DELETE FROM validator_findings WHERE declaration_id = $1 RETURNING id
     )
     DELETE FROM declarations WHERE id = $1`,
    [id],
  );

  await logAudit({
    entityId: decl.entity_id,
    declarationId: id,
    action: 'delete',
    targetType: 'declaration',
    targetId: id,
    oldValue: JSON.stringify({ status: decl.status, year: decl.year, period: decl.period }),
  });

  log.info('declaration deleted', { declaration_id: id, status: decl.status, forced: force });
  return NextResponse.json({ ok: true, forced: force });
}
