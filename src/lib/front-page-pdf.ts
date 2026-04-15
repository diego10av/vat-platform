// Front page / cover PDF generator (PRD §9).
//
// Polished cover document delivered alongside the Excel appendix:
//   - Cover with entity name, period, regime, fiscal numbers, address
//   - Table of contents
//   - Annex 1: VAT calculation summary (eCDF box recap)
//   - Annex 2: Payment instructions (for ordinary users uses 097/102 totals)
//
// Uses PDFKit (pure JS, no Chrome dependency) so it deploys cleanly on Vercel.

import PDFDocument from 'pdfkit';
import { computeECDF } from '@/lib/ecdf';
import { generatePaymentReference, AED_BANK_DETAILS } from '@/lib/payment-ref';
import { queryOne } from '@/lib/db';

const NAVY = '#1A1A2E';
const GREY = '#6B7280';
const LIGHT_GREY = '#F3F4F6';

export interface PDFBuildResult {
  buffer: Buffer;
  filename: string;
}

export async function buildFrontPagePDF(declarationId: string): Promise<PDFBuildResult> {
  const decl = await queryOne<{
    year: number; period: string; status: string;
    entity_name: string; vat_number: string | null; matricule: string | null;
    rcs_number: string | null; address: string | null; client_name: string | null;
    regime: string; frequency: string;
  }>(
    `SELECT d.year, d.period, d.status,
            e.name AS entity_name, e.vat_number, e.matricule, e.rcs_number,
            e.address, e.client_name, e.regime, e.frequency
       FROM declarations d JOIN entities e ON d.entity_id = e.id
      WHERE d.id = $1`,
    [declarationId]
  );
  if (!decl) throw new Error('Declaration not found');

  const ecdf = await computeECDF(declarationId);
  let payment = null;
  try {
    payment = generatePaymentReference({
      matricule: decl.matricule, year: decl.year, period: decl.period,
      amount: ecdf.totals.payable,
    });
  } catch { /* matricule missing */ }

  const buffer = await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 60, bottom: 60, left: 60, right: 60 },
      info: {
        Title: `VAT Declaration — ${decl.entity_name} — ${decl.year} ${decl.period}`,
        Author: 'Luxembourg VAT Platform',
        Subject: 'VAT Declaration Cover Document',
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ────── Cover page ──────
    drawCover(doc, decl, ecdf);

    // ────── Annex 1: VAT calculation summary ──────
    doc.addPage();
    drawAnnex1(doc, decl, ecdf);

    // ────── Annex 2: Payment instructions ──────
    if (payment && ecdf.totals.payable > 0) {
      doc.addPage();
      drawAnnex2(doc, decl, ecdf, payment);
    }

    doc.end();
  });

  const safeEntity = decl.entity_name.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 60);
  return { buffer, filename: `VAT_FrontPage_${safeEntity}_${decl.year}_${decl.period}.pdf` };
}

// ────── Cover ──────
function drawCover(
  doc: PDFKit.PDFDocument,
  decl: { entity_name: string; vat_number: string | null; matricule: string | null;
    rcs_number: string | null; address: string | null; client_name: string | null;
    regime: string; year: number; period: string; },
  ecdf: { totals: { vat_due: number; payable: number; credit: number } }
) {
  // Top accent bar
  doc.rect(0, 0, 595, 8).fill(NAVY);

  doc.fillColor(GREY).fontSize(9).font('Helvetica');
  doc.text('LUXEMBOURG VAT DECLARATION', 60, 80, { characterSpacing: 2 });

  doc.moveDown(2);
  doc.fillColor(NAVY).fontSize(28).font('Helvetica-Bold');
  doc.text(decl.entity_name, { width: 475 });

  doc.moveDown(0.5);
  doc.fillColor(GREY).fontSize(13).font('Helvetica');
  doc.text(`${decl.year} — ${humanPeriod(decl.period)}`, { continued: true });
  doc.fillColor(NAVY).text(`   ·   `, { continued: true });
  doc.fillColor(GREY).text(capitalize(decl.regime) + ' regime');

  doc.moveDown(2);

  // Identifier card
  const cardTop = doc.y;
  doc.rect(60, cardTop, 475, 120).fill(LIGHT_GREY);
  doc.fillColor(GREY).fontSize(8).font('Helvetica-Bold');

  const left = 80, right = 320, lineH = 18, labelTop = cardTop + 18;
  drawField(doc, 'VAT NUMBER',  decl.vat_number || '—', left, labelTop);
  drawField(doc, 'MATRICULE',   decl.matricule  || '—', left, labelTop + 36);
  drawField(doc, 'RCS',         decl.rcs_number || '—', left, labelTop + 72);
  drawField(doc, 'CLIENT',      decl.client_name || '—', right, labelTop);
  drawField(doc, 'ADDRESS',     decl.address    || '—', right, labelTop + 36, 195);
  void lineH;

  doc.moveDown(8);

  // Headline VAT position
  const due = ecdf.totals.vat_due;
  const payable = ecdf.totals.payable;
  const credit = ecdf.totals.credit;
  doc.fillColor(GREY).fontSize(8).font('Helvetica-Bold').text('VAT POSITION', 60, 350, { characterSpacing: 1.5 });

  doc.moveDown(0.5);
  doc.fillColor(NAVY).fontSize(36).font('Helvetica-Bold');
  if (payable > 0) {
    doc.text(`€${fmtEUR(payable)}`, 60);
    doc.fillColor(GREY).fontSize(11).font('Helvetica').text('payable to AED', 60, doc.y, { continued: false });
  } else if (credit > 0) {
    doc.fillColor('#059669').text(`€${fmtEUR(credit)}`, 60);
    doc.fillColor(GREY).fontSize(11).font('Helvetica').text('credit position', 60, doc.y);
  } else {
    doc.text(`€0.00`, 60);
    doc.fillColor(GREY).fontSize(11).font('Helvetica').text('nil position', 60, doc.y);
  }
  void due;

  // Footer
  doc.fillColor(GREY).fontSize(8).font('Helvetica');
  doc.text('Annexes', 60, 720);
  doc.fillColor(NAVY).font('Helvetica-Bold').text('Annex 1', 60, 735, { continued: true });
  doc.font('Helvetica').fillColor(GREY).text('   VAT calculation summary');
  if (ecdf.totals.payable > 0) {
    doc.fillColor(NAVY).font('Helvetica-Bold').text('Annex 2', 60, 750, { continued: true });
    doc.font('Helvetica').fillColor(GREY).text('   Payment instructions');
  }

  doc.fontSize(7).fillColor(GREY).text('Generated by the Luxembourg VAT Platform', 60, 800);
}

function drawField(doc: PDFKit.PDFDocument, label: string, value: string, x: number, y: number, width = 200) {
  doc.fillColor(GREY).fontSize(8).font('Helvetica-Bold').text(label, x, y, { characterSpacing: 1 });
  doc.fillColor(NAVY).fontSize(11).font('Helvetica').text(value, x, y + 12, { width, height: 30, ellipsis: true });
}

// ────── Annex 1: box recap ──────
function drawAnnex1(
  doc: PDFKit.PDFDocument,
  decl: { entity_name: string; year: number; period: string; regime: string },
  ecdf: { regime: string; boxes: Array<{ box: string; label: string; section: string; value: number; manual?: boolean }>;
    totals: { vat_due: number; payable: number; credit: number }; manual_boxes_pending: string[] }
) {
  pageHeader(doc, 'Annex 1 — VAT calculation summary', `${decl.entity_name} · ${decl.year} ${decl.period}`);

  const sections: Record<string, string> = {
    A: 'Section A — Overall turnover',
    B: 'Section B — Intra-Community acquisitions',
    D: 'Section D — Reverse charge',
    F: 'Section F — Total VAT due',
    I: 'Section I — Turnover and output VAT',
    III: 'Section III — Input VAT deduction',
    IV: 'Section IV — Net position',
  };

  let y = 130;
  const left = 60, boxColW = 50, valColW = 100, labelColW = 385;

  for (const sec of Object.keys(sections)) {
    const rows = ecdf.boxes.filter(b => b.section === sec);
    if (rows.length === 0) continue;

    if (y > 720) { doc.addPage(); pageHeader(doc, 'Annex 1 — VAT calculation summary', `${decl.entity_name} · ${decl.year} ${decl.period}`); y = 130; }

    doc.fillColor(NAVY).fontSize(11).font('Helvetica-Bold').text(sections[sec], left, y);
    y += 20;
    doc.fillColor(GREY).fontSize(7.5).font('Helvetica-Bold');
    doc.text('BOX', left, y);
    doc.text('DESCRIPTION', left + boxColW, y);
    doc.text('AMOUNT (EUR)', left + boxColW + labelColW, y, { width: valColW, align: 'right' });
    y += 12;
    doc.moveTo(left, y).lineTo(left + boxColW + labelColW + valColW, y).strokeColor(NAVY).lineWidth(0.5).stroke();
    y += 4;

    for (const b of rows) {
      if (y > 770) { doc.addPage(); pageHeader(doc, 'Annex 1 — VAT calculation summary', `${decl.entity_name} · ${decl.year} ${decl.period}`); y = 130; }
      doc.fillColor(NAVY).fontSize(9).font('Helvetica-Bold').text(b.box, left, y);
      doc.fillColor('#374151').fontSize(9).font('Helvetica').text(b.label + (b.manual ? '  [manual]' : ''), left + boxColW, y, { width: labelColW - 6 });
      doc.fillColor('#111827').fontSize(9).font('Helvetica').text(fmtEUR(b.value), left + boxColW + labelColW, y, { width: valColW, align: 'right' });
      y += 16;
    }
    y += 12;
  }

  // Net result block
  if (y > 700) { doc.addPage(); }
  doc.rect(60, y, 475, 60).fill(NAVY);
  doc.fillColor('#FFFFFF').fontSize(9).font('Helvetica-Bold').text('TOTAL VAT DUE', 80, y + 14, { characterSpacing: 1.5 });
  doc.fontSize(22).text(`€${fmtEUR(ecdf.totals.vat_due)}`, 80, y + 28);

  if (ecdf.totals.payable > 0) {
    doc.fillColor('#9CA3AF').fontSize(8).font('Helvetica').text('Payable', 380, y + 14);
    doc.fillColor('#FFFFFF').fontSize(16).font('Helvetica-Bold').text(`€${fmtEUR(ecdf.totals.payable)}`, 380, y + 28);
  } else if (ecdf.totals.credit > 0) {
    doc.fillColor('#9CA3AF').fontSize(8).font('Helvetica').text('Credit', 380, y + 14);
    doc.fillColor('#34D399').fontSize(16).font('Helvetica-Bold').text(`€${fmtEUR(ecdf.totals.credit)}`, 380, y + 28);
  }
}

// ────── Annex 2: payment instructions ──────
function drawAnnex2(
  doc: PDFKit.PDFDocument,
  decl: { entity_name: string; year: number; period: string },
  ecdf: { totals: { payable: number } },
  payment: { reference: string; iban: string; bic: string; beneficiary: string }
) {
  pageHeader(doc, 'Annex 2 — Payment instructions', `${decl.entity_name} · ${decl.year} ${decl.period}`);

  doc.moveDown(1);
  doc.fillColor('#374151').fontSize(10).font('Helvetica');
  doc.text(
    'Please make the payment to the AED using the following details. Use the structured ' +
    'payment reference exactly as shown — it identifies the declaration period for the AED.',
    60, 130, { width: 475 }
  );

  // Amount card
  let y = 200;
  doc.rect(60, y, 475, 80).fill(LIGHT_GREY);
  doc.fillColor(GREY).fontSize(8).font('Helvetica-Bold').text('AMOUNT TO PAY', 80, y + 18, { characterSpacing: 1.5 });
  doc.fillColor(NAVY).fontSize(28).font('Helvetica-Bold').text(`€${fmtEUR(ecdf.totals.payable)}`, 80, y + 32);

  y += 110;

  // Details
  const drawRow = (label: string, value: string, monospace = false) => {
    doc.fillColor(GREY).fontSize(8).font('Helvetica-Bold').text(label, 60, y, { characterSpacing: 1.5 });
    doc.fillColor(NAVY).fontSize(13).font(monospace ? 'Courier' : 'Helvetica').text(value, 60, y + 12);
    y += 42;
  };
  drawRow('PAYMENT REFERENCE', payment.reference, true);
  drawRow('BENEFICIARY', payment.beneficiary);
  drawRow('IBAN', payment.iban, true);
  drawRow('BIC / SWIFT', payment.bic, true);

  // Footer note
  doc.fillColor(GREY).fontSize(8).font('Helvetica-Oblique').text(
    'Once the bank confirms the transfer, please share the proof of payment so we can ' +
    'mark the declaration as paid in our records.',
    60, 720, { width: 475 }
  );
}

// ────── helpers ──────
function pageHeader(doc: PDFKit.PDFDocument, title: string, subtitle: string) {
  doc.rect(0, 0, 595, 6).fill(NAVY);
  doc.fillColor(NAVY).fontSize(15).font('Helvetica-Bold').text(title, 60, 60);
  doc.fillColor(GREY).fontSize(9).font('Helvetica').text(subtitle, 60, 80);
  doc.moveTo(60, 105).lineTo(535, 105).strokeColor('#E5E7EB').lineWidth(0.5).stroke();
}
function fmtEUR(n: number): string {
  return Number(n).toLocaleString('en-LU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function humanPeriod(p: string): string {
  if (p === 'Y1') return 'Annual';
  if (/^Q[1-4]$/.test(p)) return p;
  if (/^\d{1,2}$/.test(p)) {
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    return months[Number(p) - 1] || p;
  }
  return p;
}
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
// Suppress unused-var lint for AED_BANK_DETAILS import (referenced via payment object)
void AED_BANK_DETAILS;
