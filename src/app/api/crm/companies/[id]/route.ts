import { NextRequest, NextResponse } from 'next/server';
import { queryOne, query, execute, logAudit } from '@/lib/db';
import { apiError } from '@/lib/api-errors';

// Columns on crm_companies that accept UPDATE via the PUT endpoint.
// Explicit whitelist — the API doesn't trust client-sent field names.
const UPDATABLE_FIELDS = [
  'company_name', 'country', 'industry', 'size', 'classification',
  'website', 'linkedin_url', 'tags', 'notes', 'lead_counsel', 'entity_id',
] as const;
type UpdatableField = typeof UPDATABLE_FIELDS[number];

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const company = await queryOne(
    `SELECT * FROM crm_companies WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  if (!company) return apiError('not_found', 'Company not found.', { status: 404 });

  // Pull related contacts via junction.
  const contacts = await query(
    `SELECT c.id, c.full_name, c.email, c.job_title, cc.role, cc.is_primary
       FROM crm_contact_companies cc
       JOIN crm_contacts c ON c.id = cc.contact_id
      WHERE cc.company_id = $1 AND c.deleted_at IS NULL
      ORDER BY cc.is_primary DESC, c.full_name ASC`,
    [id],
  );

  const opportunities = await query(
    `SELECT id, name, stage, estimated_value_eur, probability_pct, weighted_value_eur,
            estimated_close_date
       FROM crm_opportunities
      WHERE company_id = $1 AND deleted_at IS NULL
      ORDER BY
        CASE stage
          WHEN 'in_negotiation'  THEN 0
          WHEN 'proposal_sent'   THEN 1
          WHEN 'meeting_held'    THEN 2
          WHEN 'initial_contact' THEN 3
          WHEN 'lead_identified' THEN 4
          WHEN 'won'             THEN 5
          WHEN 'lost'            THEN 6
          ELSE 7
        END,
        estimated_close_date ASC NULLS LAST`,
    [id],
  );

  const matters = await query(
    `SELECT id, matter_reference, title, status, practice_areas, opening_date, closing_date
       FROM crm_matters
      WHERE client_company_id = $1 AND deleted_at IS NULL
      ORDER BY status ASC, opening_date DESC NULLS LAST`,
    [id],
  );

  const invoices = await query(
    `SELECT id, invoice_number, issue_date, due_date, amount_incl_vat, outstanding, status
       FROM crm_billing_invoices
      WHERE company_id = $1
      ORDER BY issue_date DESC NULLS LAST`,
    [id],
  );

  return NextResponse.json({ company, contacts, opportunities, matters, invoices });
}

// PUT /api/crm/companies/[id] — partial update. Only fields present in
// body and listed in UPDATABLE_FIELDS are written. Each changed field
// emits its own audit_log row so the History panel shows a clean
// before/after per column.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const existing = await queryOne<Record<string, unknown>>(
    `SELECT * FROM crm_companies WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  if (!existing) return apiError('not_found', 'Company not found.', { status: 404 });

  const setClauses: string[] = [];
  const values: unknown[] = [];
  const changed: Array<{ field: UpdatableField; before: unknown; after: unknown }> = [];
  let idx = 1;

  for (const f of UPDATABLE_FIELDS) {
    if (!(f in body)) continue;
    let next = body[f];
    // Normalize: strings trim; empty string → null.
    if (typeof next === 'string') next = next.trim() || null;
    // Tags: force array.
    if (f === 'tags' && !Array.isArray(next)) next = [];
    if (f === 'company_name' && !next) {
      return apiError('company_name_required', 'company_name cannot be empty.', { status: 400 });
    }
    const before = existing[f] ?? null;
    // Compare — treat arrays as JSON-equal for tags.
    const beforeStr = Array.isArray(before) ? JSON.stringify(before) : String(before ?? '');
    const afterStr = Array.isArray(next) ? JSON.stringify(next) : String(next ?? '');
    if (beforeStr === afterStr) continue;
    setClauses.push(`${f} = $${idx}`);
    values.push(next);
    idx += 1;
    changed.push({ field: f, before, after: next });
  }

  if (changed.length === 0) {
    return NextResponse.json({ id, changed: [] });
  }

  setClauses.push(`updated_at = NOW()`);
  values.push(id);
  await execute(
    `UPDATE crm_companies SET ${setClauses.join(', ')} WHERE id = $${idx}`,
    values,
  );

  for (const c of changed) {
    await logAudit({
      action: 'update',
      targetType: 'crm_company',
      targetId: id,
      field: c.field,
      oldValue: Array.isArray(c.before) ? JSON.stringify(c.before) : String(c.before ?? ''),
      newValue: Array.isArray(c.after) ? JSON.stringify(c.after) : String(c.after ?? ''),
    });
  }

  return NextResponse.json({ id, changed: changed.map(c => c.field) });
}

// DELETE /api/crm/companies/[id] — soft delete (sets deleted_at = NOW()).
// Hard delete is only done from /crm/trash (permanent purge route) or
// by the scheduled 30-day purge task.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const existing = await queryOne<{ id: string; company_name: string }>(
    `SELECT id, company_name FROM crm_companies WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  if (!existing) return apiError('not_found', 'Company not found or already deleted.', { status: 404 });

  await execute(
    `UPDATE crm_companies SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [id],
  );
  await logAudit({
    action: 'soft_delete',
    targetType: 'crm_company',
    targetId: id,
    oldValue: existing.company_name,
    reason: 'Moved to trash',
  });
  return NextResponse.json({ id, soft_deleted: true });
}
