// Option D — runs every fixture through the classifier and asserts the
// expected treatment + rule. Also asserts basic coverage: every RULE
// the codebase documents is exercised by at least one fixture (catches
// the "added a rule, forgot to add a fixture" drift).
//
// Each fixture gets its own test via `it.each`, so a failure in the
// report shows the fixture id, title, legal_ref, and the exact diff.

import { describe, it, expect } from 'vitest';
import { classifyInvoiceLine, type EntityContext } from '@/config/classification-rules';
import { FIXTURES, type InvoiceFixture } from './fixtures/synthetic-corpus';

function run(fixture: InvoiceFixture) {
  return classifyInvoiceLine(fixture.input, fixture.context as EntityContext);
}

describe('Synthetic corpus — classifier regression benchmark', () => {
  it.each(FIXTURES.map(f => ({ fixture: f, id: f.id, title: f.title })))(
    '$id — $title',
    ({ fixture }) => {
      const r = run(fixture);

      expect(r.treatment, `${fixture.id}: wrong treatment`).toBe(fixture.expected.treatment);
      expect(r.rule, `${fixture.id}: wrong rule`).toBe(fixture.expected.rule);

      if (fixture.expected.source !== undefined) {
        expect(r.source, `${fixture.id}: wrong source`).toBe(fixture.expected.source);
      }
      if (fixture.expected.flag !== undefined) {
        expect(r.flag, `${fixture.id}: wrong flag`).toBe(fixture.expected.flag);
      }
      if (fixture.expected.flag_includes) {
        expect(
          (r.flag_reason || '').toLowerCase(),
          `${fixture.id}: flag_reason does not include "${fixture.expected.flag_includes}"`,
        ).toContain(fixture.expected.flag_includes.toLowerCase());
      }
      if (fixture.expected.reason_includes) {
        expect(
          (r.reason || '').toLowerCase(),
          `${fixture.id}: reason does not include "${fixture.expected.reason_includes}"`,
        ).toContain(fixture.expected.reason_includes.toLowerCase());
      }
    },
  );
});

describe('Synthetic corpus — coverage sanity', () => {
  it('no fixture ids collide', () => {
    const ids = FIXTURES.map(f => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every fixture carries a legal_ref citation', () => {
    for (const f of FIXTURES) {
      expect(f.legal_ref, `${f.id} missing legal_ref`).toBeTruthy();
    }
  });

  it('every CRITICAL rule (the ones fixed in Options E/B) is exercised', () => {
    // A subset of RULES whose correctness has direct Treasury impact —
    // each MUST have at least one fixture to prevent silent regression.
    const CRITICAL_RULES = [
      'RULE 1', 'RULE 2', 'RULE 3', 'RULE 4',           // LU rates
      'RULE 5', 'RULE 5C', 'RULE 5D',                   // real-estate + carve-outs + domiciliation
      'RULE 6', 'RULE 7', 'RULE 8', 'RULE 23',          // out-of-scope + exemption + default + franchise
      'RULE 7A', 'RULE 7B', 'RULE 7D',                  // Art 44 sub-paragraphs
      'RULE 9', 'RULE 17', 'RULE 17X',                  // IC acquisitions
      'RULE 10', 'RULE 10X',                            // RC EU exempt + BlackRock gate
      'RULE 11', 'RULE 11C', 'RULE 11D', 'RULE 11P',   // EU RC + rate splits + passive gate
      'RULE 12',                                        // RC non-EU exempt
      'RULE 13', 'RULE 13D', 'RULE 13P',                // Non-EU RC + rate splits + passive gate
      'RULE 14', 'RULE 15', 'RULE 15A', 'RULE 15B',     // Outgoing
      'RULE 18', 'RULE 18X',                            // Non-EU customer with/without VAT-ID
      'RULE 19',                                        // Import VAT flag-only
      'RULE 16',                                        // Disbursement
      'RULE 20', 'RULE 22', 'RULE 24', 'RULE 25',       // VAT group, platform, margin, construction
      'RULE 26', 'RULE 27', 'RULE 29', 'RULE 31',       // Scrap, bad-debt, non-deductible, autoliv
      'INFERENCE A', 'INFERENCE D', 'INFERENCE E',      // Inference chain
    ];
    const exercisedRules = new Set(FIXTURES.map(f => f.expected.rule));
    const missing = CRITICAL_RULES.filter(r => !exercisedRules.has(r));
    expect(missing, `Critical rules with no fixture coverage: ${missing.join(', ')}`).toEqual([]);
  });

  it('at least 50 fixtures (Option D deliverable)', () => {
    expect(FIXTURES.length).toBeGreaterThanOrEqual(50);
  });
});
