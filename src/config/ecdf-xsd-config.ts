// ════════════════════════════════════════════════════════════════════════
// eCDF XSD-coupled configuration
//
// Stint 67.E (2026-05-05) — extracted every constant in
// src/lib/ecdf-xml.ts that depends on the AED's published XSD into
// this single file so updating it after a CIGUE-developer XSD pull
// is a one-place edit instead of hunting through builder code.
//
// The 5 items flagged in src/lib/ecdf-xml.ts header (since stint 11)
// each map to one constant below. None are verified against the
// current AED schema yet — we cannot fetch it without a registered
// developer login (see docs/ECDF_XSD_RECONCILIATION.md). Until
// reconciliation, the OutputsPanel banner warns reviewers not to
// upload the produced XML to MyGuichet without manual validation.
//
// When you obtain the XSD:
//   1. Update ECDF_NAMESPACE if the URI moved (expect 2020 or 2024).
//   2. Update ECDF_FORM_VERSIONS map for any per-(form, year) entry
//      that disagrees with the schema's <xs:attribute name="version">
//      enumeration.
//   3. Confirm BOX_FIELD_ELEMENT_NAME — the XSD's element wrapping
//      each box value. Likely <Numeric> or <Value>, almost certainly
//      not the platform-invented <NumericField>.
//   4. Confirm BOX_FIELD_INCLUDE_SECTION — XSDs typically don't
//      attach a section attribute to box elements (sectioning is by
//      structure not metadata).
//   5. Confirm encodePeriod() returns whatever the schema's
//      <Period> element accepts: many AED schemas use integer codes
//      (0 = annual, 1..12 = monthly, 13..16 = quarterly) rather
//      than string forms like "2025-Q1".
//   6. Confirm SENDER_AGENT_REQUIRED + the Agent sub-fields. AED
//      schemas typically require <Agent><Matricule/><Name/></Agent>
//      under <Sender> when SenderType = "tax_professional".
// ════════════════════════════════════════════════════════════════════════

// ─── (1) XML namespace ──────────────────────────────────────────────────
// The 2011 namespace was the first-generation AED eCDF URL. The AED
// republished the VAT XSD in the 2020 quick-fixes wave and again with
// the 2025 SAF-T / ViDA alignment. Two likely successors:
//   "http://www.ctie.etat.lu/2020/ecdf"
//   "http://www.ctie.etat.lu/2024/ecdf"
// Until verified, we keep the 2011 string AND emit a banner.
export const ECDF_NAMESPACE = 'http://www.ctie.etat.lu/2011/ecdf';
export const ECDF_NAMESPACE_VERIFIED = false;

// ─── (2) Form version ───────────────────────────────────────────────────
// The AED form version is stamped in the form PDF footer + the XSD's
// `<xs:attribute name="version">` enumeration. Each form code carries
// its own version per fiscal year. Until we have the XSD this map is
// a best-guess; the platform falls back to "1.0" when a (form, year)
// pair isn't listed. The reviewer is warned via banner.
export const ECDF_FORM_VERSIONS: Record<string, string> = {
  // Examples of expected shapes once we have the XSD; the actual values
  // are unknown today. Format key: `${formCode}_${year}`.
  // 'TVA002NA_2025': '2.0',
  // 'TVA002NT_2025': '2.0',
  // 'TVA002NM_2025': '2.0',
  // 'TVA001N_2025':  '1.5',
};
export const ECDF_FORM_VERSION_FALLBACK = '1.0';
export const ECDF_FORM_VERSIONS_VERIFIED = false;

export function getFormVersion(formCode: string, year: number): string {
  return ECDF_FORM_VERSIONS[`${formCode}_${year}`] ?? ECDF_FORM_VERSION_FALLBACK;
}

// ─── (3) Box element shape ─────────────────────────────────────────────
// Currently emits <NumericField id="012" section="A">123.45</NumericField>.
// XSDs in practice use a different shape — likely:
//   <Numeric id="012">123.45</Numeric>
// or
//   <Value id="012">123.45</Value>
// without a section attribute. Once verified, flip these constants.
export const BOX_FIELD_ELEMENT_NAME = 'NumericField';
export const BOX_FIELD_INCLUDE_SECTION = true;
export const BOX_FIELD_VERIFIED = false;

// ─── (4) Period encoding ───────────────────────────────────────────────
// Today's encoder returns "2025" / "2025-Q1" / "2025-MM" strings. AED
// schemas typically expect integer codes:
//    0     = annual
//    1..12 = monthly
//   13..16 = quarterly (Q1=13, Q2=14, Q3=15, Q4=16)
// `encodePeriodForXSD` is what the XSD wants once verified;
// `encodePeriodLegacy` is what we currently emit. Toggle when XSD known.
export const PERIOD_ENCODING_VERIFIED = false;

export function encodePeriodLegacy(period: string, year: number): string {
  const p = (period || '').toUpperCase();
  if (p === 'Y1') return `${year}`;
  if (/^Q[1-4]$/.test(p)) return `${year}-${p}`;
  if (/^\d{1,2}$/.test(p)) return `${year}-${p.padStart(2, '0')}`;
  return `${year}-${p}`;
}

export function encodePeriodForXSD(period: string): string {
  const p = (period || '').toUpperCase();
  if (p === 'Y1') return '0';
  const qm = /^Q([1-4])$/.exec(p);
  if (qm) return String(12 + Number(qm[1])); // Q1→13 … Q4→16
  const mm = /^\d{1,2}$/.exec(p);
  if (mm) return String(Math.min(12, Math.max(1, Number(p))));
  return p;
}

// ─── (5) Agent block ───────────────────────────────────────────────────
// AED XSDs typically require <Agent><Matricule/><Name/></Agent> nested
// inside <Sender> when SenderType="tax_professional". cifra is the agent;
// we pass the firm's matricule + display name when it is known.
export const SENDER_AGENT_REQUIRED = false; // flip to true when verified
export interface AgentInfo {
  matricule: string;
  name: string;
}
// The platform doesn't yet collect the firm's own AED matricule. Once
// the XSD requires it, surface a Settings field for it and pass it in.
export const PLATFORM_AGENT_INFO: AgentInfo | null = null;
