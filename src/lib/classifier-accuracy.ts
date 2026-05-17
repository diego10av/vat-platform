// ════════════════════════════════════════════════════════════════════════
// classifier-accuracy.ts
//
// Runs the entire synthetic-corpus fixture set through the classifier
// and returns a structured pass/fail report. Used by:
//
//   - GET /api/metrics/classifier — exposes the report as JSON to the
//                                   /settings/classifier dashboard
//   - (future) a CI step that fails the build if accuracy drops
//
// Why a runtime endpoint (not "run at build, bake the number"):
//
//   1. When Anthropic ships a new model and we swap to it, the fixture
//      pass/fail can shift — we want to see the shift live from the
//      dashboard, not wait for the next deploy.
//   2. The classifier is pure logic; running 60 fixtures is ~20-50ms.
//      Cheaper to execute on demand than to maintain a baked artifact.
//
// Output shape:
//   {
//     total: 60, passed: 60, failed: 0, accuracy: 1.0,
//     duration_ms: 23,
//     rules_exercised: [ 'RULE 1', 'RULE 2', ... ],  // deduped
//     rules_missing:  [ 'RULE 8B' ],                   // in code but no fixture
//     failures: [ { id, title, expected, got, legal_ref } ],
//     generated_at: '2026-04-19T...',
//     version: { commit: 'f0135ee', ts: '...' },
//   }
// ════════════════════════════════════════════════════════════════════════

import { FIXTURES, type InvoiceFixture } from '@/__tests__/fixtures/synthetic-corpus';
import { classifyInvoiceLine, type EntityContext } from '@/config/classification-rules';

export interface ClassifierReport {
  total: number;
  passed: number;
  failed: number;
  /** passed / total, in [0, 1]. */
  accuracy: number;
  duration_ms: number;
  /** Sorted list of RULE ids exercised by at least one fixture. */
  rules_exercised: string[];
  /** Archetypes seen in fixture titles, counted. */
  archetypes: Array<{ archetype: string; count: number; passed: number }>;
  /** Every failed fixture, with diff context for drill-down. */
  failures: Array<{
    id: string;
    title: string;
    /** `null` when the fixture expects "no match" (classifier should
     *  return null) — happens for edge cases we deliberately do not
     *  classify. */
    expected_treatment: string | null;
    got_treatment: string | null;
    expected_rule: string;
    got_rule: string;
    legal_ref?: string;
  }>;
  generated_at: string;
  /** Current commit SHA if Vercel exposes it. */
  version: {
    commit: string | null;
    env: string;
  };
}

export function runClassifierAccuracy(): ClassifierReport {
  const started = Date.now();

  const passed: InvoiceFixture[] = [];
  const failures: ClassifierReport['failures'] = [];
  const rulesSeen = new Set<string>();
  const archetypeCounts = new Map<string, { count: number; passed: number }>();

  for (const fixture of FIXTURES) {
    let treatmentOk = false;
    let ruleOk = false;
    const got: { treatment: string | null; rule: string } = { treatment: null, rule: '—' };

    try {
      const res = classifyInvoiceLine(fixture.input, fixture.context as EntityContext);
      got.treatment = res.treatment ?? null;
      got.rule = res.rule;
      treatmentOk = res.treatment === fixture.expected.treatment;
      ruleOk = res.rule === fixture.expected.rule;
      rulesSeen.add(res.rule);
    } catch { /* treated as failure below */ }

    const archetype = guessArchetype(fixture.title);
    const bucket = archetypeCounts.get(archetype) ?? { count: 0, passed: 0 };
    bucket.count += 1;

    if (treatmentOk && ruleOk) {
      passed.push(fixture);
      bucket.passed += 1;
    } else {
      failures.push({
        id: fixture.id,
        title: fixture.title,
        expected_treatment: fixture.expected.treatment,
        got_treatment: got.treatment,
        expected_rule: fixture.expected.rule,
        got_rule: got.rule,
        legal_ref: fixture.legal_ref,
      });
    }

    archetypeCounts.set(archetype, bucket);
  }

  const total = FIXTURES.length;
  const duration_ms = Date.now() - started;

  const archetypes = Array.from(archetypeCounts.entries())
    .map(([archetype, v]) => ({ archetype, count: v.count, passed: v.passed }))
    .sort((a, b) => b.count - a.count);

  return {
    total,
    passed: passed.length,
    failed: failures.length,
    accuracy: total === 0 ? 1 : passed.length / total,
    duration_ms,
    rules_exercised: Array.from(rulesSeen).sort(),
    archetypes,
    failures,
    generated_at: new Date().toISOString(),
    version: {
      commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
      env: process.env.VERCEL_ENV || process.env.NODE_ENV || 'unknown',
    },
  };
}

// ────────────────────────── helpers ──────────────────────────

/**
 * Best-effort archetype extraction from the fixture title. Maps
 * "Notary — mixed 17% + 0% débours" → "Notary". Falls back to
 * "Other" if no em-dash is present. Kept loose on purpose — the
 * corpus comment documents the canonical archetypes.
 */
function guessArchetype(title: string): string {
  const dashIdx = title.indexOf(' — ');
  if (dashIdx === -1) return 'Other';
  return title.slice(0, dashIdx).trim();
}
