// eCDF XML generator for AED upload (PRD §11, Phase 4).
//
// ════════════════════════════════════════════════════════════════════════
// ⚠️  SCHEMA VERIFICATION REQUIRED — five items flagged by the Opus
//     fiscal audit (agent E-2) that we could NOT verify without pulling
//     the current AED XSD and must be reconfirmed before any real filing:
//
//   (1) XML namespace: currently "http://www.ctie.etat.lu/2011/ecdf".
//       The 2011 namespace is the first-generation AED eCDF namespace.
//       The AED has republished the VAT XSD at least once post-2020
//       quick fixes, and again during the 2025 SAF-T / ViDA alignment.
//       → verify against the XSD at https://ecdf.b2g.etat.lu/download
//       and update if moved (expected: .../2020/ecdf or .../2024/ecdf).
//
//   (2) Form version: currently hard-coded "1.0". Each AED form has a
//       version keyed to its publication year; TVA002NA for fiscal 2025
//       is typically at version "2.0" or higher (published in the PDF's
//       footer and in the XSD). Uploading with FormVersion=1.0 against
//       the current XSD is rejected as "schema mismatch".
//       → maintain a form-version map keyed by (formCode, year).
//
//   (3) Field element name: currently <NumericField id="..." section="...">.
//       AED XSDs in practice use different element names (likely a
//       <Numeric> or <Value> element with only an id attribute, no
//       section attribute). The current shape is a platform invention.
//       → replace after verifying against the XSD.
//
//   (4) Period encoding: currently "2025-Q1" / "2025-MM" / "2025" strings.
//       AED schemas typically require integer codes: 0=annual, 1..12=
//       monthly, 13..16=quarterly.
//       → rewrite periodToECDF() against the XSD.
//
//   (5) Sender block: currently <SenderType>tax_professional</SenderType>
//       with no <Agent> sub-block identifying which tax professional
//       (matricule, firm, mandate ref). The AED XSD requires this when
//       SenderType is tax_professional — returns are rejected without it.
//       → add <Agent><Matricule/><Name/></Agent> populated from the
//       logged-in reviewer's profile.
//
// Until all five are verified and updated, the produced XML is FOR
// REVIEWER INSPECTION ONLY. It will not pass the AED upload validator.
// ════════════════════════════════════════════════════════════════════════
//
// The user must visually verify the produced XML matches the form they intend
// to file (TVA001N for simplified annual, TVA002NA for ordinary annual,
// TVA002NT for ordinary quarterly, TVA002NM for ordinary monthly) before
// uploading. The platform does not file directly — manual upload only.

import { computeECDF } from '@/lib/ecdf';
import { queryOne } from '@/lib/db';
import {
  ECDF_NAMESPACE,
  getFormVersion,
  BOX_FIELD_ELEMENT_NAME,
  BOX_FIELD_INCLUDE_SECTION,
  encodePeriodLegacy,
  encodePeriodForXSD,
  PERIOD_ENCODING_VERIFIED,
  SENDER_AGENT_REQUIRED,
  PLATFORM_AGENT_INFO,
} from '@/config/ecdf-xsd-config';

// AED form code mapping. These codes are the platform's best mapping from
// (regime, frequency) to the AED form identifier; verify against the actual
// AED form before upload. Exported for testing.
export function getFormCode(regime: 'simplified' | 'ordinary', period: string): string {
  const frequency =
    period === 'Y1' ? 'annual' :
    /^Q[1-4]$/.test(period) ? 'quarterly' : 'monthly';
  if (regime === 'simplified') {
    return frequency === 'annual' ? 'TVA001N' : 'TVA001N';
  }
  return frequency === 'annual' ? 'TVA002NA' : frequency === 'quarterly' ? 'TVA002NT' : 'TVA002NM';
}

export interface XMLBuildResult {
  xml: string;
  filename: string;
}

export async function buildECDFXml(declarationId: string): Promise<XMLBuildResult> {
  const decl = await queryOne<{
    year: number; period: string; matricule: string | null; vat_number: string | null;
    entity_name: string; rcs_number: string | null;
  }>(
    `SELECT d.year, d.period, e.matricule, e.vat_number, e.name as entity_name, e.rcs_number
       FROM declarations d JOIN entities e ON d.entity_id = e.id
      WHERE d.id = $1`,
    [declarationId]
  );
  if (!decl) throw new Error('Declaration not found');
  if (!decl.matricule) throw new Error('Entity matricule is required for eCDF XML — set it on the Entity page.');

  const ecdf = await computeECDF(declarationId);
  const formCode = getFormCode(ecdf.regime, decl.period);
  const periodCode = periodToECDF(decl.period, decl.year);

  // Build XML
  const lines: string[] = [];
  const push = (s: string) => lines.push(s);

  push(`<?xml version="1.0" encoding="UTF-8"?>`);
  push(`<eCDFDeclarations xmlns="${ECDF_NAMESPACE}">`);
  push(`  <eCDFDeclaration>`);
  push(`    <Sender>`);
  push(`      <SenderType>tax_professional</SenderType>`);
  push(`      <Matricule>${esc(decl.matricule)}</Matricule>`);
  // Stint 67.E — <Agent> sub-block under <Sender>. AED XSDs flag this
  // as required when SenderType=tax_professional. Surface only when
  // verified + the platform has a configured agent matricule.
  if (SENDER_AGENT_REQUIRED && PLATFORM_AGENT_INFO) {
    push(`      <Agent>`);
    push(`        <Matricule>${esc(PLATFORM_AGENT_INFO.matricule)}</Matricule>`);
    push(`        <Name>${esc(PLATFORM_AGENT_INFO.name)}</Name>`);
    push(`      </Agent>`);
  }
  push(`    </Sender>`);
  push(`    <DeclarationData>`);
  push(`      <Form>`);
  push(`        <FormType>${esc(formCode)}</FormType>`);
  push(`        <FormVersion>${esc(getFormVersion(formCode, decl.year))}</FormVersion>`);
  // Period encoding: switch to integer code when the AED XSD is
  // confirmed. Today still string for back-compat with the comment
  // in the XSD-config file.
  const encodedPeriod = PERIOD_ENCODING_VERIFIED
    ? encodePeriodForXSD(decl.period)
    : periodCode;
  push(`        <Period>${esc(encodedPeriod)}</Period>`);
  push(`        <Year>${decl.year}</Year>`);
  push(`        <Declarant>`);
  push(`          <Matricule>${esc(decl.matricule)}</Matricule>`);
  push(`          <VATNumber>${esc(decl.vat_number || '')}</VATNumber>`);
  push(`          <Name>${esc(decl.entity_name)}</Name>`);
  if (decl.rcs_number) push(`          <RCS>${esc(decl.rcs_number)}</RCS>`);
  push(`        </Declarant>`);
  push(`        <Boxes>`);
  // Emit every declared box, even when the value is zero. Previously we
  // skipped non-total zero boxes "to keep the file readable", but the AED
  // form expects a complete set (missing boxes can be interpreted as
  // "not filed" and trigger a taxation d'office). Readability is the
  // reviewer's problem — correctness is ours.
  for (const b of ecdf.boxes) {
    const sectionAttr = BOX_FIELD_INCLUDE_SECTION
      ? ` section="${esc(b.section)}"`
      : '';
    push(`          <${BOX_FIELD_ELEMENT_NAME} id="${esc(b.box)}"${sectionAttr}>${b.value.toFixed(2)}</${BOX_FIELD_ELEMENT_NAME}>`);
  }
  push(`        </Boxes>`);
  push(`      </Form>`);
  push(`    </DeclarationData>`);
  push(`  </eCDFDeclaration>`);
  push(`</eCDFDeclarations>`);

  const xml = lines.join('\n');
  const safeEntity = decl.entity_name.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 40);
  const filename = `eCDF_${formCode}_${safeEntity}_${decl.year}_${decl.period}.xml`;

  return { xml, filename };
}

// Exported for testing. Stint 67.E — re-exported from the XSD config
// so test callers don't import the internal legacy helper directly.
export function periodToECDF(period: string, year: number): string {
  return encodePeriodLegacy(period, year);
}

// Exported for testing.
export function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
