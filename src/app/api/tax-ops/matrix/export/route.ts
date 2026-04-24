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
  /** Stint 39.F — last chase date; surfaced in export too. */
  last_info_request_sent_at: string | null;
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
       WHERE e.is_active = TRUE
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
         AND e.is_active = TRUE
       ORDER BY g.name ASC NULLS LAST, e.legal_name ASC
      `;
  const entities = await query<Row>(entityQuery, [tax_type, period_pattern, service_kind]);

  const obligationIds = entities.map(e => e.obligation_id).filter((x): x is string => !!x);
  let filings: FilingRow[] = [];
  if (obligationIds.length > 0 && periodLabels.length > 0) {
    filings = await query<FilingRow>(
      `SELECT obligation_id, period_label, status,
              deadline_date::text AS deadline_date, comments, prepared_with,
              last_info_request_sent_at::text AS last_info_request_sent_at
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

  // Header
  const header: string[] = ['Group', 'Entity'];
  for (const label of periodLabels) header.push(shortPeriodLabel(label));
  header.push('Prepared with');
  header.push('Last chased');
  header.push('Comments');
  ws.addRow(header);
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).alignment = { vertical: 'middle' };

  // Body
  for (const e of entities) {
    const row: Array<string | null> = [e.group_name ?? '', e.legal_name];
    const cells: FilingRow[] = [];
    for (const label of periodLabels) {
      const cell = e.obligation_id ? idx.get(`${e.obligation_id}|${label}`) ?? null : null;
      row.push(cell ? humanStatus(cell.status) : '');
      if (cell) cells.push(cell);
    }
    // Aggregate prepared_with + comments + latest-chase across the row.
    const preparedSet = new Set<string>();
    let comment: string | null = null;
    const chaseDates: string[] = [];
    for (const c of cells) {
      if (c.prepared_with) c.prepared_with.forEach(v => preparedSet.add(v));
      if (!comment && c.comments) comment = c.comments;
      if (c.last_info_request_sent_at) chaseDates.push(c.last_info_request_sent_at);
    }
    const latestChase = chaseDates.length === 0 ? '' : chaseDates.sort().slice(-1)[0]!;
    row.push(Array.from(preparedSet).join(', '));
    row.push(latestChase);
    row.push(comment ?? '');
    ws.addRow(row);
  }

  // Column widths — entity column wide, period columns narrow.
  ws.getColumn(1).width = 22;
  ws.getColumn(2).width = 36;
  for (let i = 0; i < periodLabels.length; i += 1) {
    ws.getColumn(3 + i).width = 12;
  }
  ws.getColumn(3 + periodLabels.length).width = 20;
  ws.getColumn(4 + periodLabels.length).width = 14;  // Last chased
  ws.getColumn(5 + periodLabels.length).width = 50;

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
