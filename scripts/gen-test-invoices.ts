// ════════════════════════════════════════════════════════════════════════
// scripts/gen-test-invoices.ts — Generate 8 test invoice PDFs covering
// every classifier-relevant treatment code in the cifra VAT module.
//
// Built for stint 67.D end-to-end walk-through. Each PDF mimics what a
// reviewer actually sees coming out of an LU fiduciary's invoice mailbox:
// header with vendor name + address + VAT number, invoice number + date,
// a single description line, net amount + VAT rate + VAT amount + total.
//
// Output: /tmp/cifra-test-invoices/ (idempotent — overwrites on re-run).
//
// Coverage matrix (treatment code → fixture):
//
//   LUX_17           → 01-arendt-medernach-legal-fees.pdf
//   LUX_08           → 02-shell-petrol-station.pdf
//   LUX_03           → 03-luxembourg-times-ebook.pdf
//   EXEMPT_44A_FIN   → 04-bil-banking-fees.pdf
//   RC_EU_TAX        → 05-microsoft-ireland-office365.pdf
//   RC_NONEU_TAX     → 06-adobe-us-creativecloud.pdf
//   OUT_LUX_17       → 07-horizon-management-fee-lu-client.pdf
//   OUT_EU_RC        → 08-horizon-mgmt-fee-fr-subsidiary.pdf
//
// Usage:
//   npx tsx scripts/gen-test-invoices.ts
// ════════════════════════════════════════════════════════════════════════

import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from 'pdf-lib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT_DIR = '/tmp/cifra-test-invoices';
mkdirSync(OUT_DIR, { recursive: true });

interface InvoiceFixture {
  filename: string;
  treatment: string;          // for documentation; not embedded in PDF

  // Header / vendor
  vendorName: string;
  vendorAddress: string[];   // 1-3 lines
  vendorVatNumber: string;
  vendorCountry: string;     // ISO-3166-1 alpha-2

  // Invoice details
  invoiceNumber: string;
  invoiceDate: string;       // ISO YYYY-MM-DD

  // Customer
  customerName: string;
  customerAddress: string[];
  customerVatNumber: string | null;

  // Line
  description: string;

  // Amounts
  netAmount: number;
  vatRate: number;           // 0..1; 0 if no VAT charged
  vatAmount: number;
  totalAmount: number;

  // Whether to include the "VAT reverse-charged" / "Art. 44 exempt"
  // disclaimer that the AI extractor uses to decide direction + treatment.
  footerNote?: string;
}

const FIXTURES: InvoiceFixture[] = [
  // ─────────────────────────── 1. LUX_17 ───────────────────────────
  {
    filename: '01-arendt-medernach-legal-fees.pdf',
    treatment: 'LUX_17',
    vendorName: 'Arendt & Medernach',
    vendorAddress: ['41A, avenue J.F. Kennedy', 'L-2082 Luxembourg'],
    vendorVatNumber: 'LU16871454',
    vendorCountry: 'LU',
    invoiceNumber: 'INV-2026-04231',
    invoiceDate: '2026-01-18',
    customerName: 'Horizon Real Estate SCSp',
    customerAddress: ['2-4, avenue JF Kennedy', 'L-1855 Luxembourg'],
    customerVatNumber: 'LU23456789',
    description: 'Corporate restructuring legal fees — Q4 2025 advice on intra-group reorganisation, drafting share-purchase agreement, board minutes',
    netAmount: 18_500,
    vatRate: 0.17,
    vatAmount: 3_145,
    totalAmount: 21_645,
  },

  // ─────────────────────────── 2. LUX_08 ───────────────────────────
  {
    filename: '02-shell-petrol-station.pdf',
    treatment: 'LUX_08',
    vendorName: 'Shell Luxembourg SA',
    vendorAddress: ['7, rue de l\'Industrie', 'L-8069 Strassen'],
    vendorVatNumber: 'LU15463187',
    vendorCountry: 'LU',
    invoiceNumber: 'TKT-892341',
    invoiceDate: '2026-02-03',
    customerName: 'Horizon Real Estate SCSp',
    customerAddress: ['2-4, avenue JF Kennedy', 'L-1855 Luxembourg'],
    customerVatNumber: 'LU23456789',
    description: 'Diesel fuel — fleet card #4471, January 2026 (subject to LU 8% reduced rate per RGD 21 December 2018 art. 2)',
    netAmount: 487.04,
    vatRate: 0.08,
    vatAmount: 38.96,
    totalAmount: 526.00,
  },

  // ─────────────────────────── 3. LUX_03 ───────────────────────────
  {
    filename: '03-luxembourg-times-ebook.pdf',
    treatment: 'LUX_03',
    vendorName: 'Editpress Luxembourg SA',
    vendorAddress: ['44, rue du Canal', 'L-4050 Esch-sur-Alzette'],
    vendorVatNumber: 'LU14782309',
    vendorCountry: 'LU',
    invoiceNumber: 'SUB-2026-00123',
    invoiceDate: '2026-01-05',
    customerName: 'Horizon Real Estate SCSp',
    customerAddress: ['2-4, avenue JF Kennedy', 'L-1855 Luxembourg'],
    customerVatNumber: 'LU23456789',
    description: 'Annual e-book subscription — Luxembourg Times Premium digital edition (LU super-reduced 3% rate per LTVA Annex B)',
    netAmount: 233.01,
    vatRate: 0.03,
    vatAmount: 6.99,
    totalAmount: 240.00,
  },

  // ─────────────────────────── 4. EXEMPT_44A_FIN ───────────────────
  {
    filename: '04-bil-banking-fees.pdf',
    treatment: 'EXEMPT_44A_FIN',
    vendorName: 'Banque Internationale à Luxembourg',
    vendorAddress: ['69, route d\'Esch', 'L-2953 Luxembourg'],
    vendorVatNumber: 'LU10052003',
    vendorCountry: 'LU',
    invoiceNumber: 'STMT-Q1-2026-7841',
    invoiceDate: '2026-03-31',
    customerName: 'Horizon Real Estate SCSp',
    customerAddress: ['2-4, avenue JF Kennedy', 'L-1855 Luxembourg'],
    customerVatNumber: 'LU23456789',
    description: 'Account maintenance + payment processing — Q1 2026. Account #LU64 0028 1234 5678 9000',
    netAmount: 312.50,
    vatRate: 0,
    vatAmount: 0,
    totalAmount: 312.50,
    footerNote: 'TVA exonérée — Art. 44§1 a) LTVA (services financiers)',
  },

  // ─────────────────────────── 5. RC_EU_TAX ────────────────────────
  {
    filename: '05-microsoft-ireland-office365.pdf',
    treatment: 'RC_EU_TAX',
    vendorName: 'Microsoft Ireland Operations Ltd',
    vendorAddress: ['One Microsoft Place', 'South County Business Park', 'Leopardstown, Dublin 18, Ireland'],
    vendorVatNumber: 'IE8256796U',
    vendorCountry: 'IE',
    invoiceNumber: 'E0028394719',
    invoiceDate: '2026-02-28',
    customerName: 'Horizon Real Estate SCSp',
    customerAddress: ['2-4, avenue JF Kennedy', 'L-1855 Luxembourg'],
    customerVatNumber: 'LU23456789',
    description: 'Office 365 Business Premium — 25 seats × monthly subscription (Feb 2026)',
    netAmount: 562.50,
    vatRate: 0,
    vatAmount: 0,
    totalAmount: 562.50,
    footerNote: 'VAT to be self-assessed by customer — Reverse charge under Article 196 EU VAT Directive (B2B service supplied to EU VAT-registered customer)',
  },

  // ─────────────────────────── 6. RC_NONEU_TAX ─────────────────────
  {
    filename: '06-adobe-us-creativecloud.pdf',
    treatment: 'RC_NONEU_TAX',
    vendorName: 'Adobe Inc.',
    vendorAddress: ['345 Park Avenue', 'San Jose, CA 95110-2704', 'United States of America'],
    vendorVatNumber: '',  // Non-EU vendors typically don't have an EU VAT number
    vendorCountry: 'US',
    invoiceNumber: 'INV-AD-08827341',
    invoiceDate: '2026-03-12',
    customerName: 'Horizon Real Estate SCSp',
    customerAddress: ['2-4, avenue JF Kennedy', 'L-1855 Luxembourg'],
    customerVatNumber: 'LU23456789',
    description: 'Creative Cloud All Apps for Teams — annual subscription, 3 licences (March 2026 to February 2027)',
    netAmount: 2_148.30,
    vatRate: 0,
    vatAmount: 0,
    totalAmount: 2_148.30,
    footerNote: 'Customer to self-assess VAT under reverse charge (B2B service from non-EU supplier; LU rate 17% applies — Art. 17§1 LTVA)',
  },

  // ─────────────────────────── 7. OUT_LUX_17 ───────────────────────
  {
    filename: '07-horizon-management-fee-lu-client.pdf',
    treatment: 'OUT_LUX_17',
    // OUTGOING — vendor IS our entity (Horizon SCSp); customer is Trilantic.
    vendorName: 'Horizon Real Estate SCSp',
    vendorAddress: ['2-4, avenue JF Kennedy', 'L-1855 Luxembourg'],
    vendorVatNumber: 'LU23456789',
    vendorCountry: 'LU',
    invoiceNumber: 'HZ-2026-Q1-LU01',
    invoiceDate: '2026-03-31',
    customerName: 'Trilantic Lux Holdings SARL',
    customerAddress: ['12, rue Eugène Ruppert', 'L-2453 Luxembourg'],
    customerVatNumber: 'LU24681357',
    description: 'Real-estate asset management services for the period 1 January 2026 – 31 March 2026 (taxable LU service per Art. 17§1 LTVA)',
    netAmount: 45_000,
    vatRate: 0.17,
    vatAmount: 7_650,
    totalAmount: 52_650,
  },

  // ─────────────────────────── 8. OUT_EU_RC ────────────────────────
  {
    filename: '08-horizon-mgmt-fee-fr-subsidiary.pdf',
    treatment: 'OUT_EU_RC',
    vendorName: 'Horizon Real Estate SCSp',
    vendorAddress: ['2-4, avenue JF Kennedy', 'L-1855 Luxembourg'],
    vendorVatNumber: 'LU23456789',
    vendorCountry: 'LU',
    invoiceNumber: 'HZ-2026-Q1-FR01',
    invoiceDate: '2026-03-31',
    customerName: 'Horizon France SARL',
    customerAddress: ['125, avenue des Champs-Élysées', '75008 Paris, France'],
    customerVatNumber: 'FR47876543210',
    description: 'Real-estate asset management services for the period 1 January 2026 – 31 March 2026 — supplied to EU VAT-registered customer (B2B)',
    netAmount: 38_500,
    vatRate: 0,
    vatAmount: 0,
    totalAmount: 38_500,
    footerNote: 'VAT to be self-assessed by the customer under reverse charge — Article 196 EU VAT Directive (place of supply: France)',
  },
];

// ─────────────────────────────────────────────────────────────────────
// PDF rendering
// ─────────────────────────────────────────────────────────────────────

const PAGE_WIDTH = 595;   // A4 portrait
const PAGE_HEIGHT = 842;
const MARGIN = 50;

function fmtEur(n: number): string {
  return new Intl.NumberFormat('en-LU', { style: 'currency', currency: 'EUR' }).format(n);
}

function fmtRate(r: number): string {
  if (r === 0) return '—';
  return `${(r * 100).toFixed(0)}%`;
}

// pdf-lib's StandardFonts use WinAnsi which can't encode glyphs outside
// Latin-1 (e.g. → arrows, “ ” curly quotes, en/em dashes look fine but
// arrows fail hard). Normalize to safe ASCII-ish equivalents before
// drawing so a stray paste from a real invoice doesn't blow up the run.
function safe(s: string): string {
  return s
    .replace(/[→➔➜➞]/g, '->')   // arrows
    .replace(/[—―]/g, '--')                // em dashes / quotation dash
    .replace(/[–]/g, '-')                       // en dash
    .replace(/[“”„‟]/g, '"')     // curly double quotes
    .replace(/[‘’‚‛]/g, "'")     // curly single quotes
    .replace(/[…]/g, '...')                     // ellipsis
    .replace(/[ ]/g, ' ');                      // NBSP -> regular space
}

function drawText(
  page: PDFPage,
  text: string,
  x: number, y: number,
  font: PDFFont, size: number,
  color = rgb(0.1, 0.1, 0.15),
) {
  page.drawText(safe(text), { x, y, size, font, color });
}

function drawLine(page: PDFPage, y: number, color = rgb(0.7, 0.7, 0.75)) {
  page.drawLine({
    start: { x: MARGIN, y },
    end:   { x: PAGE_WIDTH - MARGIN, y },
    thickness: 0.7,
    color,
  });
}

async function renderInvoice(fx: InvoiceFixture): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let y = PAGE_HEIGHT - MARGIN;

  // ─── Header ───
  drawText(page, fx.vendorName, MARGIN, y, helvBold, 18);
  y -= 24;
  for (const ln of fx.vendorAddress) {
    drawText(page, ln, MARGIN, y, helv, 10, rgb(0.35, 0.35, 0.4));
    y -= 13;
  }
  drawText(page, `VAT: ${fx.vendorVatNumber || '— (non-EU supplier)'}`, MARGIN, y, helv, 10, rgb(0.35, 0.35, 0.4));
  y -= 13;

  // INVOICE label (right-aligned)
  drawText(page, 'INVOICE', PAGE_WIDTH - MARGIN - 90, PAGE_HEIGHT - MARGIN, helvBold, 22, rgb(0.16, 0.20, 0.40));
  drawText(page, `# ${fx.invoiceNumber}`, PAGE_WIDTH - MARGIN - 130, PAGE_HEIGHT - MARGIN - 28, helv, 10);
  drawText(page, `Date: ${fx.invoiceDate}`, PAGE_WIDTH - MARGIN - 130, PAGE_HEIGHT - MARGIN - 42, helv, 10);

  y -= 24;
  drawLine(page, y);
  y -= 24;

  // ─── Bill To ───
  drawText(page, 'Bill to', MARGIN, y, helvBold, 9, rgb(0.4, 0.4, 0.45));
  y -= 14;
  drawText(page, fx.customerName, MARGIN, y, helvBold, 11);
  y -= 14;
  for (const ln of fx.customerAddress) {
    drawText(page, ln, MARGIN, y, helv, 10, rgb(0.35, 0.35, 0.4));
    y -= 13;
  }
  if (fx.customerVatNumber) {
    drawText(page, `VAT: ${fx.customerVatNumber}`, MARGIN, y, helv, 10, rgb(0.35, 0.35, 0.4));
    y -= 13;
  }
  y -= 18;
  drawLine(page, y);
  y -= 24;

  // ─── Line ───
  drawText(page, 'Description', MARGIN, y, helvBold, 9, rgb(0.4, 0.4, 0.45));
  drawText(page, 'Net (EUR)', PAGE_WIDTH - MARGIN - 80, y, helvBold, 9, rgb(0.4, 0.4, 0.45));
  y -= 16;

  // Wrap description (~75 chars per line)
  const desc = fx.description;
  const wrapAt = 70;
  const descLines: string[] = [];
  let buf = '';
  for (const word of desc.split(/\s+/)) {
    if ((buf + ' ' + word).trim().length > wrapAt) {
      descLines.push(buf.trim());
      buf = word;
    } else {
      buf = (buf + ' ' + word).trim();
    }
  }
  if (buf) descLines.push(buf);

  for (let i = 0; i < descLines.length; i++) {
    drawText(page, descLines[i], MARGIN, y, helv, 10);
    if (i === 0) {
      drawText(page, fmtEur(fx.netAmount), PAGE_WIDTH - MARGIN - 80, y, helv, 10);
    }
    y -= 14;
  }

  y -= 18;
  drawLine(page, y);
  y -= 24;

  // ─── Totals ───
  const labelX = PAGE_WIDTH - MARGIN - 220;
  const valueX = PAGE_WIDTH - MARGIN - 80;

  drawText(page, 'Subtotal (net)', labelX, y, helv, 10, rgb(0.4, 0.4, 0.45));
  drawText(page, fmtEur(fx.netAmount), valueX, y, helv, 10);
  y -= 16;

  drawText(page, `VAT (${fmtRate(fx.vatRate)})`, labelX, y, helv, 10, rgb(0.4, 0.4, 0.45));
  drawText(page, fx.vatAmount === 0 ? '—' : fmtEur(fx.vatAmount), valueX, y, helv, 10);
  y -= 18;

  drawLine(page, y);
  y -= 18;

  drawText(page, 'TOTAL', labelX, y, helvBold, 11);
  drawText(page, fmtEur(fx.totalAmount), valueX, y, helvBold, 11);
  y -= 30;

  // ─── Footer note (legal basis for exemption / RC) ───
  if (fx.footerNote) {
    drawLine(page, y);
    y -= 18;
    const noteWrap = 90;
    let noteBuf = '';
    const noteLines: string[] = [];
    for (const word of fx.footerNote.split(/\s+/)) {
      if ((noteBuf + ' ' + word).trim().length > noteWrap) {
        noteLines.push(noteBuf.trim());
        noteBuf = word;
      } else {
        noteBuf = (noteBuf + ' ' + word).trim();
      }
    }
    if (noteBuf) noteLines.push(noteBuf);
    for (const ln of noteLines) {
      drawText(page, ln, MARGIN, y, helv, 9, rgb(0.45, 0.4, 0.2));
      y -= 12;
    }
  }

  // ─── Sticky payment instructions footer ───
  const footerY = MARGIN + 20;
  drawText(
    page,
    `Payment within 30 days · Bank: ${fx.vendorCountry === 'LU' ? 'BIL Luxembourg' : 'TransferWise'} · ` +
      `Reference: ${fx.invoiceNumber}`,
    MARGIN, footerY,
    helv, 8, rgb(0.55, 0.55, 0.6),
  );

  return await pdf.save();
}

// ─────────────────────────────────────────────────────────────────────
// Run
// ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`📄  Generating ${FIXTURES.length} test invoices to ${OUT_DIR}/`);
  for (const fx of FIXTURES) {
    const bytes = await renderInvoice(fx);
    const path = join(OUT_DIR, fx.filename);
    writeFileSync(path, bytes);
    console.log(`   ✓ ${fx.filename}  (${fx.treatment.padEnd(20)})  ${fmtEur(fx.totalAmount)}`);
  }
  console.log('\n✅  Done. Open them to inspect:');
  console.log(`   open ${OUT_DIR}`);
}

main().catch((err) => {
  console.error('\n❌  Generator failed:', err);
  process.exit(1);
});
