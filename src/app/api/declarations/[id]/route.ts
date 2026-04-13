import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne, execute, logAudit, initializeSchema } from '@/lib/db';
import { canTransition, type DeclarationStatus } from '@/lib/lifecycle';

// GET /api/declarations/:id
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await initializeSchema();
  const { id } = await params;

  const declaration = await queryOne(
    `SELECT d.*, e.name as entity_name, e.regime, e.frequency, e.has_fx, e.has_outgoing, e.has_recharges,
            e.vat_number, e.matricule
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

  const lines = await query(
    `SELECT il.*, i.provider, i.provider_vat, i.country, i.invoice_date, i.invoice_number,
            i.direction, i.currency, i.currency_amount, i.ecb_rate, i.document_id,
            d.filename as source_filename
     FROM invoice_lines il
     JOIN invoices i ON il.invoice_id = i.id
     JOIN documents d ON i.document_id = d.id
     WHERE il.declaration_id = $1
     ORDER BY il.sort_order ASC, i.provider ASC`,
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
    }
    if (newStatus === 'filed' && body.filing_ref) {
      extra += `, filing_ref = $${idx}, filed_at = NOW()`;
      values.push(body.filing_ref);
      idx++;
    }
    if (newStatus === 'paid') {
      extra += `, payment_confirmed_at = NOW()`;
    }

    values.push(id);
    await execute(`UPDATE declarations SET status = $1, updated_at = NOW()${extra} WHERE id = $${idx}`, values);

    await logAudit({
      entityId: declaration.entity_id as string,
      declarationId: id,
      action: newStatus === 'approved' ? 'approve' : newStatus === 'review' && currentStatus === 'approved' ? 'reopen' : 'update',
      targetType: 'declaration', targetId: id,
      field: 'status', oldValue: currentStatus, newValue: newStatus,
    });
  }

  if (body.notes !== undefined) {
    await execute('UPDATE declarations SET notes = $1, updated_at = NOW() WHERE id = $2', [body.notes, id]);
  }
  if (body.payment_ref !== undefined) {
    await execute('UPDATE declarations SET payment_ref = $1, updated_at = NOW() WHERE id = $2', [body.payment_ref, id]);
  }

  const updated = await queryOne(
    `SELECT d.*, e.name as entity_name, e.regime, e.frequency, e.has_fx, e.has_outgoing
     FROM declarations d JOIN entities e ON d.entity_id = e.id WHERE d.id = $1`,
    [id]
  );
  return NextResponse.json(updated);
}
