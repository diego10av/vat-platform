// Unit tests for the eCDF box-mapping configuration. These do NOT call the
// database — they only assert that every treatment code routes to at least
// one declared box, and that the box filters are internally consistent.
//
// Catching these kinds of drifts at build time prevents silent corruption
// of the VAT return when a new treatment is added and its eCDF mapping is
// forgotten.

import { describe, it, expect } from 'vitest';
import { SIMPLIFIED_BOXES, ORDINARY_ADDITIONAL_BOXES } from '@/config/ecdf-boxes';
import {
  INCOMING_TREATMENTS,
  OUTGOING_TREATMENTS,
  TREATMENT_CODES,
} from '@/config/treatment-codes';

const ALL_BOXES = [...SIMPLIFIED_BOXES, ...ORDINARY_ADDITIONAL_BOXES];

// Treatments that intentionally have no box mapping because they signal
// "out of scope of the LU VAT return" / "needs manual handling". These
// still show up in the UI dropdown but their amounts do not flow into any
// eCDF line — the reviewer acknowledges this by picking the code.
const INTENTIONALLY_UNMAPPED = new Set<string>([
  'LUX_00',           // legacy generic no-VAT, by design
  'OUT_SCOPE',        // generic out-of-scope
  'DEBOURS',          // disbursements are pass-through
  'VAT_GROUP_OUT',    // supplies within VAT group
  'EXEMPT_44B_RE',    // informational; no specific box on TVA001N
]);

describe('eCDF box mapping — coverage of every treatment code', () => {
  const mappedTreatments = new Set<string>();
  for (const def of ALL_BOXES) {
    for (const t of def.filter?.treatments ?? []) mappedTreatments.add(t);
  }

  for (const t of [...INCOMING_TREATMENTS, ...OUTGOING_TREATMENTS]) {
    if (INTENTIONALLY_UNMAPPED.has(t)) continue;
    it(`${t} routes to at least one eCDF box`, () => {
      expect(mappedTreatments.has(t)).toBe(true);
    });
  }
});

describe('eCDF box mapping — shape checks', () => {
  it('every formula box references only 3-digit ids, operators, numbers, or MAX(..)', () => {
    for (const def of ALL_BOXES) {
      if (def.computation !== 'formula' || !def.formula) continue;
      // After stripping box refs, MAX(), and allowed arithmetic, nothing
      // else should remain — specifically no column names or identifiers.
      const stripped = def.formula
        .replace(/\b\d{3}\b/g, '0')
        .replace(/MAX\s*\(/g, '(')
        .replace(/[\s+\-*/().,0-9]/g, '');
      expect(
        stripped,
        `Box ${def.box} has stray characters in its formula: "${def.formula}"`,
      ).toBe('');
    }
  });

  it('every sum-box filter.treatments references known codes', () => {
    const known = new Set(Object.keys(TREATMENT_CODES));
    for (const def of ALL_BOXES) {
      if (def.computation !== 'sum' || !def.filter?.treatments) continue;
      for (const t of def.filter.treatments) {
        expect(known.has(t), `Box ${def.box} references unknown treatment "${t}"`).toBe(true);
      }
    }
  });

  it('no duplicate box ids', () => {
    const ids = ALL_BOXES.map(b => b.box);
    const set = new Set(ids);
    expect(set.size).toBe(ids.length);
  });

  it('Box 409 (total RC taxable base) sums only the TAXABLE bases, not the exempt ones', () => {
    const box409 = ALL_BOXES.find(b => b.box === '409');
    expect(box409?.formula).toBe('436 + 463');
    // Belt-and-braces: 435 (RC EU exempt) and 445 (RC non-EU exempt) must
    // NOT appear in the taxable-base total — that was the bug fixed in
    // Batch 2.
    expect(box409?.formula).not.toContain('435');
    expect(box409?.formula).not.toContain('445');
  });

  it('Box 085 has an explicit LU-taxable treatments filter', () => {
    const box085 = ALL_BOXES.find(b => b.box === '085');
    expect(box085?.filter?.treatments).toEqual(
      expect.arrayContaining(['LUX_17', 'LUX_14', 'LUX_08', 'LUX_03']),
    );
    // Must NOT include LUX_00 — that would add exempt lines into the
    // input-VAT invoiced total.
    expect(box085?.filter?.treatments).not.toContain('LUX_00');
  });
});
