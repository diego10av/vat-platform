// ════════════════════════════════════════════════════════════════════════
// POST /api/declarations/[id]/excel/preview
//
// Phase 1 of the "client sent us an Excel instead of PDFs" flow.
// Accepts an xlsx/csv file; returns the Claude-suggested column
// mapping + every parsed row as structured preview data. NOTHING is
// written to the database yet — confirmation happens in phase 2.
//
// Why two phases: clients' spreadsheets are wildly heterogeneous
// (merged cells, localized headers, mixed locales, date formats).
// Blind-inserting 150 rows where "Amount" is actually VAT is a
// disaster that takes an hour to untangle. A mandatory preview +
// reviewer confirmation turns a one-bad-cell error from "catastrophe"
// into "fix in the modal, re-confirm".
//
// Request: multipart/form-data with field `file` (xlsx or csv).
// Response:
//   {
//     source: { filename, rows_detected, sheet_name },
//     mapping: { provider, country, invoice_date, amount_eur,
//                vat_rate, vat_applied, description, direction,
//                currency, provider_vat, invoice_number },
//     rows: [ { raw: {...}, parsed: {...}, warnings: [...] } ],
//     warnings: [ overall warnings — e.g. "2 rows had unparseable dates" ],
//   }
// ════════════════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import ExcelJS from 'exceljs';
import { apiError, apiOk, apiFail } from '@/lib/api-errors';
import { anthropicCreate } from '@/lib/anthropic-wrapper';
import { requireBudget } from '@/lib/budget-guard';
import { checkRateLimit } from '@/lib/rate-limit';
import { queryOne } from '@/lib/db';
import { logger } from '@/lib/logger';

const log = logger.bind('declaration/excel-preview');

// Our canonical invoice fields (subset). The client xlsx can map zero
// or more of these; unmapped fields become null in the parsed rows.
// The list is deliberately short — we only need enough to create a
// minimum-viable invoice + invoice_line. Richer fields (direction
// confidence, fx, exemption refs) are reviewer-edited later.
const CANONICAL_FIELDS = [
  'provider',         // string — who issued the invoice
  'provider_vat',     // string — their VAT number (optional)
  'country',          // string — ISO-2 country where provider is based
  'invoice_number',   // string — invoice ref (optional)
  'invoice_date',     // date YYYY-MM-DD
  'description',      // string — line description
  'amount_eur',       // number — net amount in EUR
  'vat_rate',         // number — 0..1 (e.g. 0.17 or 17% parsed)
  'vat_applied',      // number — VAT amount in EUR
  'direction',        // 'incoming' | 'outgoing'
  'currency',         // ISO-3 — defaults to EUR if missing
] as const;
type CanonicalField = typeof CANONICAL_FIELDS[number];
type Mapping = Partial<Record<CanonicalField, string | null>>;

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8 MB
const MAX_ROWS_PREVIEW = 500;
const MAX_ROWS_TO_AI = 8; // sample rows for Claude to infer mapping

export const maxDuration = 120;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const rl = checkRateLimit(request, { max: 10, windowMs: 60_000, scope: 'excel/preview' });
    if (!rl.ok) return rl.response;

    const { id: declarationId } = await params;

    // Declaration must exist + AI mode check (if classifier_only,
    // we still allow Excel ingestion but skip the Claude column-
    // mapping step and let the user map manually in the UI).
    const decl = await queryOne<{ id: string; entity_id: string; ai_mode: string }>(
      `SELECT d.id, d.entity_id, COALESCE(e.ai_mode, 'full') AS ai_mode
         FROM declarations d JOIN entities e ON d.entity_id = e.id WHERE d.id = $1`,
      [declarationId],
    );
    if (!decl) return apiError('declaration_not_found', 'Declaration not found.', { status: 404 });

    const aiMode = decl.ai_mode as 'full' | 'classifier_only';

    // Multipart parse
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return apiError('file_required', 'Upload an xlsx or csv file in the `file` field.', { status: 400 });
    }
    if (file.size > MAX_FILE_BYTES) {
      return apiError('file_too_large', `Max file size is ${MAX_FILE_BYTES / 1024 / 1024} MB.`, { status: 400 });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const parsed = await parseSpreadsheet(buf, file.name);
    if (!parsed.ok) return apiError(parsed.code, parsed.message, { status: 400 });

    const { sheetName, headers, rawRows } = parsed;
    if (rawRows.length === 0) {
      return apiError('no_rows', 'The spreadsheet contains no data rows.', { status: 400 });
    }

    // Ask Claude to map columns — unless we're in classifier-only mode,
    // in which case we make a best-effort guess via column-name matching
    // and leave the UI to let the user fix.
    let mapping: Mapping;
    let mappingSource: 'ai' | 'heuristic';
    if (aiMode === 'classifier_only') {
      mapping = heuristicMapping(headers);
      mappingSource = 'heuristic';
    } else {
      const budget = await requireBudget();
      if (!budget.ok) {
        // If the firm-wide budget is exhausted we degrade to heuristic
        // too — better partial help than a 429 here.
        mapping = heuristicMapping(headers);
        mappingSource = 'heuristic';
      } else {
        mapping = await suggestMappingViaAI(headers, rawRows.slice(0, MAX_ROWS_TO_AI))
          .catch((err) => {
            log.warn('AI mapping failed, falling back to heuristic', err);
            return heuristicMapping(headers);
          });
        mappingSource = 'ai';
      }
    }

    const parsedRows = rawRows.slice(0, MAX_ROWS_PREVIEW).map((raw, idx) =>
      parseRow(raw, mapping, idx),
    );
    const overallWarnings: string[] = [];
    if (rawRows.length > MAX_ROWS_PREVIEW) {
      overallWarnings.push(
        `Showing the first ${MAX_ROWS_PREVIEW} rows of ${rawRows.length} — only those will be imported.`,
      );
    }
    if (!CANONICAL_FIELDS.every(f => mapping[f] != null) && aiMode !== 'classifier_only') {
      const missing = CANONICAL_FIELDS.filter(f => !mapping[f]);
      overallWarnings.push(
        `No column found for: ${missing.join(', ')}. You can leave unmapped fields blank — every invoice must have at least a provider and an amount.`,
      );
    }

    return apiOk({
      source: {
        filename: file.name,
        sheet_name: sheetName,
        rows_detected: rawRows.length,
        mapping_source: mappingSource,
      },
      headers,
      mapping,
      rows: parsedRows,
      warnings: overallWarnings,
    });
  } catch (err) {
    return apiFail(err, 'declaration/excel-preview');
  }
}

// ────────────────────────── spreadsheet parsing ──────────────────────────

type ParseOk = { ok: true; sheetName: string; headers: string[]; rawRows: Record<string, unknown>[] };
type ParseErr = { ok: false; code: string; message: string };

async function parseSpreadsheet(buf: Buffer, filename: string): Promise<ParseOk | ParseErr> {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.csv')) return parseCsv(buf);
  if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) return parseXlsx(buf);
  return { ok: false, code: 'unsupported_format', message: 'Upload an xlsx, xlsm, or csv file.' };
}

async function parseXlsx(buf: Buffer): Promise<ParseOk | ParseErr> {
  const wb = new ExcelJS.Workbook();
  try {
    // exceljs types want ArrayBuffer / Uint8Array (not Node's Buffer<>).
    // The runtime accepts both; cast keeps the strict TS types happy.
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    return { ok: false, code: 'xlsx_unreadable', message: 'Could not read the xlsx file. Is it password-protected or corrupt?' };
  }
  const sheet = wb.worksheets.find(ws => ws.rowCount > 1) ?? wb.worksheets[0];
  if (!sheet) return { ok: false, code: 'no_sheets', message: 'No usable sheet in the file.' };

  // Find the first non-empty row — treat it as the header row. Tolerant
  // of a few junk rows above the table (title row, blank row, etc).
  let headerRowIdx = -1;
  let headers: string[] = [];
  const maxScan = Math.min(sheet.rowCount, 10);
  for (let r = 1; r <= maxScan; r++) {
    const row = sheet.getRow(r);
    const values: string[] = [];
    let nonEmpty = 0;
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      values[col - 1] = String(cell.value ?? '').trim();
      if (values[col - 1]) nonEmpty += 1;
    });
    if (nonEmpty >= 2) {
      headerRowIdx = r;
      headers = values.filter((v): v is string => !!v);
      break;
    }
  }
  if (headerRowIdx < 0) {
    return { ok: false, code: 'no_headers', message: 'Could not find a header row in the first 10 rows.' };
  }

  const rawRows: Record<string, unknown>[] = [];
  for (let r = headerRowIdx + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const obj: Record<string, unknown> = {};
    let hasAny = false;
    headers.forEach((h, i) => {
      const cell = row.getCell(i + 1);
      const v = cell.value;
      if (v != null && v !== '') { obj[h] = v; hasAny = true; }
    });
    if (hasAny) rawRows.push(obj);
  }
  return { ok: true, sheetName: sheet.name, headers, rawRows };
}

async function parseCsv(buf: Buffer): Promise<ParseOk | ParseErr> {
  const text = buf.toString('utf8');
  const lines = text.split(/\r?\n/).filter(l => l.length > 0);
  if (lines.length < 2) return { ok: false, code: 'csv_too_small', message: 'CSV needs a header row and at least 1 data row.' };
  const sep = [',', ';', '\t'].map(s => ({ s, n: (lines[0].match(new RegExp(s === '\t' ? '\\t' : `\\${s}`, 'g')) || []).length }))
    .sort((a, b) => b.n - a.n)[0].s;
  const splitLine = (line: string): string[] => {
    // naive CSV split — handles quoted cells, not multi-line cells.
    const out: string[] = [];
    let cur = ''; let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') inQuotes = !inQuotes;
      else if (c === sep && !inQuotes) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out.map(s => s.replace(/^"|"$/g, '').trim());
  };
  const headers = splitLine(lines[0]).filter(h => h.length > 0);
  const rawRows: Record<string, unknown>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i]);
    const obj: Record<string, unknown> = {};
    let hasAny = false;
    headers.forEach((h, j) => {
      const v = cells[j];
      if (v != null && v !== '') { obj[h] = v; hasAny = true; }
    });
    if (hasAny) rawRows.push(obj);
  }
  return { ok: true, sheetName: 'CSV', headers, rawRows };
}

// ────────────────────────── column mapping ──────────────────────────

/**
 * Heuristic column mapping — picks the best header match per canonical
 * field using common aliases (EN / FR / DE / ES), case-insensitive,
 * partial-match tolerant. Runs when Claude isn't available (classifier-
 * only mode, budget exhausted, AI call failed).
 */
function heuristicMapping(headers: string[]): Mapping {
  const aliases: Record<CanonicalField, string[]> = {
    provider:       ['provider', 'supplier', 'vendor', 'fournisseur', 'lieferant', 'proveedor', 'issuer'],
    provider_vat:   ['vat', 'vat number', 'tva', 'numero tva', 'ustid', 'vat-id', 'supplier vat', 'nif'],
    country:        ['country', 'pays', 'land', 'pais', 'país', 'origin'],
    invoice_number: ['invoice number', 'invoice no', 'inv no', 'inv. no', 'numero facture', 'rechnungsnr', 'nº factura'],
    invoice_date:   ['invoice date', 'date', 'fecha', 'datum', 'fecha factura', 'issued'],
    description:    ['description', 'libellé', 'service', 'concept', 'bezeichnung', 'narrative', 'concepto'],
    amount_eur:     ['amount eur', 'net amount', 'amount', 'montant', 'net', 'base', 'ht', 'neto', 'importe'],
    vat_rate:       ['vat rate', 'rate', 'taux', 'tax rate', 'tipo iva', 'iva'],
    vat_applied:    ['vat amount', 'vat', 'tax', 'tva amount', 'iva importe', 'mwst'],
    direction:      ['direction', 'type', 'in/out', 'incoming/outgoing'],
    currency:       ['currency', 'devise', 'waehrung', 'moneda', 'ccy'],
  };
  const lower = headers.map(h => ({ original: h, norm: h.toLowerCase().trim() }));
  const mapping: Mapping = {};
  for (const field of CANONICAL_FIELDS) {
    const candidates = aliases[field];
    const hit = lower.find(h => candidates.some(a => h.norm === a || h.norm.includes(a)));
    mapping[field] = hit?.original ?? null;
  }
  return mapping;
}

/**
 * AI-powered column mapping. Sends headers + sample rows to Claude
 * Haiku and asks it to produce a strict JSON mapping.
 */
async function suggestMappingViaAI(
  headers: string[],
  sample: Record<string, unknown>[],
): Promise<Mapping> {
  const system = `You map spreadsheet columns to a canonical invoice schema for a Luxembourg VAT tool.

Canonical fields:
- provider: name of the supplier / issuer of the invoice
- provider_vat: the supplier's VAT identification number
- country: ISO-2 country code where the provider is based (e.g. "LU", "FR", "DE")
- invoice_number: the invoice reference / number
- invoice_date: the date on the invoice (will be normalised to YYYY-MM-DD downstream)
- description: short description of the service / goods
- amount_eur: net amount in EUR (exclusive of VAT)
- vat_rate: VAT rate as a decimal (e.g. 0.17 for 17%); also accept percentages
- vat_applied: VAT amount in EUR
- direction: 'incoming' or 'outgoing'
- currency: ISO-3 currency (defaults to EUR if unmapped)

Return STRICT JSON. One key per canonical field. Value = the EXACT header string from the input, or null if no column fits. Do NOT invent headers. Do NOT explain.`;

  const user = `Headers (in order): ${JSON.stringify(headers)}

Sample rows (first ${sample.length}):
${JSON.stringify(sample, null, 2)}

Return a JSON object mapping each canonical field to one of the headers (or null).`;

  const res = await anthropicCreate(
    {
      model: HAIKU_MODEL,
      max_tokens: 600,
      system,
      messages: [{ role: 'user', content: user }],
    },
    {
      agent: 'other',
      label: 'excel column map',
    },
  );
  const first = res.content.find(b => b.type === 'text');
  if (!first || first.type !== 'text') throw new Error('No text response from mapper');

  const jsonMatch = first.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in mapper response');
  const raw = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

  const mapping: Mapping = {};
  for (const field of CANONICAL_FIELDS) {
    const val = raw[field];
    mapping[field] = typeof val === 'string' && headers.includes(val) ? val : null;
  }
  return mapping;
}

// ────────────────────────── row parsing ──────────────────────────

interface ParsedRow {
  idx: number;
  raw: Record<string, unknown>;
  parsed: {
    provider: string | null;
    provider_vat: string | null;
    country: string | null;
    invoice_number: string | null;
    invoice_date: string | null;
    description: string | null;
    amount_eur: number | null;
    vat_rate: number | null;
    vat_applied: number | null;
    direction: 'incoming' | 'outgoing' | null;
    currency: string | null;
  };
  warnings: string[];
}

function parseRow(raw: Record<string, unknown>, mapping: Mapping, idx: number): ParsedRow {
  const warnings: string[] = [];
  const get = (field: CanonicalField): unknown => {
    const header = mapping[field];
    return header ? raw[header] : undefined;
  };

  const provider = str(get('provider'));
  const provider_vat = str(get('provider_vat'));
  const country = parseCountry(get('country'));
  const invoice_number = str(get('invoice_number'));
  const invoice_date = parseDate(get('invoice_date'), warnings);
  const description = str(get('description'));
  const amount_eur = parseAmount(get('amount_eur'), warnings, 'amount');
  const vat_rate = parseVatRate(get('vat_rate'), warnings);
  const vat_applied = parseAmount(get('vat_applied'), warnings, 'vat_applied');
  const direction = parseDirection(get('direction'));
  const currency = parseCurrency(get('currency'));

  if (!provider)   warnings.push('missing provider');
  if (amount_eur == null) warnings.push('missing amount');

  return {
    idx,
    raw,
    parsed: {
      provider, provider_vat, country, invoice_number, invoice_date,
      description, amount_eur, vat_rate, vat_applied, direction, currency,
    },
    warnings,
  };
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}
function parseAmount(v: unknown, warnings: string[], label: string): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const cleaned = String(v).replace(/[^\d.,-]/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number(cleaned);
  if (!Number.isFinite(n)) { warnings.push(`${label} "${v}" not numeric`); return null; }
  return n;
}
function parseVatRate(v: unknown, warnings: string[]): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    // Accept 17 or 0.17
    return v > 1 ? v / 100 : v;
  }
  const s = String(v).trim().replace('%', '').replace(',', '.');
  const n = Number(s);
  if (!Number.isFinite(n)) { warnings.push(`vat rate "${v}" not numeric`); return null; }
  return n > 1 ? n / 100 : n;
}
function parseCountry(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  // ISO-2 pass-through, else try to turn "France" → FR via common names.
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  const common: Record<string, string> = {
    luxembourg: 'LU', luxemburgo: 'LU', france: 'FR', germany: 'DE', spain: 'ES',
    italy: 'IT', belgium: 'BE', netherlands: 'NL', portugal: 'PT', ireland: 'IE',
    'united kingdom': 'GB', uk: 'GB', switzerland: 'CH', austria: 'AT',
    'united states': 'US', usa: 'US',
  };
  const key = s.toLowerCase();
  return common[key] ?? s.toUpperCase();
}
function parseCurrency(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  if (/^[A-Za-z]{3}$/.test(s)) return s.toUpperCase();
  return null;
}
function parseDirection(v: unknown): 'incoming' | 'outgoing' | null {
  const s = str(v)?.toLowerCase();
  if (!s) return null;
  if (['incoming', 'in', 'purchase', 'achats', 'compra', 'import', 'ingreso'].includes(s)) return 'incoming';
  if (['outgoing', 'out', 'sale', 'ventes', 'venta', 'export', 'egreso'].includes(s)) return 'outgoing';
  return null;
}
function parseDate(v: unknown, warnings: string[]): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  // Excel date serial (days since 1900-01-01 with a leap-year quirk)
  if (typeof v === 'number' && v > 20000 && v < 60000) {
    const ms = (v - 25569) * 86400 * 1000;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  // Try ISO
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // Try DD/MM/YYYY or DD.MM.YYYY or DD-MM-YYYY
  const dmy = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/.exec(s);
  if (dmy) {
    const [, d, m, y] = dmy;
    const year = y.length === 2 ? (Number(y) > 50 ? `19${y}` : `20${y}`) : y;
    return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  warnings.push(`date "${v}" not parseable`);
  return null;
}
