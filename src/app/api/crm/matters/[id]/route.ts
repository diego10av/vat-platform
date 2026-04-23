import { NextRequest, NextResponse } from 'next/server';
import { queryOne, query, execute, logAudit } from '@/lib/db';
import { apiError } from '@/lib/api-errors';

const UPDATABLE_FIELDS = [
  'matter_reference', 'title', 'client_company_id', 'primary_contact_id',
  'source_opportunity_id', 'status', 'practice_areas', 'fee_type',
  'hourly_rate_eur', 'opening_date', 'closing_date',
  'conflict_check_done', 'conflict_check_date', 'lead_counsel',
  'team_members', 'documents_link', 'notes', 'tags',
  // Stint 27 (Fase 3.1) additions.
  'estimated_budget_eur', 'cap_eur', 'counterparty_name',
  'related_parties', 'conflict_check_result',
] as const;
type UpdatableField = typeof UPDATABLE_FIELDS[number];

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const matter = await queryOne(
    `SELECT m.*, c.company_name AS client_name, c.id AS client_id,
            ct.full_name AS primary_contact_name, ct.id AS primary_contact_id
       FROM crm_matters m
       LEFT JOIN crm_companies c ON c.id = m.client_company_id
       LEFT JOIN crm_contacts ct ON ct.id = m.primary_contact_id
      WHERE m.id = $1 AND m.deleted_at IS NULL`,
    [id],
  );
  if (!matter) return apiError('not_found', 'Matter not found.', { status: 404 });

  const activities = await query(
    `SELECT id, name, activity_type, activity_date, duration_hours, billable, outcome
       FROM crm_activities WHERE matter_id = $1 ORDER BY activity_date DESC`,
    [id],
  );

  const invoices = await query(
    `SELECT id, invoice_number, issue_date, due_date, amount_incl_vat, outstanding, status
       FROM crm_billing_invoices WHERE matter_id = $1 ORDER BY issue_date DESC NULLS LAST`,
    [id],
  );

  return NextResponse.json({ matter, activities, invoices });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const existing = await queryOne<Record<string, unknown>>(
    `SELECT * FROM crm_matters WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  if (!existing) return apiError('not_found', 'Matter not found.', { status: 404 });

  const setClauses: string[] = [];
  const values: unknown[] = [];
  const changed: Array<{ field: UpdatableField; before: unknown; after: unknown }> = [];
  let idx = 1;

  for (const f of UPDATABLE_FIELDS) {
    if (!(f in body)) continue;
    let next = body[f];
    if (typeof next === 'string') next = next.trim() || null;
    if ((f === 'practice_areas' || f === 'team_members' || f === 'tags' || f === 'related_parties') && !Array.isArray(next)) next = [];
    if (f === 'title' && !next) {
      return apiError('title_required', 'title cannot be empty.', { status: 400 });
    }
    if (f === 'matter_reference' && !next) {
      return apiError('matter_reference_required', 'matter_reference cannot be empty.', { status: 400 });
    }
    if ((f === 'hourly_rate_eur' || f === 'estimated_budget_eur' || f === 'cap_eur') && next !== null && next !== undefined) {
      const n = Number(next);
      if (!Number.isFinite(n)) next = null; else next = n;
    }
    if (f === 'conflict_check_done') next = !!next;
    const before = existing[f] ?? null;
    const isJsonField = f === 'conflict_check_result';
    const beforeStr = isJsonField ? JSON.stringify(before) : (Array.isArray(before) ? JSON.stringify(before) : String(before ?? ''));
    const afterStr = isJsonField ? JSON.stringify(next) : (Array.isArray(next) ? JSON.stringify(next) : String(next ?? ''));
    if (beforeStr === afterStr) continue;
    if (isJsonField) {
      setClauses.push(`${f} = $${idx}::jsonb`);
      values.push(next ? JSON.stringify(next) : null);
    } else {
      setClauses.push(`${f} = $${idx}`);
      values.push(next);
    }
    idx += 1;
    changed.push({ field: f, before, after: next });
  }

  if (changed.length === 0) return NextResponse.json({ id, changed: [] });

  setClauses.push(`updated_at = NOW()`);
  values.push(id);
  await execute(
    `UPDATE crm_matters SET ${setClauses.join(', ')} WHERE id = $${idx}`,
    values,
  );

  for (const c of changed) {
    await logAudit({
      action: 'update',
      targetType: 'crm_matter',
      targetId: id,
      field: c.field,
      oldValue: Array.isArray(c.before) ? JSON.stringify(c.before) : String(c.before ?? ''),
      newValue: Array.isArray(c.after) ? JSON.stringify(c.after) : String(c.after ?? ''),
    });
  }

  return NextResponse.json({ id, changed: changed.map(c => c.field) });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const existing = await queryOne<{ id: string; matter_reference: string; title: string }>(
    `SELECT id, matter_reference, title FROM crm_matters WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  if (!existing) return apiError('not_found', 'Matter not found or already deleted.', { status: 404 });

  await execute(
    `UPDATE crm_matters SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [id],
  );
  await logAudit({
    action: 'soft_delete',
    targetType: 'crm_matter',
    targetId: id,
    oldValue: `${existing.matter_reference} — ${existing.title}`,
    reason: 'Moved to trash',
  });
  return NextResponse.json({ id, soft_deleted: true });
}
