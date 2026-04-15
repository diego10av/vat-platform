// EC Sales List (état récapitulatif) generator — PRD P1.
//
// Required for entities that supply B2B services or goods to VAT-registered
// customers in other EU member states, in addition to the regular VAT return.
// Lists every counterparty (VAT number, country, total amount) for the period.
//
// We extract counterparties from outgoing invoices treated as OUT_EU_RC. The
// platform exposes both an Excel and an XML representation; the XML mirrors
// the structure of the AED's eCDF EC Sales List form (TVA006N family).

import ExcelJS from 'exceljs';
import { query, queryOne } from '@/lib/db';

export type ECSLLine = {
  customer_name: string;
  vat_number: string;
  country: string;
  amount_eur: number;
  indicator: 'S' | 'T'; // S = service, T = triangulation. We default to 'S'.
  invoice_count: number;
};

export interface ECSLReport {
  entity_name: string;
  vat_number: string | null;
  matricule: string | null;
  year: number;
  period: string;
  lines: ECSLLine[];
  total: number;
  has_data: boolean;
}

export async function buildECSLReport(declarationId: string): Promise<ECSLReport> {
  const decl = await queryOne<{
    year: number; period: string;
    entity_name: string; vat_number: string | null; matricule: string | null;
  }>(
    `SELECT d.year, d.period,
            e.name AS entity_name, e.vat_number, e.matricule
       FROM declarations d JOIN entities e ON d.entity_id = e.id
      WHERE d.id = $1`,
    [declarationId]
  );
  if (!decl) throw new Error('Declaration not found');

  // Aggregate outgoing OUT_EU_RC lines by (counterparty VAT number, country)
  const rows = await query<{
    customer_name: string; vat_number: string; country: string;
    amount_eur: number; invoice_count: number;
  }>(
    `SELECT
        i.provider AS customer_name,
        COALESCE(NULLIF(i.provider_vat, ''), '—') AS vat_number,
        UPPER(COALESCE(i.country, '')) AS country,
        SUM(il.amount_eur)::float AS amount_eur,
        COUNT(DISTINCT i.id)::int AS invoice_count
       FROM invoice_lines il
       JOIN invoices i ON il.invoice_id = i.id
      WHERE il.declaration_id = $1
        AND il.state != 'deleted'
        AND i.direction = 'outgoing'
        AND il.treatment = 'OUT_EU_RC'
        AND i.provider IS NOT NULL
      GROUP BY i.provider, i.provider_vat, i.country
      ORDER BY country, customer_name`,
    [declarationId]
  );

  const lines: ECSLLine[] = rows.map(r => ({
    customer_name: r.customer_name,
    vat_number: r.vat_number,
    country: r.country,
    amount_eur: Number(r.amount_eur),
    indicator: 'S',
    invoice_count: Number(r.invoice_count),
  }));

  const total = lines.reduce((s, l) => s + l.amount_eur, 0);

  return {
    entity_name: decl.entity_name,
    vat_number: decl.vat_number,
    matricule: decl.matricule,
    year: decl.year,
    period: decl.period,
    lines,
    total,
    has_data: lines.length > 0,
  };
}

export async function buildECSLXlsx(report: ECSLReport): Promise<{ buffer: Buffer; filename: string }> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Luxembourg VAT Platform';
  wb.created = new Date();
  const sheet = wb.addWorksheet('EC Sales List');

  // Header
  sheet.getCell('A1').value = 'EC Sales List — État récapitulatif';
  sheet.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FF1A1A2E' } };
  sheet.mergeCells('A1:F1');

  sheet.getCell('A3').value = 'Entity';
  sheet.getCell('A3').font = { bold: true, color: { argb: 'FF6B7280' } };
  sheet.getCell('B3').value = report.entity_name;

  sheet.getCell('A4').value = 'VAT number';
  sheet.getCell('A4').font = { bold: true, color: { argb: 'FF6B7280' } };
  sheet.getCell('B4').value = report.vat_number || '—';

  sheet.getCell('D3').value = 'Period';
  sheet.getCell('D3').font = { bold: true, color: { argb: 'FF6B7280' } };
  sheet.getCell('E3').value = `${report.year} — ${report.period}`;

  // Table
  const headers = [
    { key: 'country', label: 'Country', width: 10 },
    { key: 'vat_number', label: 'Customer VAT number', width: 22 },
    { key: 'customer_name', label: 'Customer name', width: 38 },
    { key: 'indicator', label: 'Indicator', width: 12 },
    { key: 'invoice_count', label: 'Invoices', width: 10, right: true },
    { key: 'amount_eur', label: 'Amount (EUR)', width: 18, right: true },
  ];

  const headerRow = sheet.getRow(7);
  headers.forEach((h, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.value = h.label;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1A2E' } };
    cell.alignment = { horizontal: h.right ? 'right' : 'left', vertical: 'middle' };
    sheet.getColumn(idx + 1).width = h.width;
  });
  headerRow.height = 22;

  report.lines.forEach((line, i) => {
    const r = sheet.getRow(8 + i);
    headers.forEach((h, idx) => {
      const cell = r.getCell(idx + 1);
      cell.value = (line as unknown as Record<string, unknown>)[h.key] as string | number;
      cell.alignment = { horizontal: h.right ? 'right' : 'left', vertical: 'middle' };
      if (h.key === 'amount_eur') cell.numFmt = '#,##0.00';
    });
    if (i % 2 === 1) {
      headers.forEach((_, idx) => {
        r.getCell(idx + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
      });
    }
  });

  // Total
  const totalRow = sheet.getRow(8 + report.lines.length);
  totalRow.getCell(1).value = 'Total';
  totalRow.getCell(1).font = { bold: true };
  const totalCell = totalRow.getCell(headers.length);
  totalCell.value = report.total;
  totalCell.font = { bold: true };
  totalCell.numFmt = '#,##0.00';
  totalCell.alignment = { horizontal: 'right' };
  totalRow.getCell(1).fill = totalCell.fill = {
    type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF0F3' },
  };

  const safe = report.entity_name.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 60);
  const buf = await wb.xlsx.writeBuffer();
  return {
    buffer: Buffer.from(buf as ArrayBuffer),
    filename: `ECSL_${safe}_${report.year}_${report.period}.xlsx`,
  };
}

export function buildECSLXml(report: ECSLReport): { xml: string; filename: string } {
  const lines: string[] = [];
  const push = (s: string) => lines.push(s);

  push(`<?xml version="1.0" encoding="UTF-8"?>`);
  push(`<eCDFDeclarations xmlns="http://www.ctie.etat.lu/2011/ecdf">`);
  push(`  <eCDFDeclaration>`);
  push(`    <Sender>`);
  push(`      <SenderType>tax_professional</SenderType>`);
  push(`      <Matricule>${esc(report.matricule || '')}</Matricule>`);
  push(`    </Sender>`);
  push(`    <DeclarationData>`);
  push(`      <Form>`);
  push(`        <FormType>TVA006N</FormType>`);
  push(`        <FormVersion>1.0</FormVersion>`);
  push(`        <Period>${esc(report.period)}</Period>`);
  push(`        <Year>${report.year}</Year>`);
  push(`        <Declarant>`);
  push(`          <Matricule>${esc(report.matricule || '')}</Matricule>`);
  push(`          <VATNumber>${esc(report.vat_number || '')}</VATNumber>`);
  push(`          <Name>${esc(report.entity_name)}</Name>`);
  push(`        </Declarant>`);
  push(`        <ECSalesListLines>`);
  for (const l of report.lines) {
    push(`          <Line>`);
    push(`            <CountryCode>${esc(l.country)}</CountryCode>`);
    push(`            <CustomerVATNumber>${esc(l.vat_number)}</CustomerVATNumber>`);
    push(`            <CustomerName>${esc(l.customer_name)}</CustomerName>`);
    push(`            <Amount>${l.amount_eur.toFixed(2)}</Amount>`);
    push(`            <Indicator>${esc(l.indicator)}</Indicator>`);
    push(`          </Line>`);
  }
  push(`        </ECSalesListLines>`);
  push(`        <Totals>`);
  push(`          <TotalAmount>${report.total.toFixed(2)}</TotalAmount>`);
  push(`          <LineCount>${report.lines.length}</LineCount>`);
  push(`        </Totals>`);
  push(`      </Form>`);
  push(`    </DeclarationData>`);
  push(`  </eCDFDeclaration>`);
  push(`</eCDFDeclarations>`);

  const safe = report.entity_name.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 60);
  return {
    xml: lines.join('\n'),
    filename: `ECSL_TVA006N_${safe}_${report.year}_${report.period}.xml`,
  };
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
