import { NextRequest, NextResponse } from 'next/server';
import { queryOne, query, execute, logAudit } from '@/lib/db';
import { apiError } from '@/lib/api-errors';
import { getFirmSettings } from '@/lib/crm-firm-settings';

const UPDATABLE_FIELDS = [
  'invoice_number', 'company_id', 'matter_id', 'primary_contact_id',
  'issue_date', 'due_date', 'currency', 'amount_excl_vat', 'vat_rate',
  'vat_amount', 'amount_incl_vat', 'status', 'payment_method',
  'payment_reference', 'paid_date', 'line_items', 'notes',
] as const;
type UpdatableField = typeof UPDATABLE_FIELDS[number];

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const invoice = await queryOne(
    `SELECT b.*, c.company_name AS client_name, c.id AS client_id,
            m.matter_reference AS matter_reference, m.id AS matter_id_fk,
            ct.full_name AS primary_contact_name,
            orig.invoice_number AS original_invoice_number
       FROM crm_billing_invoices b
       LEFT JOIN crm_companies c ON c.id = b.company_id
       LEFT JOIN crm_matters   m ON m.id = b.matter_id
       LEFT JOIN crm_contacts  ct ON ct.id = b.primary_contact_id
       LEFT JOIN crm_billing_invoices orig ON orig.id = b.original_invoice_id
      WHERE b.id = $1`,
    [id],
  );
  if (!invoice) return apiError('not_found', 'Invoice not found.', { status: 404 });

  const payments = await query(
    `SELECT id, amount, payment_date, payment_method, payment_reference, notes, created_at
       FROM crm_billing_payments
      WHERE invoice_id = $1
      ORDER BY payment_date DESC`,
    [id],
  );

  return NextResponse.json({ invoice, payments });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const existing = await queryOne<Record<string, unknown>>(
    `SELECT * FROM crm_billing_invoices WHERE id = $1`,
    [id],
  );
  if (!existing) return apiError('not_found', 'Invoice not found.', { status: 404 });

  const setClauses: string[] = [];
  const values: unknown[] = [];
  const changed: Array<{ field: UpdatableField; before: unknown; after: unknown }> = [];
  let idx = 1;

  for (const f of UPDATABLE_FIELDS) {
    if (!(f in body)) continue;
    let next = body[f];
    if (typeof next === 'string' && f !== 'notes') next = next.trim() || null;
    if (['amount_excl_vat', 'vat_rate', 'vat_amount', 'amount_incl_vat'].includes(f) && next !== null && next !== undefined) {
      const n = Number(next); next = Number.isFinite(n) ? n : null;
    }
    if (f === 'invoice_number' && !next) {
      return apiError('invoice_number_required', 'invoice_number cannot be empty.', { status: 400 });
    }
    const before = existing[f] ?? null;
    const beforeStr = f === 'line_items' ? JSON.stringify(before) : String(before ?? '');
    const afterStr = f === 'line_items' ? JSON.stringify(next) : String(next ?? '');
    if (beforeStr === afterStr) continue;
    if (f === 'line_items') {
      setClauses.push(`${f} = $${idx}::jsonb`);
      values.push(JSON.stringify(next ?? []));
    } else {
      setClauses.push(`${f} = $${idx}`);
      values.push(next);
    }
    idx += 1;
    changed.push({ field: f, before, after: next });
  }

  // Approval gate: if firm requires approval above threshold and this
  // PUT transitions the invoice to an "issued" status (sent/paid/etc.),
  // block unless approved_by is already set on the row.
  const statusChange = changed.find(c => c.field === 'status');
  if (statusChange && ['sent', 'partial_paid', 'paid', 'overdue'].includes(String(statusChange.after ?? ''))
      && !['sent', 'partial_paid', 'paid', 'overdue'].includes(String(existing.status ?? ''))) {
    const firm = await getFirmSettings();
    const threshold = firm.require_approval_above_eur !== null && firm.require_approval_above_eur !== undefined
      ? Number(firm.require_approval_above_eur) : null;
    if (threshold !== null && threshold > 0) {
      const amt = Number(existing.amount_incl_vat ?? 0);
      const approvedBy = (existing.approved_by as string | null) ?? null;
      if (Math.abs(amt) > threshold && !approvedBy) {
        return apiError(
          'approval_required',
          `This invoice (${amt.toFixed(2)} EUR) exceeds the approval threshold (${threshold.toFixed(2)} EUR). Approve it first before changing status to ${statusChange.after}.`,
          { status: 400 },
        );
      }
    }
  }

  if (changed.length === 0) return NextResponse.json({ id, changed: [] });

  setClauses.push(`updated_at = NOW()`);
  values.push(id);
  await execute(
    `UPDATE crm_billing_invoices SET ${setClauses.join(', ')} WHERE id = $${idx}`,
    values,
  );

  for (const c of changed) {
    await logAudit({
      action: 'update',
      targetType: 'crm_invoice',
      targetId: id,
      field: c.field,
      oldValue: c.field === 'line_items' ? JSON.stringify(c.before) : String(c.before ?? ''),
      newValue: c.field === 'line_items' ? JSON.stringify(c.after) : String(c.after ?? ''),
    });
  }

  // Stint 96 — runAutomations() removed. Invoice status transitions
  // used to spawn a "confirm receipt" task on send; Diego tracks
  // that off the /crm/billing list directly.
  return NextResponse.json({ id, changed: changed.map(c => c.field) });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const existing = await queryOne<{ id: string; invoice_number: string; status: string }>(
    `SELECT id, invoice_number, status FROM crm_billing_invoices WHERE id = $1`,
    [id],
  );
  if (!existing) return apiError('not_found', 'Invoice not found.', { status: 404 });

  // Invoices: no soft-delete column. Allow delete only on 'draft' or
  // 'cancelled'. For sent/paid/overdue invoices, require changing
  // status to 'cancelled' first (audit-safe pattern for financial docs).
  if (!['draft', 'cancelled'].includes(existing.status)) {
    return apiError(
      'cannot_delete',
      `Cannot delete a ${existing.status} invoice. Set status to 'cancelled' first (preserves audit trail).`,
      { status: 400 },
    );
  }

  await execute(`DELETE FROM crm_billing_invoices WHERE id = $1`, [id]);
  await logAudit({
    action: 'delete',
    targetType: 'crm_invoice',
    targetId: id,
    oldValue: existing.invoice_number,
    reason: `Deleted ${existing.status} invoice`,
  });
  return NextResponse.json({ id, deleted: true });
}
