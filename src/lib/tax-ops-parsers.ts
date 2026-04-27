// ════════════════════════════════════════════════════════════════════════
// tax-ops-parsers.ts
//
// Pure helpers used by the Excel + Notion migration script. Kept away
// from any I/O so the logic can be unit-tested and reused if we ever
// re-run a migration or accept manual imports.
//
// Two principal concerns:
//   1. status parser — Diego's status column is free-text. Typical
//      patterns: "Filed on DD.MM.YYYY", "Waiting for X", "Requested
//      on DD.MM.YYYY", "Financials requested on DD.MM.YYYY", and empty.
//      The parser maps text → { status, *_at date, residual comment }.
//   2. legal-name normalization — "Acme SARL  " and " Acme SARL" are
//      the same entity. We collapse whitespace + strip for dedup.
// ════════════════════════════════════════════════════════════════════════

// Stint 43 status enum v3. The Excel parser still has to accept text
// from Diego's old spreadsheets that mention the deprecated states
// ("blocked", "waived", "assessment received") — we just remap to the
// nearest valid v3 status when we see them.
export type FilingStatus =
  | 'info_to_request' | 'info_requested' | 'working'
  | 'awaiting_client_clarification' | 'draft_sent'
  | 'partially_approved' | 'client_approved' | 'filed';

export interface ParsedStatus {
  status: FilingStatus;
  filed_at?: string;              // ISO date if "Filed on …"
  draft_sent_at?: string;
  residual_comment?: string;      // anything we couldn't classify, kept for the user
}

// Parse a free-text status/comment cell into a normalized filing state.
// Robust to DD.MM.YYYY, DD/MM/YYYY, DD-MM-YYYY and whitespace noise.
export function parseStatusCell(raw: string | null | undefined): ParsedStatus {
  if (!raw || typeof raw !== 'string') return { status: 'info_to_request' };
  const text = raw.trim();
  if (!text) return { status: 'info_to_request' };

  const dateRe = /(\d{1,2})[./-](\d{1,2})[./-](\d{4})/;

  const lower = text.toLowerCase();

  // Filed
  const filedMatch = text.match(/^filed\s+on\s+(.+)/i);
  if (filedMatch) {
    const d = dateRe.exec(filedMatch[1]!);
    if (d) return { status: 'filed', filed_at: toIsoDate(d[1]!, d[2]!, d[3]!) };
    return { status: 'filed', residual_comment: filedMatch[1] };
  }

  // Draft sent
  const draftMatch = text.match(/^(?:draft|borrador)\s+sent\s+on\s+(.+)/i);
  if (draftMatch) {
    const d = dateRe.exec(draftMatch[1]!);
    if (d) return { status: 'draft_sent', draft_sent_at: toIsoDate(d[1]!, d[2]!, d[3]!) };
    return { status: 'draft_sent', residual_comment: draftMatch[1] };
  }

  // Waiting for client approval of a draft → maps to draft_sent
  // (Diego will move to partially_approved / client_approved manually
  // once specific approver signals come in.)
  if (/^waiting\s+for\s+.*(approval|confirmation|sign)/i.test(text)) {
    return { status: 'draft_sent', residual_comment: text };
  }
  // Generic "waiting for X" → keep as info_to_request with the comment;
  // Diego decides if it's working / awaiting_clarification on review.
  if (/^waiting\s+for/i.test(text)) {
    return { status: 'info_to_request', residual_comment: text };
  }

  // Requested info / financials requested → v4: we KNOW it was already
  // asked, so map to info_requested (= "asked, waiting"), not
  // info_to_request (= "still need to ask"). Stint 49.A.
  if (/^(financials\s+)?requested\s+on/i.test(text)) {
    return { status: 'info_requested', residual_comment: text };
  }
  if (/requested/i.test(lower) && /info|financials|document/i.test(lower)) {
    return { status: 'info_requested', residual_comment: text };
  }
  // "Asked X" / "Awaiting info" / "Chasing X" — same bucket.
  if (/^(asked|awaiting\s+info|chasing|chased)/i.test(text)) {
    return { status: 'info_requested', residual_comment: text };
  }

  // Tax assessment received → in v3 we treat this as filed; the date
  // lives separately in tax_assessment_received_at.
  if (/assessment\s+received/i.test(text) || /^yes$/i.test(text)) {
    return { status: 'filed', residual_comment: text === 'Yes' ? undefined : text };
  }

  // Accepted / approved → client_approved (closer to the new semantic)
  if (/^accepted$/i.test(text) || /^approved$/i.test(text)) {
    return { status: 'client_approved', residual_comment: text };
  }

  // Cancelled / not applicable / waived → in v3 we treat as filed
  // (the obligation is closed; Diego marks the obligation inactive
  // separately if the entity is being de-registered).
  if (/^(cancelled|n\/a|na|not applicable|waived|skip)$/i.test(text)) {
    return { status: 'filed', residual_comment: text };
  }

  // Default: treat as "working" and keep the text as a comment. Safer
  // than guessing — user sees exactly what was in the Excel.
  return { status: 'working', residual_comment: text };
}

// DD + MM + YYYY → "YYYY-MM-DD" with padding.
function toIsoDate(dd: string, mm: string, yyyy: string): string {
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

// Normalize legal name for dedup. "Acme SARL" / "Acme  SARL" / "acme sarl" → same key.
export function normalizeLegalName(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/[\u00a0]/g, ' ')                 // non-breaking spaces
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Parse Excel "Periodicity" free text into a period_pattern enum.
// Examples seen in the files:
//   "Annual"                      → annual
//   "Annually"                    → annual
//   "Annual - 2025"               → annual
//   "Simplified annual"           → annual (mapped separately at tax_type)
//   "Annual (2025) + quarterly"   → annual + quarterly (split caller-side)
//   "Quarterly"                   → quarterly
//   "Monthly"                     → monthly
//   "Monthly - Starting 2026"     → monthly
//   "Semester"                    → semester
export function parsePeriodicity(raw: string | null | undefined): string[] {
  if (!raw) return ['annual'];
  const text = raw.toLowerCase();
  const out: string[] = [];
  if (/\bannual(?:ly)?\b/.test(text) || /\bsimplified\s+annual\b/.test(text)) out.push('annual');
  if (/\bquarterly\b/.test(text)) out.push('quarterly');
  if (/\bmonthly\b/.test(text)) out.push('monthly');
  if (/\bsemester|\bsemestral/i.test(text)) out.push('semester');
  return out.length === 0 ? ['annual'] : out;
}

// "Gab", "Gab/Andrew", "Gab + Andrew" → ["Gab", "Andrew"]
export function parsePreparedWith(raw: string | null | undefined): string[] {
  if (!raw || typeof raw !== 'string') return [];
  return raw
    .split(/[\/+,&]/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

// Generate a short stable id from a label. Used when we need
// deterministic ids during dry-run so the same Excel always produces
// the same id preview.
export function makeStableId(prefix: string, label: string): string {
  let hash = 0;
  for (let i = 0; i < label.length; i += 1) {
    hash = (hash * 31 + label.charCodeAt(i)) & 0x7fffffff;
  }
  return `${prefix}_${hash.toString(36)}`;
}
