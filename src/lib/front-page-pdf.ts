// Front page / cover PDF generator (PRD §9).
// Uses pdf-lib (pure JS, fonts embedded — Vercel-friendly).

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { computeECDF } from '@/lib/ecdf';
import { generatePaymentReference } from '@/lib/payment-ref';
import { queryOne } from '@/lib/db';

const NAVY = rgb(0x1a / 255, 0x1a / 255, 0x2e / 255);
const GREY = rgb(0x6b / 255, 0x72 / 255, 0x80 / 255);
const DARK = rgb(0x11 / 255, 0x18 / 255, 0x27 / 255);
const LIGHT_GREY = rgb(0xf3 / 255, 0xf4 / 255, 0xf6 / 255);
const WHITE = rgb(1, 1, 1);
const GREEN = rgb(0x05 / 255, 0x96 / 255, 0x69 / 255);
const BORDER = rgb(0xe5 / 255, 0xe7 / 255, 0xeb / 255);

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 60;

export interface PDFBuildResult {
  buffer: Buffer;
  filename: string;
}

type FontSet = { regular: PDFFont; bold: PDFFont; oblique: PDFFont; mono: PDFFont };

export async function buildFrontPagePDF(declarationId: string): Promise<PDFBuildResult> {
  const decl = await queryOne<{
    year: number; period: string;
    entity_name: string; vat_number: string | null; matricule: string | null;
    rcs_number: string | null; address: string | null; client_name: string | null;
    regime: string;
  }>(
    `SELECT d.year, d.period,
            e.name AS entity_name, e.vat_number, e.matricule, e.rcs_number,
            e.address, e.client_name, e.regime
       FROM declarations d JOIN entities e ON d.entity_id = e.id
      WHERE d.id = $1`,
    [declarationId]
  );
  if (!decl) throw new Error('Declaration not found');

  const ecdf = await computeECDF(declarationId);
  let payment: { reference: string; iban: string; bic: string; beneficiary: string } | null = null;
  try {
    payment = generatePaymentReference({
      matricule: decl.matricule, year: decl.year, period: decl.period,
      amount: ecdf.totals.payable,
    });
  } catch { /* matricule missing */ }

  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(`VAT Declaration — ${decl.entity_name} — ${decl.year} ${decl.period}`);
  pdfDoc.setAuthor('cifra');
  pdfDoc.setSubject('VAT Declaration Cover Document');
  pdfDoc.setCreator('cifra');

  const fonts: FontSet = {
    regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
    bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
    oblique: await pdfDoc.embedFont(StandardFonts.HelveticaOblique),
    mono: await pdfDoc.embedFont(StandardFonts.Courier),
  };

  drawCover(pdfDoc.addPage([PAGE_W, PAGE_H]), fonts, decl, ecdf);
  drawAnnex1(pdfDoc, fonts, decl, ecdf);
  if (payment && ecdf.totals.payable > 0) {
    drawAnnex2(pdfDoc.addPage([PAGE_W, PAGE_H]), fonts, decl, ecdf, payment);
  }

  const bytes = await pdfDoc.save();
  const safeEntity = decl.entity_name.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 60);
  return {
    buffer: Buffer.from(bytes),
    filename: `VAT_FrontPage_${safeEntity}_${decl.year}_${decl.period}.pdf`,
  };
}

// ── Cover ──
function drawCover(
  page: PDFPage, fonts: FontSet,
  decl: { entity_name: string; vat_number: string | null; matricule: string | null;
    rcs_number: string | null; address: string | null; client_name: string | null;
    regime: string; year: number; period: string },
  ecdf: { totals: { payable: number; credit: number; vat_due: number } }
) {
  page.drawRectangle({ x: 0, y: PAGE_H - 8, width: PAGE_W, height: 8, color: NAVY });

  page.drawText('LUXEMBOURG VAT DECLARATION', {
    x: MARGIN, y: PAGE_H - 80, size: 9, font: fonts.bold, color: GREY,
  });

  page.drawText(truncate(decl.entity_name, 50), {
    x: MARGIN, y: PAGE_H - 130, size: 26, font: fonts.bold, color: NAVY,
  });

  page.drawText(`${decl.year}  -  ${humanPeriod(decl.period)}  -  ${capitalize(decl.regime)} regime`, {
    x: MARGIN, y: PAGE_H - 158, size: 12, font: fonts.regular, color: GREY,
  });

  // Identifier card
  const cardY = PAGE_H - 290;
  const cardH = 110;
  page.drawRectangle({
    x: MARGIN, y: cardY, width: PAGE_W - 2 * MARGIN, height: cardH, color: LIGHT_GREY,
  });

  const colLeft = MARGIN + 22;
  const colRight = MARGIN + 240;
  drawField(page, fonts, 'VAT NUMBER', decl.vat_number || '-', colLeft, cardY + cardH - 22);
  drawField(page, fonts, 'MATRICULE',  decl.matricule  || '-', colLeft, cardY + cardH - 60);
  drawField(page, fonts, 'RCS',        decl.rcs_number || '-', colLeft, cardY + cardH - 98);
  drawField(page, fonts, 'CLIENT',     decl.client_name || '-', colRight, cardY + cardH - 22);
  drawField(page, fonts, 'ADDRESS',    truncate(decl.address || '-', 45), colRight, cardY + cardH - 60, 280);

  // VAT position
  const headlineY = cardY - 60;
  page.drawText('VAT POSITION', {
    x: MARGIN, y: headlineY, size: 9, font: fonts.bold, color: GREY,
  });
  if (ecdf.totals.payable > 0) {
    page.drawText(`EUR ${fmtEUR(ecdf.totals.payable)}`, {
      x: MARGIN, y: headlineY - 50, size: 38, font: fonts.bold, color: NAVY,
    });
    page.drawText('payable to AED', {
      x: MARGIN, y: headlineY - 70, size: 11, font: fonts.regular, color: GREY,
    });
  } else if (ecdf.totals.credit > 0) {
    page.drawText(`EUR ${fmtEUR(ecdf.totals.credit)}`, {
      x: MARGIN, y: headlineY - 50, size: 38, font: fonts.bold, color: GREEN,
    });
    page.drawText('credit position', {
      x: MARGIN, y: headlineY - 70, size: 11, font: fonts.regular, color: GREY,
    });
  } else {
    page.drawText('EUR 0.00', {
      x: MARGIN, y: headlineY - 50, size: 38, font: fonts.bold, color: NAVY,
    });
    page.drawText('nil position', {
      x: MARGIN, y: headlineY - 70, size: 11, font: fonts.regular, color: GREY,
    });
  }

  // Annexes index (footer)
  let y = MARGIN + 90;
  page.drawText('ANNEXES', { x: MARGIN, y, size: 9, font: fonts.bold, color: GREY });
  y -= 18;
  page.drawText('Annex 1', { x: MARGIN, y, size: 10, font: fonts.bold, color: NAVY });
  page.drawText('VAT calculation summary', { x: MARGIN + 70, y, size: 10, font: fonts.regular, color: GREY });
  if (ecdf.totals.payable > 0) {
    y -= 16;
    page.drawText('Annex 2', { x: MARGIN, y, size: 10, font: fonts.bold, color: NAVY });
    page.drawText('Payment instructions', { x: MARGIN + 70, y, size: 10, font: fonts.regular, color: GREY });
  }

  page.drawText('Generated by cifra · cifracompliance.com', {
    x: MARGIN, y: 30, size: 7.5, font: fonts.oblique, color: GREY,
  });
}

function drawField(page: PDFPage, fonts: FontSet, label: string, value: string, x: number, y: number, width = 200) {
  page.drawText(label, { x, y, size: 7.5, font: fonts.bold, color: GREY });
  page.drawText(truncate(value, Math.floor(width / 6)), {
    x, y: y - 14, size: 11, font: fonts.regular, color: NAVY,
  });
}

// ── Annex 1 ──
function drawAnnex1(
  pdfDoc: PDFDocument, fonts: FontSet,
  decl: { entity_name: string; year: number; period: string },
  ecdf: { boxes: Array<{ box: string; label: string; section: string; value: number; manual?: boolean }>;
    totals: { vat_due: number; payable: number; credit: number } }
) {
  const sections: Record<string, string> = {
    A: 'Section A - Overall turnover',
    B: 'Section B - Intra-Community acquisitions',
    D: 'Section D - Reverse charge',
    F: 'Section F - Total VAT due',
    I: 'Section I - Turnover and output VAT',
    III: 'Section III - Input VAT deduction',
    IV: 'Section IV - Net position',
  };

  const subtitle = `${decl.entity_name} - ${decl.year} ${decl.period}`;
  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  pageHeader(page, fonts, 'Annex 1 - VAT calculation summary', subtitle);

  let y = PAGE_H - 130;
  const left = MARGIN;
  const boxColW = 50;
  const labelColW = 320;
  const valColW = 100;

  for (const sec of Object.keys(sections)) {
    const rows = ecdf.boxes.filter(b => b.section === sec);
    if (rows.length === 0) continue;

    if (y < 200) {
      page = pdfDoc.addPage([PAGE_W, PAGE_H]);
      pageHeader(page, fonts, 'Annex 1 - VAT calculation summary', subtitle);
      y = PAGE_H - 130;
    }

    page.drawText(sections[sec], { x: left, y, size: 11, font: fonts.bold, color: NAVY });
    y -= 22;

    page.drawText('BOX', { x: left, y, size: 7.5, font: fonts.bold, color: GREY });
    page.drawText('DESCRIPTION', { x: left + boxColW, y, size: 7.5, font: fonts.bold, color: GREY });
    const amtLabel = 'AMOUNT (EUR)';
    page.drawText(amtLabel, {
      x: left + boxColW + labelColW + valColW - widthOf(fonts.bold, amtLabel, 7.5),
      y, size: 7.5, font: fonts.bold, color: GREY,
    });
    y -= 6;
    page.drawLine({
      start: { x: left, y }, end: { x: left + boxColW + labelColW + valColW, y },
      thickness: 0.6, color: NAVY,
    });
    y -= 12;

    for (const b of rows) {
      if (y < 80) {
        page = pdfDoc.addPage([PAGE_W, PAGE_H]);
        pageHeader(page, fonts, 'Annex 1 - VAT calculation summary', subtitle);
        y = PAGE_H - 130;
      }
      page.drawText(b.box, { x: left, y, size: 9, font: fonts.bold, color: NAVY });
      page.drawText(truncate(b.label + (b.manual ? '  [manual]' : ''), 60), {
        x: left + boxColW, y, size: 9, font: fonts.regular, color: DARK,
      });
      const val = fmtEUR(b.value);
      page.drawText(val, {
        x: left + boxColW + labelColW + valColW - widthOf(fonts.regular, val, 9),
        y, size: 9, font: fonts.regular, color: DARK,
      });
      y -= 16;
    }
    y -= 16;
  }

  // Total block
  if (y < 110) {
    page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    pageHeader(page, fonts, 'Annex 1 - VAT calculation summary', subtitle);
    y = PAGE_H - 130;
  }
  const blockH = 60;
  page.drawRectangle({
    x: left, y: y - blockH, width: PAGE_W - 2 * MARGIN, height: blockH, color: NAVY,
  });
  page.drawText('TOTAL VAT DUE', {
    x: left + 18, y: y - 22, size: 9, font: fonts.bold, color: WHITE,
  });
  page.drawText(`EUR ${fmtEUR(ecdf.totals.vat_due)}`, {
    x: left + 18, y: y - 50, size: 22, font: fonts.bold, color: WHITE,
  });
  if (ecdf.totals.payable > 0) {
    const txt = `EUR ${fmtEUR(ecdf.totals.payable)}`;
    page.drawText('PAYABLE', { x: PAGE_W - MARGIN - 130, y: y - 22, size: 8, font: fonts.regular, color: rgb(0.6, 0.6, 0.65) });
    page.drawText(txt, { x: PAGE_W - MARGIN - 18 - widthOf(fonts.bold, txt, 16), y: y - 50, size: 16, font: fonts.bold, color: WHITE });
  } else if (ecdf.totals.credit > 0) {
    const txt = `EUR ${fmtEUR(ecdf.totals.credit)}`;
    page.drawText('CREDIT', { x: PAGE_W - MARGIN - 130, y: y - 22, size: 8, font: fonts.regular, color: rgb(0.6, 0.6, 0.65) });
    page.drawText(txt, { x: PAGE_W - MARGIN - 18 - widthOf(fonts.bold, txt, 16), y: y - 50, size: 16, font: fonts.bold, color: GREEN });
  }
}

// ── Annex 2 ──
function drawAnnex2(
  page: PDFPage, fonts: FontSet,
  decl: { entity_name: string; year: number; period: string },
  ecdf: { totals: { payable: number } },
  payment: { reference: string; iban: string; bic: string; beneficiary: string }
) {
  pageHeader(page, fonts, 'Annex 2 - Payment instructions', `${decl.entity_name} - ${decl.year} ${decl.period}`);

  const intro = 'Please make the payment to the AED using the following details. ' +
    'Use the structured payment reference exactly as shown - it identifies the declaration period for the AED.';
  drawWrappedText(page, fonts.regular, intro, MARGIN, PAGE_H - 160, PAGE_W - 2 * MARGIN, 11, DARK, 14);

  // Amount card
  let y = PAGE_H - 240;
  page.drawRectangle({ x: MARGIN, y, width: PAGE_W - 2 * MARGIN, height: 80, color: LIGHT_GREY });
  page.drawText('AMOUNT TO PAY', {
    x: MARGIN + 22, y: y + 58, size: 9, font: fonts.bold, color: GREY,
  });
  page.drawText(`EUR ${fmtEUR(ecdf.totals.payable)}`, {
    x: MARGIN + 22, y: y + 22, size: 28, font: fonts.bold, color: NAVY,
  });

  y -= 50;
  const drawRow = (label: string, value: string, useMono = false) => {
    page.drawText(label, { x: MARGIN, y, size: 9, font: fonts.bold, color: GREY });
    page.drawText(value, { x: MARGIN, y: y - 16, size: 13, font: useMono ? fonts.mono : fonts.regular, color: NAVY });
    y -= 44;
  };
  drawRow('PAYMENT REFERENCE', payment.reference, true);
  drawRow('BENEFICIARY', payment.beneficiary);
  drawRow('IBAN', payment.iban, true);
  drawRow('BIC / SWIFT', payment.bic, true);

  page.drawText(
    'Once the bank confirms the transfer, please share the proof of payment so we can mark the declaration as paid.',
    { x: MARGIN, y: 60, size: 8.5, font: fonts.oblique, color: GREY, maxWidth: PAGE_W - 2 * MARGIN, lineHeight: 12 }
  );
}

// ── helpers ──
function pageHeader(page: PDFPage, fonts: FontSet, title: string, subtitle: string) {
  page.drawRectangle({ x: 0, y: PAGE_H - 6, width: PAGE_W, height: 6, color: NAVY });
  page.drawText(title, { x: MARGIN, y: PAGE_H - 65, size: 15, font: fonts.bold, color: NAVY });
  page.drawText(subtitle, { x: MARGIN, y: PAGE_H - 85, size: 9, font: fonts.regular, color: GREY });
  page.drawLine({
    start: { x: MARGIN, y: PAGE_H - 110 }, end: { x: PAGE_W - MARGIN, y: PAGE_H - 110 },
    thickness: 0.5, color: BORDER,
  });
}
function drawWrappedText(
  page: PDFPage, font: PDFFont, text: string, x: number, y: number, maxWidth: number,
  size: number, color: ReturnType<typeof rgb>, lineHeight: number
) {
  const words = text.split(' ');
  let line = '';
  let cursorY = y;
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (widthOf(font, test, size) > maxWidth) {
      page.drawText(line, { x, y: cursorY, size, font, color });
      cursorY -= lineHeight;
      line = w;
    } else {
      line = test;
    }
  }
  if (line) page.drawText(line, { x, y: cursorY, size, font, color });
}
function widthOf(font: PDFFont, text: string, size: number): number {
  return font.widthOfTextAtSize(text, size);
}
function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '...' : s;
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
