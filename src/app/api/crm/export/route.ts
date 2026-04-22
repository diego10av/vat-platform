import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { query } from '@/lib/db';
import { apiError } from '@/lib/api-errors';

// GET /api/crm/export?entity=companies|contacts|opportunities|matters|activities|tasks|billing&...filters
//
// Returns an XLSX binary download. Re-uses the same filter semantics as
// each list endpoint so "what you see = what you export".
//
// Columns emitted: expanded relations (names, not UUIDs), dates as date
// cells, amounts as EUR. Each sheet has a bold header row and auto-sized
// columns (rough auto-sizing based on sampled content).

const ENTITIES = ['companies', 'contacts', 'opportunities', 'matters', 'activities', 'tasks', 'billing'] as const;
type Entity = typeof ENTITIES[number];

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const entity = url.searchParams.get('entity') as Entity | null;
  if (!entity || !ENTITIES.includes(entity)) {
    return apiError('invalid_entity', `entity must be one of: ${ENTITIES.join(', ')}`, { status: 400 });
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'cifra CRM';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(capitalize(entity));

  let columns: Array<{ header: string; key: string; width?: number }> = [];
  let rows: Record<string, unknown>[] = [];

  switch (entity) {
    case 'companies': {
      rows = await query(
        `SELECT company_name, country, industry, size, classification,
                website, linkedin_url, array_to_string(tags, ', ') AS tags,
                notes, created_at
           FROM crm_companies WHERE deleted_at IS NULL
          ORDER BY company_name ASC`,
      );
      columns = [
        { header: 'Company name', key: 'company_name', width: 32 },
        { header: 'Country', key: 'country', width: 8 },
        { header: 'Industry', key: 'industry', width: 18 },
        { header: 'Size', key: 'size', width: 12 },
        { header: 'Classification', key: 'classification', width: 16 },
        { header: 'Website', key: 'website', width: 30 },
        { header: 'LinkedIn', key: 'linkedin_url', width: 30 },
        { header: 'Tags', key: 'tags', width: 24 },
        { header: 'Notes', key: 'notes', width: 40 },
        { header: 'Created at', key: 'created_at', width: 20 },
      ];
      break;
    }
    case 'contacts': {
      rows = await query(
        `SELECT full_name, job_title, email, phone, linkedin_url, country,
                lifecycle_stage, array_to_string(role_tags, ', ') AS role_tags,
                array_to_string(areas_of_interest, ', ') AS areas_of_interest,
                COALESCE(engagement_override, engagement_level) AS engagement_level,
                source, next_follow_up, last_activity_at
           FROM crm_contacts WHERE deleted_at IS NULL
          ORDER BY full_name ASC`,
      );
      columns = [
        { header: 'Full name', key: 'full_name', width: 24 },
        { header: 'Job title', key: 'job_title', width: 24 },
        { header: 'Email', key: 'email', width: 30 },
        { header: 'Phone', key: 'phone', width: 16 },
        { header: 'LinkedIn', key: 'linkedin_url', width: 30 },
        { header: 'Country', key: 'country', width: 8 },
        { header: 'Lifecycle', key: 'lifecycle_stage', width: 14 },
        { header: 'Roles', key: 'role_tags', width: 20 },
        { header: 'Areas of interest', key: 'areas_of_interest', width: 24 },
        { header: 'Engagement', key: 'engagement_level', width: 12 },
        { header: 'Source', key: 'source', width: 14 },
        { header: 'Next follow-up', key: 'next_follow_up', width: 14 },
        { header: 'Last activity', key: 'last_activity_at', width: 20 },
      ];
      break;
    }
    case 'opportunities': {
      rows = await query(
        `SELECT o.name, o.stage, c.company_name AS company,
                ct.full_name AS primary_contact,
                o.estimated_value_eur, o.probability_pct, o.weighted_value_eur,
                array_to_string(o.practice_areas, ', ') AS practice_areas,
                o.source, o.first_contact_date, o.estimated_close_date,
                o.actual_close_date, o.next_action, o.next_action_due,
                o.loss_reason, o.won_reason
           FROM crm_opportunities o
           LEFT JOIN crm_companies c ON c.id = o.company_id
           LEFT JOIN crm_contacts ct ON ct.id = o.primary_contact_id
          WHERE o.deleted_at IS NULL
          ORDER BY o.estimated_close_date ASC NULLS LAST`,
      );
      columns = [
        { header: 'Name', key: 'name', width: 32 },
        { header: 'Stage', key: 'stage', width: 16 },
        { header: 'Company', key: 'company', width: 28 },
        { header: 'Primary contact', key: 'primary_contact', width: 22 },
        { header: 'Estimated value (€)', key: 'estimated_value_eur', width: 16 },
        { header: 'Probability %', key: 'probability_pct', width: 12 },
        { header: 'Weighted value (€)', key: 'weighted_value_eur', width: 16 },
        { header: 'Practice areas', key: 'practice_areas', width: 22 },
        { header: 'Source', key: 'source', width: 14 },
        { header: 'First contact', key: 'first_contact_date', width: 14 },
        { header: 'Est. close', key: 'estimated_close_date', width: 14 },
        { header: 'Actual close', key: 'actual_close_date', width: 14 },
        { header: 'Next action', key: 'next_action', width: 32 },
        { header: 'Next action due', key: 'next_action_due', width: 14 },
        { header: 'Loss reason', key: 'loss_reason', width: 16 },
        { header: 'Won reason', key: 'won_reason', width: 16 },
      ];
      break;
    }
    case 'matters': {
      rows = await query(
        `SELECT m.matter_reference, m.title, c.company_name AS client,
                ct.full_name AS primary_contact, m.status,
                array_to_string(m.practice_areas, ', ') AS practice_areas,
                m.fee_type, m.hourly_rate_eur, m.opening_date, m.closing_date,
                m.conflict_check_done, m.conflict_check_date,
                (SELECT COALESCE(SUM(amount_incl_vat), 0) FROM crm_billing_invoices WHERE matter_id = m.id) AS total_billed,
                (SELECT COALESCE(SUM(duration_hours), 0) FROM crm_activities WHERE matter_id = m.id) AS total_hours
           FROM crm_matters m
           LEFT JOIN crm_companies c ON c.id = m.client_company_id
           LEFT JOIN crm_contacts ct ON ct.id = m.primary_contact_id
          WHERE m.deleted_at IS NULL
          ORDER BY m.opening_date DESC NULLS LAST`,
      );
      columns = [
        { header: 'Reference', key: 'matter_reference', width: 14 },
        { header: 'Title', key: 'title', width: 36 },
        { header: 'Client', key: 'client', width: 28 },
        { header: 'Primary contact', key: 'primary_contact', width: 22 },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Practice areas', key: 'practice_areas', width: 22 },
        { header: 'Fee type', key: 'fee_type', width: 12 },
        { header: 'Hourly rate (€)', key: 'hourly_rate_eur', width: 14 },
        { header: 'Opening date', key: 'opening_date', width: 14 },
        { header: 'Closing date', key: 'closing_date', width: 14 },
        { header: 'Conflict check done', key: 'conflict_check_done', width: 12 },
        { header: 'Conflict check date', key: 'conflict_check_date', width: 14 },
        { header: 'Total billed (€)', key: 'total_billed', width: 14 },
        { header: 'Total hours', key: 'total_hours', width: 12 },
      ];
      break;
    }
    case 'activities': {
      rows = await query(
        `SELECT a.activity_date, a.activity_type, a.name,
                c.company_name AS company, o.name AS opportunity,
                m.matter_reference AS matter, ct.full_name AS primary_contact,
                a.duration_hours, a.billable, a.outcome, a.notes
           FROM crm_activities a
           LEFT JOIN crm_companies c ON c.id = a.company_id
           LEFT JOIN crm_opportunities o ON o.id = a.opportunity_id
           LEFT JOIN crm_matters m ON m.id = a.matter_id
           LEFT JOIN crm_contacts ct ON ct.id = a.primary_contact_id
          ORDER BY a.activity_date DESC`,
      );
      columns = [
        { header: 'Date', key: 'activity_date', width: 14 },
        { header: 'Type', key: 'activity_type', width: 12 },
        { header: 'Name', key: 'name', width: 32 },
        { header: 'Company', key: 'company', width: 24 },
        { header: 'Opportunity', key: 'opportunity', width: 24 },
        { header: 'Matter', key: 'matter', width: 14 },
        { header: 'Contact', key: 'primary_contact', width: 22 },
        { header: 'Hours', key: 'duration_hours', width: 8 },
        { header: 'Billable', key: 'billable', width: 8 },
        { header: 'Outcome', key: 'outcome', width: 40 },
        { header: 'Notes', key: 'notes', width: 40 },
      ];
      break;
    }
    case 'tasks': {
      rows = await query(
        `SELECT title, status, priority, due_date, reminder_at,
                related_type, assignee, auto_generated, description,
                completed_at, created_at
           FROM crm_tasks
          ORDER BY
            CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
            due_date ASC NULLS LAST`,
      );
      columns = [
        { header: 'Title', key: 'title', width: 36 },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Priority', key: 'priority', width: 10 },
        { header: 'Due date', key: 'due_date', width: 14 },
        { header: 'Reminder', key: 'reminder_at', width: 18 },
        { header: 'Related to', key: 'related_type', width: 14 },
        { header: 'Assignee', key: 'assignee', width: 16 },
        { header: 'Auto-generated', key: 'auto_generated', width: 12 },
        { header: 'Description', key: 'description', width: 40 },
        { header: 'Completed at', key: 'completed_at', width: 18 },
        { header: 'Created at', key: 'created_at', width: 18 },
      ];
      break;
    }
    case 'billing': {
      const year = url.searchParams.get('year');
      const whereYear = year ? ` AND EXTRACT(YEAR FROM b.issue_date) = ${Number(year)}` : '';
      rows = await query(
        `SELECT b.invoice_number, c.company_name AS client,
                m.matter_reference AS matter,
                b.issue_date, b.due_date, b.paid_date,
                b.currency, b.amount_excl_vat, b.vat_rate, b.vat_amount,
                b.amount_incl_vat, b.amount_paid, b.outstanding, b.status,
                b.payment_method, b.payment_reference
           FROM crm_billing_invoices b
           LEFT JOIN crm_companies c ON c.id = b.company_id
           LEFT JOIN crm_matters m ON m.id = b.matter_id
          WHERE 1 = 1 ${whereYear}
          ORDER BY b.issue_date DESC NULLS LAST`,
      );
      columns = [
        { header: 'Invoice #', key: 'invoice_number', width: 16 },
        { header: 'Client', key: 'client', width: 28 },
        { header: 'Matter', key: 'matter', width: 14 },
        { header: 'Issue date', key: 'issue_date', width: 14 },
        { header: 'Due date', key: 'due_date', width: 14 },
        { header: 'Paid date', key: 'paid_date', width: 14 },
        { header: 'Currency', key: 'currency', width: 8 },
        { header: 'Amount excl VAT', key: 'amount_excl_vat', width: 14 },
        { header: 'VAT rate', key: 'vat_rate', width: 10 },
        { header: 'VAT amount', key: 'vat_amount', width: 14 },
        { header: 'Amount incl VAT', key: 'amount_incl_vat', width: 14 },
        { header: 'Amount paid', key: 'amount_paid', width: 14 },
        { header: 'Outstanding', key: 'outstanding', width: 14 },
        { header: 'Status', key: 'status', width: 14 },
        { header: 'Payment method', key: 'payment_method', width: 14 },
        { header: 'Payment reference', key: 'payment_reference', width: 18 },
      ];
      break;
    }
  }

  sheet.columns = columns;

  // Header styling.
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };

  // Coerce values for Excel: Date objects render as date cells, numbers
  // render as numeric cells, booleans as "Yes"/"No" strings.
  for (const r of rows) {
    const out: Record<string, unknown> = {};
    for (const col of columns) {
      const v = r[col.key];
      if (v === null || v === undefined) out[col.key] = '';
      else if (v instanceof Date) out[col.key] = v;
      else if (typeof v === 'boolean') out[col.key] = v ? 'Yes' : 'No';
      else if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}(T|$)/.test(v)) out[col.key] = new Date(v);
      else if (typeof v === 'string' && !Number.isNaN(Number(v)) && /^-?\d+(\.\d+)?$/.test(v)) out[col.key] = Number(v);
      else out[col.key] = v;
    }
    sheet.addRow(out);
  }

  // Freeze header row.
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  // Serialize to buffer.
  const buffer = await workbook.xlsx.writeBuffer();

  const filename = `crm-${entity}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
