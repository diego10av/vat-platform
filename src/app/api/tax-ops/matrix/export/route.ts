import { NextRequest } from 'next/server';
import ExcelJS from 'exceljs';
import { query } from '@/lib/db';

// ════════════════════════════════════════════════════════════════════════
// GET /api/tax-ops/matrix/export
//   Streams an .xlsx export of the matrix view, same query shape as
//   /api/tax-ops/matrix. Used by the "Export Excel" button on every
//   tax-type category page.
//
//   - Sheet name = tax_type + year
//   - Columns: Group | Entity | <period labels…> | Prepared with | Comments
//     + one row per entity
//   - Status badge rendered as the label text; deadline is embedded in
//     a second invisible row for audit reference (hidden by default,
//     enabled via freeze-panes below).
//
// Implementation stays consistent with stint 28's `/api/crm/export` —
// same use of exceljs, same writeBuffer → ArrayBuffer shape.
// ════════════════════════════════════════════════════════════════════════

const PATTERN_OF = (tax_type: string): string => {
  if (tax_type.endsWith('_quarterly')) return 'quarterly';
  if (tax_type.endsWith('_monthly')) return 'monthly';
  if (tax_type.endsWith('_semester')) return 'semester';
  return 'annual';
};

function periodLabelsFor(pattern: string, year: number): string[] {
  if (pattern === 'annual')   return [String(year)];
  if (pattern === 'quarterly') return ['Q1', 'Q2', 'Q3', 'Q4'].map(q => `${year}-${q}`);
  if (pattern === 'monthly') {
    return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  }
  if (pattern === 'semester') return [`${year}-S1`, `${year}-S2`];
  return [];
}

function shortPeriodLabel(label: string): string {
  const quarterMatch = label.match(/^\d{4}-(Q[1-4])$/);
  if (quarterMatch) return quarterMatch[1]!;
  const monthMatch = label.match(/^\d{4}-(\d{2})$/);
  if (monthMatch) {
    const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return names[Number(monthMatch[1]) - 1] ?? monthMatch[1]!;
  }
  return label;
}

function humanStatus(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function humanTaxType(t: string): string {
  return t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

interface Row {
  entity_id: string;
  legal_name: string;
  group_name: string | null;
  obligation_id: string | null;
}

interface FilingRow {
  obligation_id: string;
  period_label: string;
  status: string;
  deadline_date: string | null;
  comments: string | null;
  prepared_with: string[];
  /** Stint 43.D11 — split ownership. */
  partner_in_charge: string[];
  associates_working: string[];
  /** Stint 39.F — last chase date; surfaced in export too. */
  last_info_request_sent_at: string | null;
  /** Stint 43.D6 — last action date (auto-stamped). */
  last_action_at: string | null;
  /** Stint 40.O — invoice price + note. */
  invoice_price_eur: string | null;
  invoice_price_note: string | null;
  /** Stint 52 — separate ISS / Intra-community Supply of Services price + note. */
  invoice_price_iss_eur: string | null;
  invoice_price_iss_note: string | null;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const tax_type = url.searchParams.get('tax_type');
  const yearStr = url.searchParams.get('year');
  const period_pattern = url.searchParams.get('period_pattern') ?? (tax_type ? PATTERN_OF(tax_type) : 'annual');
  const service_kind = url.searchParams.get('service_kind') ?? 'filing';
  const showInactive = url.searchParams.get('show_inactive') === '1';

  if (!tax_type || !yearStr) {
    return new Response(JSON.stringify({ error: 'tax_type_and_year_required' }), { status: 400 });
  }
  const year = Number(yearStr);
  if (!Number.isFinite(year)) {
    return new Response(JSON.stringify({ error: 'invalid_year' }), { status: 400 });
  }

  const periodLabels = periodLabelsFor(period_pattern, year);

  // Entity set — same logic as /api/tax-ops/matrix.
  // Stint 40.H — match matrix view's rule: keep entities liquidated
  // in-year visible so exports cover the complete year.
  const entityQuery = showInactive
    ? `
      SELECT e.id AS entity_id, e.legal_name,
             g.name AS group_name,
             (SELECT o.id FROM tax_obligations o
               WHERE o.entity_id = e.id
                 AND o.tax_type = $1
                 AND o.period_pattern = $2
                 AND o.service_kind = $3
                 AND o.is_active = TRUE
               LIMIT 1) AS obligation_id
        FROM tax_entities e
        LEFT JOIN tax_client_groups g ON g.id = e.client_group_id
       WHERE (e.is_active = TRUE
              OR (e.liquidation_date IS NOT NULL AND e.liquidation_date >= make_date($4::int, 1, 1)))
       ORDER BY g.name ASC NULLS LAST, e.legal_name ASC
      `
    : `
      SELECT e.id AS entity_id, e.legal_name,
             g.name AS group_name,
             o.id AS obligation_id
        FROM tax_obligations o
        JOIN tax_entities e ON e.id = o.entity_id
        LEFT JOIN tax_client_groups g ON g.id = e.client_group_id
       WHERE o.tax_type = $1
         AND o.period_pattern = $2
         AND o.service_kind = $3
         AND o.is_active = TRUE
         AND (e.is_active = TRUE
              OR (e.liquidation_date IS NOT NULL AND e.liquidation_date >= make_date($4::int, 1, 1)))
       ORDER BY g.name ASC NULLS LAST, e.legal_name ASC
      `;
  const entities = await query<Row>(entityQuery, [tax_type, period_pattern, service_kind, year]);

  const obligationIds = entities.map(e => e.obligation_id).filter((x): x is string => !!x);
  let filings: FilingRow[] = [];
  if (obligationIds.length > 0 && periodLabels.length > 0) {
    filings = await query<FilingRow>(
      `SELECT obligation_id, period_label, status,
              deadline_date::text AS deadline_date, comments, prepared_with,
              partner_in_charge, associates_working,
              last_info_request_sent_at::text AS last_info_request_sent_at,
              last_action_at::text AS last_action_at,
              invoice_price_eur::text AS invoice_price_eur,
              invoice_price_note,
              invoice_price_iss_eur::text AS invoice_price_iss_eur,
              invoice_price_iss_note
         FROM tax_filings
        WHERE obligation_id = ANY($1::text[])
          AND period_label = ANY($2::text[])`,
      [obligationIds, periodLabels],
    );
  }
  const idx = new Map<string, FilingRow>();
  for (const f of filings) idx.set(`${f.obligation_id}|${f.period_label}`, f);

  // Build the workbook.
  const wb = new ExcelJS.Workbook();
  wb.creator = 'cifra';
  wb.created = new Date();

  const sheetName = `${humanTaxType(tax_type)} ${year}`.slice(0, 31);  // Excel limit
  const ws = wb.addWorksheet(sheetName);

  // Header — stint 43.D11 splits "Prepared with" into "Partner in charge"
  // + "Associates working", and stint 43.D6 renames "Last chased" → "Last
  // action". Stint 52 — VAT exports also include the per-ISS price
  // companion columns; non-VAT exports keep a single price pair.
  const isVatExport = tax_type?.startsWith('vat_') ?? false;
  const header: string[] = ['Group', 'Entity'];
  for (const label of periodLabels) header.push(shortPeriodLabel(label));
  header.push('Partner in charge');
  header.push('Associates working');
  header.push('Last action');
  header.push('Comments');
  header.push(isVatExport ? 'Price per return (€)' : 'Price (€)');
  header.push(isVatExport ? 'Note (return)' : 'Price note');
  if (isVatExport) {
    header.push('Price per ISS (€)');
    header.push('Note (ISS)');
  }
  ws.addRow(header);
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).alignment = { vertical: 'middle' };

  // Body
  for (const e of entities) {
    const row: Array<string | number | null> = [e.group_name ?? '', e.legal_name];
    const cells: FilingRow[] = [];
    for (const label of periodLabels) {
      const cell = e.obligation_id ? idx.get(`${e.obligation_id}|${label}`) ?? null : null;
      row.push(cell ? humanStatus(cell.status) : '');
      if (cell) cells.push(cell);
    }
    // Aggregate ownership + comments + latest action + price across the row.
    const partnerSet = new Set<string>();
    const associateSet = new Set<string>();
    let comment: string | null = null;
    const actionDates: string[] = [];
    let invoicePrice: number | null = null;
    let invoicePriceNote: string | null = null;
    let invoiceIssPrice: number | null = null;
    let invoiceIssNote: string | null = null;
    for (const c of cells) {
      // Prefer the new partner_in_charge field; fall back to legacy
      // prepared_with so old rows still show something useful.
      const partners = c.partner_in_charge?.length ? c.partner_in_charge : (c.prepared_with ?? []);
      partners.forEach(v => partnerSet.add(v));
      if (c.associates_working) c.associates_working.forEach(v => associateSet.add(v));
      if (!comment && c.comments) comment = c.comments;
      if (c.last_action_at) actionDates.push(c.last_action_at);
      else if (c.last_info_request_sent_at) actionDates.push(c.last_info_request_sent_at);
      if (invoicePrice === null && c.invoice_price_eur) {
        const n = Number(c.invoice_price_eur);
        if (Number.isFinite(n)) invoicePrice = n;
      }
      if (!invoicePriceNote && c.invoice_price_note) invoicePriceNote = c.invoice_price_note;
      if (invoiceIssPrice === null && c.invoice_price_iss_eur) {
        const n = Number(c.invoice_price_iss_eur);
        if (Number.isFinite(n)) invoiceIssPrice = n;
      }
      if (!invoiceIssNote && c.invoice_price_iss_note) invoiceIssNote = c.invoice_price_iss_note;
    }
    const latestAction = actionDates.length === 0 ? '' : actionDates.sort().slice(-1)[0]!;
    row.push(Array.from(partnerSet).join(', '));
    row.push(Array.from(associateSet).join(', '));
    row.push(latestAction);
    row.push(comment ?? '');
    row.push(invoicePrice ?? '');
    row.push(invoicePriceNote ?? '');
    if (isVatExport) {
      row.push(invoiceIssPrice ?? '');
      row.push(invoiceIssNote ?? '');
    }
    ws.addRow(row);
  }

  // Column widths — entity column wide, period columns narrow.
  ws.getColumn(1).width = 22;
  ws.getColumn(2).width = 36;
  for (let i = 0; i < periodLabels.length; i += 1) {
    ws.getColumn(3 + i).width = 12;
  }
  ws.getColumn(3 + periodLabels.length).width = 20;   // Partner in charge
  ws.getColumn(4 + periodLabels.length).width = 20;   // Associates working
  ws.getColumn(5 + periodLabels.length).width = 14;   // Last action
  ws.getColumn(6 + periodLabels.length).width = 50;   // Comments
  ws.getColumn(7 + periodLabels.length).width = 12;   // Price (€)
  ws.getColumn(8 + periodLabels.length).width = 40;   // Price note

  // Freeze header row + first two cols (Group + Entity) — matches the
  // on-screen sticky-header feel.
  ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 1 }];

  const buffer = await wb.xlsx.writeBuffer() as ArrayBuffer;

  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${tax_type}_${year}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}
