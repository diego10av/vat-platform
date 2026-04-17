// Adaptive VAT appendix generator (PRD §8).
// Produces an .xlsx tailored to the entity profile:
//   - Section A: Services received (always, if any)
//   - Section B: Services rendered / Overall turnover (only if there are outgoing invoices)
//   - Conditional columns: Currency + FX rate (only if any line uses non-EUR),
//                         Reverse charge VAT (only if any RC line exists)
// The front page with branding and the computed eCDF box recap is a separate
// PDF output (PRD §9) — Excel is only the line-level detail.

import ExcelJS, { Worksheet } from 'exceljs';
import { query, queryOne } from '@/lib/db';
import { TREATMENT_CODES } from '@/config/treatment-codes';

type LineRow = {
  sort_order: number;
  provider: string | null;
  country: string | null;
  description: string | null;
  invoice_date: string | null;
  invoice_number: string | null;
  amount_eur: number;
  vat_rate: number | null;
  vat_applied: number | null;
  rc_amount: number | null;
  amount_incl: number | null;
  currency: string | null;
  currency_amount: number | null;
  ecb_rate: number | null;
  treatment: string | null;
  direction: 'incoming' | 'outgoing';
};

export interface ExcelBuildResult {
  buffer: Buffer;
  filename: string;
}

export async function buildAppendix(declarationId: string): Promise<ExcelBuildResult> {
  const decl = await queryOne<{
    year: number; period: string; regime: string; status: string;
    entity_name: string; vat_number: string | null; matricule: string | null;
    address: string | null;
  }>(
    `SELECT d.year, d.period, e.regime, d.status,
            e.name AS entity_name, e.vat_number, e.matricule, e.address
       FROM declarations d JOIN entities e ON d.entity_id = e.id
      WHERE d.id = $1`,
    [declarationId]
  );
  if (!decl) throw new Error('Declaration not found');

  const rows = await query<LineRow & { amount_eur: string; vat_rate: string | null; vat_applied: string | null; rc_amount: string | null; amount_incl: string | null; currency_amount: string | null; ecb_rate: string | null }>(
    `SELECT il.sort_order,
            i.provider, i.country, il.description, i.invoice_date, i.invoice_number,
            il.amount_eur, il.vat_rate, il.vat_applied, il.rc_amount, il.amount_incl,
            i.currency, i.currency_amount, i.ecb_rate,
            il.treatment, i.direction
       FROM invoice_lines il
       JOIN invoices i ON il.invoice_id = i.id
      WHERE il.declaration_id = $1
        AND il.state != 'deleted'
      ORDER BY i.direction DESC, i.provider ASC, il.sort_order ASC`,
    [declarationId]
  );

  const lines: LineRow[] = rows.map(r => ({
    ...r,
    amount_eur: toNum(r.amount_eur),
    vat_rate: toNumOrNull(r.vat_rate),
    vat_applied: toNumOrNull(r.vat_applied),
    rc_amount: toNumOrNull(r.rc_amount),
    amount_incl: toNumOrNull(r.amount_incl),
    currency_amount: toNumOrNull(r.currency_amount),
    ecb_rate: toNumOrNull(r.ecb_rate),
  }));

  const incoming = lines.filter(l => l.direction === 'incoming');
  const outgoing = lines.filter(l => l.direction === 'outgoing');
  const hasFX = lines.some(l => l.currency && l.currency.toUpperCase() !== 'EUR');
  const hasRC = incoming.some(l => (l.rc_amount ?? 0) !== 0);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'cifra';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('VAT Appendix', {
    properties: { defaultColWidth: 15 },
    views: [{ state: 'frozen', ySplit: 7, xSplit: 0 }],
  });

  buildHeader(sheet, decl);
  let row = 8;
  row = buildSection(sheet, row, 'A. Services Received', incoming, { hasFX, hasRC });

  if (outgoing.length > 0) {
    row += 2;
    // Re-assignment kept for symmetry with the extending branches (row
    // is the running cursor even if unused after this call).
    row = buildSection(sheet, row, 'B. Services Rendered — Overall Turnover', outgoing, { hasFX, hasRC: false });
    void row;
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  const filename = `VAT_Appendix_${sanitize(decl.entity_name)}_${decl.year}_${decl.period}.xlsx`;

  return { buffer: Buffer.from(arrayBuffer as ArrayBuffer), filename };
}

// ── Header (entity info, period, regime) ──
function buildHeader(
  sheet: Worksheet,
  decl: { entity_name: string; vat_number: string | null; matricule: string | null; address: string | null; year: number; period: string; regime: string }
) {
  sheet.getCell('A1').value = 'VAT Declaration Appendix';
  sheet.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FF1A1A2E' } };
  sheet.mergeCells('A1:E1');

  sheet.getCell('A3').value = 'Entity';
  sheet.getCell('A3').font = { bold: true, color: { argb: 'FF6B7280' } };
  sheet.getCell('B3').value = decl.entity_name;

  sheet.getCell('A4').value = 'VAT number';
  sheet.getCell('A4').font = { bold: true, color: { argb: 'FF6B7280' } };
  sheet.getCell('B4').value = decl.vat_number || '—';

  sheet.getCell('A5').value = 'Matricule';
  sheet.getCell('A5').font = { bold: true, color: { argb: 'FF6B7280' } };
  sheet.getCell('B5').value = decl.matricule || '—';

  sheet.getCell('D3').value = 'Period';
  sheet.getCell('D3').font = { bold: true, color: { argb: 'FF6B7280' } };
  sheet.getCell('E3').value = `${decl.year} — ${decl.period}`;

  sheet.getCell('D4').value = 'Regime';
  sheet.getCell('D4').font = { bold: true, color: { argb: 'FF6B7280' } };
  sheet.getCell('E4').value = decl.regime;
}

// ── Section with table ──
function buildSection(
  sheet: Worksheet,
  startRow: number,
  title: string,
  lines: LineRow[],
  opts: { hasFX: boolean; hasRC: boolean }
): number {
  // Section title
  const titleRow = sheet.getRow(startRow);
  titleRow.getCell(1).value = title;
  titleRow.getCell(1).font = { bold: true, size: 12, color: { argb: 'FF1A1A2E' } };
  titleRow.height = 20;

  // Columns
  const headers: { label: string; width: number; right?: boolean; key: string }[] = [
    { key: 'provider',    label: 'Provider',       width: 28 },
    { key: 'country',     label: 'Country',        width: 9 },
    { key: 'description', label: 'Description',    width: 38 },
    { key: 'date',        label: 'Invoice date',   width: 12 },
    { key: 'number',      label: 'Invoice #',      width: 14 },
    { key: 'amount_eur',  label: 'Amount ex. VAT', width: 14, right: true },
    { key: 'vat_rate',    label: 'VAT rate',       width: 10, right: true },
    { key: 'vat_applied', label: 'VAT applied',    width: 13, right: true },
  ];
  if (opts.hasRC) {
    headers.push({ key: 'rc_amount', label: 'RC VAT (17%)', width: 13, right: true });
  }
  headers.push({ key: 'amount_incl', label: 'Total incl. VAT', width: 15, right: true });
  if (opts.hasFX) {
    headers.push({ key: 'currency',       label: 'Currency',         width: 10 });
    headers.push({ key: 'currency_amt',   label: 'FX amount',        width: 13, right: true });
    headers.push({ key: 'ecb_rate',       label: 'ECB rate',         width: 10, right: true });
  }
  headers.push({ key: 'treatment', label: 'Treatment', width: 22 });

  const headerRow = sheet.getRow(startRow + 1);
  headers.forEach((h, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.value = h.label;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1A2E' } };
    cell.alignment = { horizontal: h.right ? 'right' : 'left', vertical: 'middle' };
    cell.border = thinBorderAll();
    sheet.getColumn(idx + 1).width = Math.max(sheet.getColumn(idx + 1).width ?? 10, h.width);
  });
  headerRow.height = 22;

  // Rows
  lines.forEach((line, i) => {
    const r = sheet.getRow(startRow + 2 + i);
    const values: Record<string, unknown> = {
      provider: line.provider || '',
      country: (line.country || '').toUpperCase(),
      description: line.description || '',
      date: line.invoice_date ? new Date(line.invoice_date + 'T00:00:00') : null,
      number: line.invoice_number || '',
      amount_eur: line.amount_eur,
      vat_rate: line.vat_rate,
      vat_applied: line.vat_applied ?? null,
      rc_amount: line.rc_amount ?? null,
      amount_incl: line.amount_incl ?? null,
      currency: line.currency || '',
      currency_amt: line.currency_amount ?? null,
      ecb_rate: line.ecb_rate ?? null,
      treatment: formatTreatment(line.treatment),
    };

    headers.forEach((h, idx) => {
      const cell = r.getCell(idx + 1);
      cell.value = (values as Record<string, unknown>)[h.key] as string | number | Date | null;
      cell.alignment = { horizontal: h.right ? 'right' : 'left', vertical: 'middle', wrapText: h.key === 'description' };
      cell.border = thinBorderAll('FFE5E7EB');

      if (h.key === 'amount_eur' || h.key === 'vat_applied' || h.key === 'rc_amount' || h.key === 'amount_incl' || h.key === 'currency_amt') {
        cell.numFmt = '#,##0.00;[Red]-#,##0.00';
      }
      if (h.key === 'vat_rate') {
        cell.numFmt = line.vat_rate == null ? '@' : '0%';
      }
      if (h.key === 'ecb_rate' && line.ecb_rate != null) {
        cell.numFmt = '0.0000';
      }
      if (h.key === 'date' && values.date) {
        cell.numFmt = 'dd/mm/yyyy';
      }
    });

    // zebra
    if (i % 2 === 1) {
      headers.forEach((_, idx) => {
        r.getCell(idx + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
      });
    }
  });

  // Totals row
  const totalRowNum = startRow + 2 + lines.length;
  const totalRow = sheet.getRow(totalRowNum);
  totalRow.getCell(1).value = 'Total';
  totalRow.getCell(1).font = { bold: true };
  headers.forEach((h, idx) => {
    const cell = totalRow.getCell(idx + 1);
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF0F3' } };
    cell.border = { top: { style: 'thin', color: { argb: 'FF1A1A2E' } }, bottom: { style: 'thin', color: { argb: 'FF1A1A2E' } } };
    cell.alignment = { horizontal: h.right ? 'right' : 'left', vertical: 'middle' };
    if (['amount_eur', 'vat_applied', 'rc_amount', 'amount_incl'].includes(h.key)) {
      const field = h.key as keyof LineRow;
      const sum = lines.reduce((s, l) => s + Number((l as unknown as Record<string, unknown>)[field] ?? 0), 0);
      cell.value = sum;
      cell.numFmt = '#,##0.00;[Red]-#,##0.00';
    }
  });

  return totalRowNum;
}

// ── Helpers ──
function thinBorderAll(color = 'FF1A1A2E') {
  const side = { style: 'thin' as const, color: { argb: color } };
  return { top: side, bottom: side, left: side, right: side };
}

function formatTreatment(code: string | null): string {
  if (!code) return '';
  const spec = TREATMENT_CODES[code as keyof typeof TREATMENT_CODES];
  return spec ? `${code} — ${spec.label}` : code;
}

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 60);
}

function toNum(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}
function toNumOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}
