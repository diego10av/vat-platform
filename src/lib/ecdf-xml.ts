// eCDF XML generator for AED upload (PRD §11, Phase 4).
//
// IMPORTANT — schema disclaimer:
// The official eCDF XML schema (XSD) for VAT returns is published by the AED
// and changes over time. This implementation produces an XML document with the
// canonical AED structure (eCDF root, FormData, Form with FormType, NumericField
// per box) that a Luxembourg tax professional can open, review, and adjust if
// needed before manual upload to https://ecdf.b2g.etat.lu via LuxTrust.
//
// The user must visually verify the produced XML matches the form they intend
// to file (TVA001N for simplified annual, TVA002N for ordinary monthly, etc.)
// before uploading. The platform does not file directly — manual upload only.

import { computeECDF } from '@/lib/ecdf';
import { queryOne } from '@/lib/db';

// AED form code mapping. These codes are the platform's best mapping from
// (regime, frequency) to the AED form identifier; verify against the actual
// AED form before upload.
function getFormCode(regime: 'simplified' | 'ordinary', period: string): string {
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
  push(`<eCDFDeclarations xmlns="http://www.ctie.etat.lu/2011/ecdf">`);
  push(`  <eCDFDeclaration>`);
  push(`    <Sender>`);
  push(`      <SenderType>tax_professional</SenderType>`);
  push(`      <Matricule>${esc(decl.matricule)}</Matricule>`);
  push(`    </Sender>`);
  push(`    <DeclarationData>`);
  push(`      <Form>`);
  push(`        <FormType>${esc(formCode)}</FormType>`);
  push(`        <FormVersion>1.0</FormVersion>`);
  push(`        <Period>${esc(periodCode)}</Period>`);
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
    push(`          <NumericField id="${esc(b.box)}" section="${esc(b.section)}">${b.value.toFixed(2)}</NumericField>`);
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

function periodToECDF(period: string, year: number): string {
  const p = (period || '').toUpperCase();
  if (p === 'Y1') return `${year}`;
  if (/^Q[1-4]$/.test(p)) return `${year}-${p}`;
  if (/^\d{1,2}$/.test(p)) return `${year}-${p.padStart(2, '0')}`;
  return `${year}-${p}`;
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
