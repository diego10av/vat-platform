// ════════════════════════════════════════════════════════════════════════
// audit-trail-pdf.ts
//
// Generates a formal PDF of a declaration's audit trail — the document
// a VAT professional can attach to their case file when an auditor
// comes asking "why did you classify this line as X instead of what
// the classifier suggested".
//
// Format is intentionally plain and defensible:
//
//   - Header with declaration identity (entity, period, generated-at).
//   - Summary counters.
//   - Table of events, one row each, newest first. AI-override events
//     are flagged with a bold "AI OVERRIDE" marker and a two-line
//     inline diff showing "cifra suggested X (RULE) → user decided Y —
//     reason: '...'".
//
// Uses pdf-lib (pure JS) so it works on Vercel's node runtime without
// Chromium. Same engine as front-page-pdf.ts.
// ════════════════════════════════════════════════════════════════════════

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { query, queryOne } from '@/lib/db';

const NAVY = rgb(0x1a / 255, 0x1a / 255, 0x2e / 255);
const GREY = rgb(0x6b / 255, 0x72 / 255, 0x80 / 255);
const DARK = rgb(0x11 / 255, 0x18 / 255, 0x27 / 255);
const BRAND = rgb(0xe8 / 255, 0x26 / 255, 0x4c / 255);
const BORDER = rgb(0xe5 / 255, 0xe7 / 255, 0xeb / 255);
const WARN_BG = rgb(0xfe / 255, 0xf6 / 255, 0xe7 / 255);

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 50;
const LINE_H = 11;

type FontSet = { regular: PDFFont; bold: PDFFont; oblique: PDFFont; mono: PDFFont };

export interface AuditPDFResult {
  buffer: Buffer;
  filename: string;
}

interface AuditRow {
  created_at: string;
  user_id: string | null;
  action: string;
  target_type: string;
  target_id: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  reason: string | null;
  line_description: string | null;
  line_provider: string | null;
  ai_suggested_treatment: string | null;
  ai_suggested_rule: string | null;
}

export async function buildAuditTrailPDF(declarationId: string): Promise<AuditPDFResult> {
  // Gather declaration context + events.
  const decl = await queryOne<{
    year: number; period: string;
    entity_name: string; vat_number: string | null;
    matricule: string | null; status: string;
  }>(
    `SELECT d.year, d.period, d.status,
            e.name AS entity_name, e.vat_number, e.matricule
       FROM declarations d JOIN entities e ON d.entity_id = e.id
      WHERE d.id = $1`,
    [declarationId],
  );
  if (!decl) throw new Error('Declaration not found');

  const rows = await query<AuditRow>(
    `SELECT a.created_at::text AS created_at,
            a.user_id, a.action, a.target_type, a.target_id,
            a.field, a.old_value, a.new_value, a.reason,
            il.description AS line_description,
            i.provider AS line_provider,
            il.ai_suggested_treatment,
            il.ai_suggested_rule
       FROM audit_log a
       LEFT JOIN invoice_lines il
         ON a.target_type = 'invoice_line' AND a.target_id = il.id
       LEFT JOIN invoices i
         ON a.target_type = 'invoice'      AND a.target_id = i.id
       WHERE a.declaration_id = $1
       ORDER BY a.created_at DESC
       LIMIT 2000`,
    [declarationId],
  );

  // Derived counters for the summary box.
  const total = rows.length;
  const aiOverrides = rows.filter(r =>
    r.target_type === 'invoice_line' &&
    r.field === 'treatment' &&
    r.ai_suggested_treatment != null &&
    r.new_value !== r.ai_suggested_treatment,
  ).length;
  const treatmentChanges = rows.filter(r =>
    r.target_type === 'invoice_line' && r.field === 'treatment',
  ).length;

  // ─── Build PDF ───
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(`Audit Trail — ${decl.entity_name} — ${decl.year} ${decl.period}`);
  pdfDoc.setAuthor('cifra');
  pdfDoc.setSubject('VAT Declaration Audit Trail');
  pdfDoc.setCreator('cifra');

  const fonts: FontSet = {
    regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
    bold:    await pdfDoc.embedFont(StandardFonts.HelveticaBold),
    oblique: await pdfDoc.embedFont(StandardFonts.HelveticaOblique),
    mono:    await pdfDoc.embedFont(StandardFonts.Courier),
  };

  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  // Header band
  page.drawRectangle({ x: 0, y: PAGE_H - 90, width: PAGE_W, height: 90, color: rgb(0.98, 0.95, 0.93) });
  page.drawText('cifra', { x: MARGIN, y: PAGE_H - 42, size: 18, font: fonts.bold, color: BRAND });
  page.drawText('Audit trail', { x: MARGIN, y: PAGE_H - 62, size: 11, font: fonts.regular, color: GREY });
  page.drawText(`Generated: ${new Date().toLocaleString('en-GB')}`, {
    x: PAGE_W - MARGIN - 200, y: PAGE_H - 42, size: 9, font: fonts.regular, color: GREY,
  });
  page.drawText('cifracompliance.com', {
    x: PAGE_W - MARGIN - 200, y: PAGE_H - 56, size: 9, font: fonts.oblique, color: GREY,
  });

  y = PAGE_H - 120;

  // Declaration context
  page.drawText(decl.entity_name, { x: MARGIN, y, size: 14, font: fonts.bold, color: DARK });
  y -= 16;
  const metaLine = [
    `${decl.year} ${decl.period}`,
    decl.vat_number ? `VAT: ${decl.vat_number}` : null,
    decl.matricule ? `Matricule: ${decl.matricule}` : null,
    `Status: ${decl.status}`,
  ].filter(Boolean).join('  ·  ');
  page.drawText(metaLine, { x: MARGIN, y, size: 9, font: fonts.regular, color: GREY });
  y -= 22;

  // Summary box
  const sumY = y;
  page.drawRectangle({
    x: MARGIN, y: sumY - 36, width: PAGE_W - MARGIN * 2, height: 36,
    color: rgb(0.98, 0.98, 0.98), borderColor: BORDER, borderWidth: 0.5,
  });
  const boxes: Array<[string, string]> = [
    ['Total events', String(total)],
    ['AI overrides', String(aiOverrides)],
    ['Treatment changes', String(treatmentChanges)],
  ];
  const boxW = (PAGE_W - MARGIN * 2) / boxes.length;
  boxes.forEach(([label, val], i) => {
    const cx = MARGIN + i * boxW + boxW / 2;
    page.drawText(label.toUpperCase(), {
      x: cx - fonts.regular.widthOfTextAtSize(label.toUpperCase(), 7) / 2,
      y: sumY - 12, size: 7, font: fonts.regular, color: GREY,
    });
    const isOverride = i === 1 && aiOverrides > 0;
    page.drawText(val, {
      x: cx - fonts.bold.widthOfTextAtSize(val, 16) / 2,
      y: sumY - 30, size: 16, font: fonts.bold, color: isOverride ? BRAND : DARK,
    });
  });
  y = sumY - 48;

  // Section divider
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.5, color: BORDER });
  y -= 18;

  page.drawText('EVENTS', { x: MARGIN, y, size: 8, font: fonts.bold, color: GREY });
  page.drawText('(newest first)', { x: MARGIN + 50, y, size: 8, font: fonts.oblique, color: GREY });
  y -= 12;

  if (rows.length === 0) {
    page.drawText('No events recorded yet for this declaration.', {
      x: MARGIN, y: y - 12, size: 10, font: fonts.oblique, color: GREY,
    });
  }

  // ─── Event rows ───
  for (const row of rows) {
    const rowHeight = estimateRowHeight(row);
    if (y - rowHeight < MARGIN + 30) {
      // Footer on the page we're about to leave
      drawFooter(page, fonts);
      page = pdfDoc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }
    y = drawEventRow(page, fonts, row, y);
  }

  // ─── Supporting documents section ───
  // Each attached contract / engagement letter / advisor email
  // gets its own stanza with the reviewer's legal-basis reference,
  // free-text note, and (if run) cifra's analysis + citations.
  // This is what turns "trust me, I thought about it" into
  // "here's the document, here's why, here's the citation".
  const attachments = await query<{
    id: string; invoice_id: string; kind: string; filename: string;
    user_note: string | null; legal_basis: string | null;
    ai_summary: string | null; ai_suggested_treatment: string | null;
    ai_citations: Array<{ legal_id: string; quote?: string; reason?: string }> | null;
    created_at: string;
    invoice_provider: string | null;
  }>(
    `SELECT a.id, a.invoice_id, a.kind, a.filename,
            a.user_note, a.legal_basis,
            a.ai_summary, a.ai_suggested_treatment, a.ai_citations,
            a.created_at::text AS created_at,
            i.provider AS invoice_provider
       FROM invoice_attachments a
       JOIN invoices i ON a.invoice_id = i.id
      WHERE i.declaration_id = $1 AND a.deleted_at IS NULL
      ORDER BY i.provider, a.created_at DESC
      LIMIT 500`,
    [declarationId],
  );

  if (attachments.length > 0) {
    // Page break if we're close to the bottom
    if (y < MARGIN + 120) {
      drawFooter(page, fonts);
      page = pdfDoc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    } else {
      y -= 14;
    }

    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.5, color: BORDER });
    y -= 18;
    page.drawText('SUPPORTING DOCUMENTS', { x: MARGIN, y, size: 8, font: fonts.bold, color: GREY });
    page.drawText(`(${attachments.length} attached)`, {
      x: MARGIN + 160, y, size: 8, font: fonts.oblique, color: GREY,
    });
    y -= 12;

    for (const att of attachments) {
      const estH = estimateAttachmentHeight(att);
      if (y - estH < MARGIN + 30) {
        drawFooter(page, fonts);
        page = pdfDoc.addPage([PAGE_W, PAGE_H]);
        y = PAGE_H - MARGIN;
      }
      y = drawAttachmentRow(page, fonts, att, y);
    }
  }

  drawFooter(page, fonts);

  const arrayBuffer = await pdfDoc.save();
  const safeEntity = (decl.entity_name || 'entity').replace(/[^A-Za-z0-9_-]+/g, '_');
  const filename = `cifra_audit_${safeEntity}_${decl.year}_${decl.period}.pdf`;
  return { buffer: Buffer.from(arrayBuffer), filename };
}

// ────────────────────────── attachment rendering ──────────────────────────

interface PdfAttachment {
  filename: string;
  kind: string;
  user_note: string | null;
  legal_basis: string | null;
  ai_summary: string | null;
  ai_suggested_treatment: string | null;
  ai_citations: Array<{ legal_id: string; quote?: string; reason?: string }> | null;
  invoice_provider: string | null;
}

function estimateAttachmentHeight(a: PdfAttachment): number {
  let h = 32; // header + filename + top/bottom padding
  if (a.legal_basis) h += 11;
  if (a.user_note) {
    // ~1 line per 90 chars
    h += 12 + Math.ceil(a.user_note.length / 90) * 11;
  }
  if (a.ai_summary) {
    h += 14 + Math.ceil(a.ai_summary.length / 90) * 11;
  }
  if (a.ai_suggested_treatment) h += 12;
  if (a.ai_citations && a.ai_citations.length > 0) {
    h += 12 + a.ai_citations.length * 14;
  }
  return h;
}

function drawAttachmentRow(page: PDFPage, fonts: FontSet, a: PdfAttachment, startY: number): number {
  let y = startY;
  const boxX = MARGIN;
  const boxW = PAGE_W - MARGIN * 2;

  // Header line — filename, kind, invoice provider
  const kindPretty = a.kind.replace(/_/g, ' ');
  const header = `${a.filename}   · ${kindPretty}   · ${a.invoice_provider ?? '(no provider)'}`;
  page.drawText(clip(header, 100), { x: boxX + 6, y: y - 10, size: 9.5, font: fonts.bold, color: DARK });
  y -= LINE_H + 2;

  if (a.legal_basis) {
    page.drawText(`Legal basis: ${clip(a.legal_basis, 90)}`, {
      x: boxX + 6, y: y - 10, size: 9, font: fonts.regular, color: NAVY,
    });
    y -= LINE_H;
  }

  if (a.user_note) {
    page.drawText('Reviewer note:', { x: boxX + 6, y: y - 10, size: 8.5, font: fonts.bold, color: GREY });
    y -= LINE_H;
    y = drawWrappedText(page, fonts.oblique, a.user_note, boxX + 12, y, boxW - 18, 9);
  }

  if (a.ai_summary) {
    page.drawText('cifra analysis:', { x: boxX + 6, y: y - 10, size: 8.5, font: fonts.bold, color: BRAND });
    y -= LINE_H;
    y = drawWrappedText(page, fonts.regular, a.ai_summary, boxX + 12, y, boxW - 18, 9);
  }

  if (a.ai_suggested_treatment) {
    page.drawText(`Suggested treatment: ${a.ai_suggested_treatment}   (reviewer decides)`, {
      x: boxX + 12, y: y - 10, size: 8.5, font: fonts.regular, color: NAVY,
    });
    y -= LINE_H;
  }

  if (a.ai_citations && a.ai_citations.length > 0) {
    page.drawText('Citations:', { x: boxX + 6, y: y - 10, size: 8.5, font: fonts.bold, color: GREY });
    y -= LINE_H;
    for (const c of a.ai_citations) {
      const line = c.reason
        ? `• ${c.legal_id} — ${clip(c.reason, 80)}`
        : `• ${c.legal_id}`;
      page.drawText(line, {
        x: boxX + 12, y: y - 10, size: 8.5, font: fonts.regular, color: NAVY,
      });
      y -= LINE_H;
    }
  }

  // Separator
  page.drawLine({
    start: { x: boxX, y: y - 3 },
    end:   { x: boxX + boxW, y: y - 3 },
    thickness: 0.3, color: BORDER,
  });
  y -= 10;
  return y;
}

/** Simple greedy word-wrap text drawer. Returns the new y after drawing. */
function drawWrappedText(
  page: PDFPage, font: PDFFont, text: string, x: number, startY: number, maxWidth: number, size: number,
): number {
  const words = text.replace(/\s+/g, ' ').split(' ');
  let y = startY;
  let cur = '';
  for (const w of words) {
    const candidate = cur ? `${cur} ${w}` : w;
    const width = font.widthOfTextAtSize(candidate, size);
    if (width > maxWidth && cur) {
      page.drawText(cur, { x, y: y - 10, size, font, color: DARK });
      y -= LINE_H;
      cur = w;
    } else {
      cur = candidate;
    }
  }
  if (cur) {
    page.drawText(cur, { x, y: y - 10, size, font, color: DARK });
    y -= LINE_H;
  }
  return y;
}

// ────────────────────────── row rendering ──────────────────────────

function estimateRowHeight(row: AuditRow): number {
  // Base: timestamp + title + line context = 3 small lines ≈ 30pt.
  // AI override adds 2 more lines. Reason adds 1 line.
  let h = 28;
  if (isAiOverride(row)) h += 14;
  if (row.reason) h += 12;
  h += 8; // bottom padding
  return h;
}

function drawEventRow(page: PDFPage, fonts: FontSet, row: AuditRow, startY: number): number {
  const aiOverride = isAiOverride(row);
  const when = new Date(row.created_at).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
  const who = row.user_id ?? 'founder';

  let y = startY;

  // Left marker bar (warning colour if override, grey otherwise)
  const rowTop = y;
  const markerX = MARGIN;
  const bodyX = MARGIN + 8;

  // Timestamp + user
  page.drawText(when, { x: bodyX, y: y - 10, size: 8, font: fonts.mono, color: GREY });
  page.drawText(`· ${who}`, {
    x: bodyX + fonts.mono.widthOfTextAtSize(when, 8) + 6,
    y: y - 10, size: 8, font: fonts.regular, color: GREY,
  });
  if (aiOverride) {
    // Right-aligned "AI OVERRIDE" pill
    const pill = 'AI OVERRIDE';
    const w = fonts.bold.widthOfTextAtSize(pill, 7);
    page.drawRectangle({
      x: PAGE_W - MARGIN - w - 8, y: y - 12, width: w + 8, height: 12,
      color: WARN_BG,
    });
    page.drawText(pill, {
      x: PAGE_W - MARGIN - w - 4, y: y - 9, size: 7, font: fonts.bold, color: NAVY,
    });
  }
  y -= LINE_H + 2;

  // Title line
  const title = describe(row);
  page.drawText(clip(title, 92), { x: bodyX, y: y - 10, size: 9.5, font: fonts.regular, color: DARK });
  y -= LINE_H;

  // AI override detail line (two segments)
  if (aiOverride) {
    const ai = row.ai_suggested_treatment ?? '—';
    const rule = row.ai_suggested_rule ? ` (${row.ai_suggested_rule})` : '';
    const user = row.new_value ?? '—';
    const det = `   cifra suggested ${ai}${rule}  →  you decided ${user}`;
    page.drawText(clip(det, 98), { x: bodyX, y: y - 10, size: 8.5, font: fonts.regular, color: NAVY });
    y -= LINE_H;
  }

  // Line context (provider + description)
  const ctx = [row.line_provider, row.line_description].filter(Boolean).join(' — ');
  if (ctx) {
    page.drawText(`   ${clip(ctx, 100)}`, {
      x: bodyX, y: y - 10, size: 8, font: fonts.oblique, color: GREY,
    });
    y -= LINE_H;
  }

  // Reason
  if (row.reason) {
    page.drawText(`   Reason: "${clip(row.reason, 90)}"`, {
      x: bodyX, y: y - 10, size: 8.5, font: fonts.oblique, color: DARK,
    });
    y -= LINE_H;
  }

  // Marker bar (draw last, across the whole row height)
  page.drawRectangle({
    x: markerX, y: y - 2, width: 2.5, height: rowTop - (y - 2),
    color: aiOverride ? BRAND : BORDER,
  });

  y -= 8; // bottom padding
  return y;
}

// ────────────────────────── helpers ──────────────────────────

function isAiOverride(row: AuditRow): boolean {
  return (
    row.target_type === 'invoice_line' &&
    row.field === 'treatment' &&
    row.ai_suggested_treatment != null &&
    row.new_value !== row.ai_suggested_treatment
  );
}

function clip(s: string | null, max: number): string {
  if (!s) return '';
  const clean = s.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : clean.slice(0, max - 1) + '…';
}

function describe(row: AuditRow): string {
  const field = row.field ?? '';
  const from = row.old_value || '(empty)';
  const to   = row.new_value || '(empty)';
  if (row.target_type === 'invoice_line' && field) {
    return `${capitalise(field)} changed: ${from} → ${to}`;
  }
  if (row.target_type === 'invoice' && field) {
    return `Invoice ${field} changed: ${from} → ${to}`;
  }
  if (row.target_type === 'declaration') {
    if (row.action === 'approve') return 'Declaration approved';
    if (row.action === 'file')    return 'Declaration marked as filed';
    if (row.action === 'pay')     return 'Declaration marked as paid';
    return `Declaration ${row.action}${field ? ` (${field})` : ''}`;
  }
  return `${row.action} ${row.target_type}${field ? ` · ${field}` : ''}`;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
}

function drawFooter(page: PDFPage, fonts: FontSet) {
  page.drawText(
    'Generated by cifra · cifracompliance.com  ·  Every change is logged with timestamp and user; retain for compliance.',
    { x: MARGIN, y: 24, size: 7, font: fonts.oblique, color: GREY },
  );
}
