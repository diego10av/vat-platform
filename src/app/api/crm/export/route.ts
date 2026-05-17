import { NextRequest, NextResponse } from 'next/server';
import ExcelJS, { type Worksheet } from 'exceljs';
import { query } from '@/lib/db';
import { apiError } from '@/lib/api-errors';

// ════════════════════════════════════════════════════════════════════════
// GET /api/crm/export?entity=companies|contacts|opportunities|matters|activities|tasks|billing&...filters
//
// Returns an XLSX binary download. Re-uses the same filter semantics as
// each list endpoint so "what you see = what you export".
//
// Stint 64.G follow-up — Diego: "el formato podía ser mejorable. si yo
// anoto el numero de factura no aparece pegado a la izquierda. las
// cantidades no aparecen con un formato accounting sino general." Right
// call. The previous export was correct (numbers as numbers, dates as
// dates, frozen header, light-gray fill) but UNFORMATTED at the cell
// level — Excel falls back to the "General" format which gives the
// drift Diego saw: amounts without "€", manual text not pinned to the
// left, no thousands separator, no autofilter.
//
// This rewrite introduces a column-level `format` discriminator and a
// `decorateSheet` helper that applies one consistent professional
// look across every CRM export:
//
//   • Header row: bold white text on slate-800 fill, height 24, centered,
//     autofilter enabled, bottom border medium. Frozen.
//   • Body cells: Calibri 11, vertically middle-aligned, horizontally
//     aligned by column type (text → left, numbers/dates → right,
//     yes/no → center). Subtle bottom border on every row.
//   • Money columns: true Excel accounting format `_-* #,##0.00\ "€"_-…`
//     with negatives shown with leading dash, zero shown as "-".
//   • Percentages: `0.0%`. Hours: `#,##0.00`. Counts: `#,##0`.
//     Dates: `dd/mm/yyyy` (LU/EU). Datetimes: `dd/mm/yyyy hh:mm`.
//   • Totals row at the bottom for sheets with money or hour columns
//     (billing, opportunities, matters, activities) — bold, top border
//     medium, SUM formulas (not hardcoded values, so the export stays
//     dynamic if the user edits cells later).
//
// Column metadata: each column declares { header, key, width, format }.
// Format drives every styling choice downstream — adding a new column
// means only adding a row to the descriptor, never touching the
// rendering pass.
// ════════════════════════════════════════════════════════════════════════

const ENTITIES = ['companies', 'contacts', 'opportunities', 'matters', 'activities', 'tasks', 'billing'] as const;
type Entity = typeof ENTITIES[number];

// ─────────────────────────── Format primitives ────────────────────────

type ColumnFormat =
  | 'text'        // plain string, left-aligned
  | 'longtext'    // string with wrap, wider
  | 'currency'    // accounting format with €, right-aligned, totals-eligible
  | 'percentage'  // 0.0%, right-aligned
  | 'integer'     // #,##0, right-aligned
  | 'decimal'     // #,##0.00, right-aligned, totals-eligible
  | 'date'        // dd/mm/yyyy, right-aligned
  | 'datetime'    // dd/mm/yyyy hh:mm, right-aligned
  | 'yesno'       // "Yes"/"No", centered
  | 'status';     // status label, left-aligned

interface ColumnDef {
  header: string;
  key: string;
  width: number;
  format: ColumnFormat;
}

// True Excel accounting format with the EUR symbol on the right:
//   1 234,56 €     (positive)
//  -1 234,56 €     (negative — leading dash, vertically aligned)
//          -   €   (zero shown as em dash, vertically aligned)
//   <text>         (any text just renders as-is)
const FMT_CURRENCY  = '_-* #,##0.00\\ "€"_-;-* #,##0.00\\ "€"_-;_-* "-"??\\ "€"_-;_-@_-';
const FMT_PERCENT   = '0.0%';
const FMT_INTEGER   = '#,##0';
const FMT_DECIMAL   = '#,##0.00';
const FMT_DATE      = 'dd/mm/yyyy';
const FMT_DATETIME  = 'dd/mm/yyyy hh:mm';

// Lookup tables wired up once.
const NUM_FMT: Record<ColumnFormat, string | undefined> = {
  text:       undefined,
  longtext:   undefined,
  currency:   FMT_CURRENCY,
  percentage: FMT_PERCENT,
  integer:    FMT_INTEGER,
  decimal:    FMT_DECIMAL,
  date:       FMT_DATE,
  datetime:   FMT_DATETIME,
  yesno:      undefined,
  status:     undefined,
};

const ALIGN_H: Record<ColumnFormat, 'left' | 'right' | 'center'> = {
  text:       'left',
  longtext:   'left',
  currency:   'right',
  percentage: 'right',
  integer:    'right',
  decimal:    'right',
  date:       'right',
  datetime:   'right',
  yesno:      'center',
  status:     'left',
};

// Header alignment mirrors body alignment — easier to scan when the
// label sits over the same edge as the values.
const HEADER_ALIGN_H: Record<ColumnFormat, 'left' | 'right' | 'center'> = {
  text:       'left',
  longtext:   'left',
  currency:   'right',
  percentage: 'right',
  integer:    'right',
  decimal:    'right',
  date:       'center',
  datetime:   'center',
  yesno:      'center',
  status:     'left',
};

// Money + hours columns get summed in the totals row.
const TOTALS_ELIGIBLE: Set<ColumnFormat> = new Set(['currency', 'decimal']);

// ─────────────────────────── Decorator ────────────────────────────────

function decorateSheet(
  sheet: Worksheet,
  columns: ColumnDef[],
  options: { totals?: boolean } = {},
): void {
  // Default font for every cell unless overridden — Calibri 11 is the
  // de-facto modern Excel font (Stripe / HubSpot / Xero outputs all
  // ship with it; Microsoft made it the default in Office 2007+).
  // Setting this on cells we touch; ExcelJS doesn't provide a true
  // workbook-default font, so we paint header + body explicitly.
  const FONT_BODY   = { name: 'Calibri', size: 11, color: { argb: 'FF1F2937' } };
  const FONT_HEADER = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };

  // ── Header row ──
  const headerRow = sheet.getRow(1);
  headerRow.height = 24;
  for (let i = 0; i < columns.length; i += 1) {
    const cell = headerRow.getCell(i + 1);
    cell.value = columns[i]!.header;
    cell.font = FONT_HEADER;
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      // Tailwind slate-800 — calm, premium, prints well in B&W too.
      fgColor: { argb: 'FF1F2937' },
    };
    cell.alignment = {
      vertical: 'middle',
      horizontal: HEADER_ALIGN_H[columns[i]!.format],
      indent: 1,
    };
    cell.border = {
      bottom: { style: 'medium', color: { argb: 'FF111827' } },
    };
  }

  // ── Column-level format strings + widths ──
  for (let i = 0; i < columns.length; i += 1) {
    const col = sheet.getColumn(i + 1);
    col.width = columns[i]!.width;
    const fmt = NUM_FMT[columns[i]!.format];
    if (fmt) col.numFmt = fmt;
  }

  // ── Body rows ──
  const lastDataRow = sheet.rowCount;
  for (let r = 2; r <= lastDataRow; r += 1) {
    const row = sheet.getRow(r);
    row.height = 18;
    for (let i = 0; i < columns.length; i += 1) {
      const cell = row.getCell(i + 1);
      cell.font = FONT_BODY;
      cell.alignment = {
        vertical: 'middle',
        horizontal: ALIGN_H[columns[i]!.format],
        wrapText: columns[i]!.format === 'longtext',
        indent: 1,
      };
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      };
    }
  }

  // ── AutoFilter across the data range ──
  if (lastDataRow >= 1 && columns.length > 0) {
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to:   { row: Math.max(1, lastDataRow), column: columns.length },
    };
  }

  // ── Totals row ──
  if (options.totals && lastDataRow >= 2) {
    const totalRow = sheet.addRow([]);
    totalRow.height = 22;
    let labelPlaced = false;
    for (let i = 0; i < columns.length; i += 1) {
      const c = columns[i]!;
      const cell = totalRow.getCell(i + 1);
      cell.font = { ...FONT_BODY, bold: true };
      cell.alignment = {
        vertical: 'middle',
        horizontal: ALIGN_H[c.format],
        indent: 1,
      };
      cell.border = {
        top:    { style: 'medium', color: { argb: 'FF111827' } },
        bottom: { style: 'medium', color: { argb: 'FF111827' } },
      };
      if (TOTALS_ELIGIBLE.has(c.format)) {
        // Excel column letter (A, B, …, AA, …)
        const letter = colLetter(i + 1);
        cell.value = { formula: `SUM(${letter}2:${letter}${lastDataRow})` };
        const fmt = NUM_FMT[c.format];
        if (fmt) cell.numFmt = fmt;
      } else if (!labelPlaced && c.format !== 'yesno') {
        cell.value = 'TOTAL';
        labelPlaced = true;
      }
    }
  }

  // ── Freeze header ──
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

function colLetter(n: number): string {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// ─────────────────────────── Value coercion ───────────────────────────
//
// Convert raw DB values into the right cell type based on column format.
// Numeric strings (Postgres returns numerics as strings) become numbers
// for currency/decimal/integer/percentage columns. Date-shaped strings
// become Date objects for date/datetime columns. Booleans become
// "Yes"/"No" for yesno columns.

function coerce(raw: unknown, format: ColumnFormat): string | number | Date | null {
  if (raw === null || raw === undefined || raw === '') return null;

  switch (format) {
    case 'currency':
    case 'decimal':
    case 'integer': {
      const n = typeof raw === 'number' ? raw : Number(String(raw));
      return Number.isFinite(n) ? n : null;
    }
    case 'percentage': {
      // DB stores percentages as 17.00 (= 17%), Excel expects 0.17.
      const n = typeof raw === 'number' ? raw : Number(String(raw));
      if (!Number.isFinite(n)) return null;
      return n > 1 ? n / 100 : n;
    }
    case 'date':
    case 'datetime': {
      if (raw instanceof Date) return raw;
      const s = String(raw);
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
        const d = new Date(s);
        return Number.isNaN(d.getTime()) ? s : d;
      }
      return s;
    }
    case 'yesno':
      return raw === true || raw === 'true' || raw === 't' ? 'Yes'
           : raw === false || raw === 'false' || raw === 'f' ? 'No'
           : String(raw);
    default:
      return String(raw);
  }
}

// ─────────────────────────── Route ────────────────────────────────────

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

  let columns: ColumnDef[] = [];
  let rows: Record<string, unknown>[] = [];
  let withTotals = false;

  switch (entity) {
    case 'companies': {
      rows = await query(
        `SELECT company_name, country, industry, size, classification,
                website, linkedin_url, array_to_string(tags, ', ') AS tags,
                notes, created_at
           FROM crm_companies
          ORDER BY company_name ASC`,
      );
      columns = [
        { header: 'Company name',   key: 'company_name',    width: 32, format: 'text' },
        { header: 'Country',        key: 'country',         width: 10, format: 'text' },
        { header: 'Industry',       key: 'industry',        width: 18, format: 'text' },
        { header: 'Size',           key: 'size',            width: 12, format: 'text' },
        { header: 'Classification', key: 'classification',  width: 16, format: 'text' },
        { header: 'Website',        key: 'website',         width: 30, format: 'text' },
        { header: 'LinkedIn',       key: 'linkedin_url',    width: 30, format: 'text' },
        { header: 'Tags',           key: 'tags',            width: 24, format: 'text' },
        { header: 'Notes',          key: 'notes',           width: 50, format: 'longtext' },
        { header: 'Created at',     key: 'created_at',      width: 18, format: 'datetime' },
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
           FROM crm_contacts
          ORDER BY full_name ASC`,
      );
      columns = [
        { header: 'Full name',         key: 'full_name',          width: 24, format: 'text' },
        { header: 'Job title',         key: 'job_title',          width: 24, format: 'text' },
        { header: 'Email',             key: 'email',              width: 30, format: 'text' },
        { header: 'Phone',             key: 'phone',              width: 16, format: 'text' },
        { header: 'LinkedIn',          key: 'linkedin_url',       width: 30, format: 'text' },
        { header: 'Country',           key: 'country',            width: 10, format: 'text' },
        { header: 'Lifecycle',         key: 'lifecycle_stage',    width: 14, format: 'status' },
        { header: 'Roles',             key: 'role_tags',          width: 22, format: 'text' },
        { header: 'Areas of interest', key: 'areas_of_interest',  width: 24, format: 'text' },
        { header: 'Engagement',        key: 'engagement_level',   width: 14, format: 'status' },
        { header: 'Source',            key: 'source',             width: 14, format: 'text' },
        { header: 'Next follow-up',    key: 'next_follow_up',     width: 14, format: 'date' },
        { header: 'Last activity',     key: 'last_activity_at',   width: 18, format: 'datetime' },
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
          ORDER BY o.estimated_close_date ASC NULLS LAST`,
      );
      columns = [
        { header: 'Name',             key: 'name',                  width: 32, format: 'text' },
        { header: 'Stage',            key: 'stage',                 width: 16, format: 'status' },
        { header: 'Company',          key: 'company',               width: 28, format: 'text' },
        { header: 'Primary contact',  key: 'primary_contact',       width: 22, format: 'text' },
        { header: 'Estimated value',  key: 'estimated_value_eur',   width: 18, format: 'currency' },
        { header: 'Probability',      key: 'probability_pct',       width: 12, format: 'percentage' },
        { header: 'Weighted value',   key: 'weighted_value_eur',    width: 18, format: 'currency' },
        { header: 'Practice areas',   key: 'practice_areas',        width: 22, format: 'text' },
        { header: 'Source',           key: 'source',                width: 14, format: 'text' },
        { header: 'First contact',    key: 'first_contact_date',    width: 14, format: 'date' },
        { header: 'Est. close',       key: 'estimated_close_date',  width: 14, format: 'date' },
        { header: 'Actual close',     key: 'actual_close_date',     width: 14, format: 'date' },
        { header: 'Next action',      key: 'next_action',           width: 32, format: 'longtext' },
        { header: 'Next action due',  key: 'next_action_due',       width: 14, format: 'date' },
        { header: 'Loss reason',      key: 'loss_reason',           width: 16, format: 'text' },
        { header: 'Won reason',       key: 'won_reason',            width: 16, format: 'text' },
      ];
      withTotals = true;
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
          ORDER BY m.opening_date DESC NULLS LAST`,
      );
      columns = [
        { header: 'Reference',           key: 'matter_reference',     width: 16, format: 'text' },
        { header: 'Title',               key: 'title',                width: 36, format: 'text' },
        { header: 'Client',              key: 'client',               width: 28, format: 'text' },
        { header: 'Primary contact',     key: 'primary_contact',      width: 22, format: 'text' },
        { header: 'Status',              key: 'status',               width: 14, format: 'status' },
        { header: 'Practice areas',      key: 'practice_areas',       width: 22, format: 'text' },
        { header: 'Fee type',            key: 'fee_type',             width: 14, format: 'text' },
        { header: 'Hourly rate',         key: 'hourly_rate_eur',      width: 16, format: 'currency' },
        { header: 'Opening date',        key: 'opening_date',         width: 14, format: 'date' },
        { header: 'Closing date',        key: 'closing_date',         width: 14, format: 'date' },
        { header: 'Conflict check done', key: 'conflict_check_done',  width: 14, format: 'yesno' },
        { header: 'Conflict check date', key: 'conflict_check_date',  width: 14, format: 'date' },
        { header: 'Total billed',        key: 'total_billed',         width: 18, format: 'currency' },
        { header: 'Total hours',         key: 'total_hours',          width: 12, format: 'decimal' },
      ];
      withTotals = true;
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
        { header: 'Date',         key: 'activity_date',     width: 14, format: 'date' },
        { header: 'Type',         key: 'activity_type',     width: 14, format: 'text' },
        { header: 'Name',         key: 'name',              width: 32, format: 'text' },
        { header: 'Company',      key: 'company',           width: 24, format: 'text' },
        { header: 'Opportunity',  key: 'opportunity',       width: 24, format: 'text' },
        { header: 'Matter',       key: 'matter',            width: 16, format: 'text' },
        { header: 'Contact',      key: 'primary_contact',   width: 22, format: 'text' },
        { header: 'Hours',        key: 'duration_hours',    width: 10, format: 'decimal' },
        { header: 'Billable',     key: 'billable',          width: 10, format: 'yesno' },
        { header: 'Outcome',      key: 'outcome',           width: 40, format: 'longtext' },
        { header: 'Notes',        key: 'notes',             width: 40, format: 'longtext' },
      ];
      withTotals = true;
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
        { header: 'Title',          key: 'title',           width: 36, format: 'text' },
        { header: 'Status',         key: 'status',          width: 14, format: 'status' },
        { header: 'Priority',       key: 'priority',        width: 12, format: 'status' },
        { header: 'Due date',       key: 'due_date',        width: 14, format: 'date' },
        { header: 'Reminder',       key: 'reminder_at',     width: 18, format: 'datetime' },
        { header: 'Related to',     key: 'related_type',    width: 14, format: 'text' },
        { header: 'Assignee',       key: 'assignee',        width: 16, format: 'text' },
        { header: 'Auto-generated', key: 'auto_generated',  width: 14, format: 'yesno' },
        { header: 'Description',    key: 'description',     width: 40, format: 'longtext' },
        { header: 'Completed at',   key: 'completed_at',    width: 18, format: 'datetime' },
        { header: 'Created at',     key: 'created_at',      width: 18, format: 'datetime' },
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
        { header: 'Invoice #',         key: 'invoice_number',    width: 18, format: 'text' },
        { header: 'Client',            key: 'client',            width: 30, format: 'text' },
        { header: 'Matter',            key: 'matter',            width: 16, format: 'text' },
        { header: 'Issue date',        key: 'issue_date',        width: 14, format: 'date' },
        { header: 'Due date',          key: 'due_date',          width: 14, format: 'date' },
        { header: 'Paid date',         key: 'paid_date',         width: 14, format: 'date' },
        { header: 'Currency',          key: 'currency',          width: 10, format: 'text' },
        { header: 'Amount excl. VAT',  key: 'amount_excl_vat',   width: 18, format: 'currency' },
        { header: 'VAT rate',          key: 'vat_rate',          width: 10, format: 'percentage' },
        { header: 'VAT amount',        key: 'vat_amount',        width: 16, format: 'currency' },
        { header: 'Amount incl. VAT',  key: 'amount_incl_vat',   width: 18, format: 'currency' },
        { header: 'Amount paid',       key: 'amount_paid',       width: 16, format: 'currency' },
        { header: 'Outstanding',       key: 'outstanding',       width: 16, format: 'currency' },
        { header: 'Status',            key: 'status',            width: 14, format: 'status' },
        { header: 'Payment method',    key: 'payment_method',    width: 16, format: 'text' },
        { header: 'Payment reference', key: 'payment_reference', width: 22, format: 'text' },
      ];
      withTotals = true;
      break;
    }
  }

  // Header row first (decorateSheet expects row 1 to exist before
  // counting body rows; we add it from the column descriptors so the
  // labels stay defined in one place).
  sheet.addRow(columns.map(c => c.header));

  // Body rows.
  for (const r of rows) {
    const out: Array<string | number | Date | null> = [];
    for (const col of columns) {
      out.push(coerce(r[col.key], col.format));
    }
    sheet.addRow(out);
  }

  decorateSheet(sheet, columns, { totals: withTotals });

  // Serialize.
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
