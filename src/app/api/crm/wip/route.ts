import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

// GET /api/crm/wip — Work-in-Progress dashboard data.
// Returns: per-matter unbilled hours + amount at their matter rate,
// sorted by unbilled amount descending.
export async function GET() {
  const rows = await query(
    `SELECT
        m.id AS matter_id,
        m.matter_reference,
        m.title,
        m.status,
        c.company_name AS client_name,
        m.estimated_budget_eur,
        m.cap_eur,
        (SELECT COALESCE(SUM(amount_incl_vat), 0) FROM crm_billing_invoices WHERE matter_id = m.id) AS billed,
        (SELECT COALESCE(SUM(te.hours), 0) FROM crm_time_entries te WHERE te.matter_id = m.id) AS total_hours,
        (SELECT COALESCE(SUM(te.hours), 0) FROM crm_time_entries te
          WHERE te.matter_id = m.id AND te.billable = true AND te.billed_on_invoice_id IS NULL) AS unbilled_hours,
        (SELECT COALESCE(SUM(te.hours * COALESCE(te.rate_eur, m.hourly_rate_eur)), 0)
           FROM crm_time_entries te
          WHERE te.matter_id = m.id AND te.billable = true AND te.billed_on_invoice_id IS NULL) AS unbilled_amount
       FROM crm_matters m
       LEFT JOIN crm_companies c ON c.id = m.client_company_id
      WHERE m.deleted_at IS NULL AND m.status IN ('active', 'on_hold')
      ORDER BY unbilled_amount DESC NULLS LAST, m.opening_date DESC NULLS LAST`,
  );

  const totalWipAmount = rows.reduce((s, r) => s + Number((r as { unbilled_amount?: string | number }).unbilled_amount ?? 0), 0);
  const totalWipHours = rows.reduce((s, r) => s + Number((r as { unbilled_hours?: string | number }).unbilled_hours ?? 0), 0);

  return NextResponse.json({
    matters: rows,
    total_wip_amount: totalWipAmount,
    total_wip_hours: totalWipHours,
  });
}
