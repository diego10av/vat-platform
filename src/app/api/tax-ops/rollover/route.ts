import { NextRequest, NextResponse } from 'next/server';
import { query, tx, qTx, generateId, logAuditTx } from '@/lib/db';
import { computeDeadline, type DeadlineRule } from '@/lib/tax-ops-deadlines';

// ════════════════════════════════════════════════════════════════════════
// POST /api/tax-ops/rollover?mode=preview|commit&year=2027
//
// Preview: returns { year, filings_to_create: N,
//                    by_tax_type: {cit_annual: N, vat_annual: N, …},
//                    entities_skipped_inactive: N,
//                    obligations_skipped_no_rule: N }
// Commit:  runs the actual inserts in a single transaction.
//          Idempotent (ON CONFLICT DO NOTHING) — if some filings
//          for that year already exist, they're left untouched.
//
// Rules:
//   - Only active entities × active obligations roll forward.
//   - Each obligation produces the right number of filings for the
//     year according to its period_pattern:
//       annual     → 1 row ("YYYY")
//       quarterly  → 4 rows ("YYYY-Q1" … "YYYY-Q4")
//       monthly    → 12 rows ("YYYY-01" … "YYYY-12")
//       semester   → 2 rows ("YYYY-S1", "YYYY-S2")
//       adhoc      → skipped (manual creation only)
//   - Deadline auto-computed from tax_deadline_rules.
//   - Status defaults to info_to_request (we still have to ask the CSP).
// ════════════════════════════════════════════════════════════════════════

const MODE_PREVIEW = 'preview';
const MODE_COMMIT = 'commit';

interface ObligationForRollover {
  id: string;
  entity_id: string;
  entity_name: string;
  tax_type: string;
  period_pattern: string;
}

function periodLabelsFor(pattern: string, year: number): string[] {
  if (pattern === 'annual') return [String(year)];
  if (pattern === 'quarterly') return ['Q1', 'Q2', 'Q3', 'Q4'].map(q => `${year}-${q}`);
  if (pattern === 'monthly') {
    return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  }
  if (pattern === 'semester') return [`${year}-S1`, `${year}-S2`];
  return [];  // adhoc → skipped
}

export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const mode = url.searchParams.get('mode') === MODE_COMMIT ? MODE_COMMIT : MODE_PREVIEW;
  const year = Number(url.searchParams.get('year'));
  if (!Number.isFinite(year) || year < 2020 || year > 2100) {
    return NextResponse.json({ error: 'invalid_year' }, { status: 400 });
  }

  // 1. Fetch active obligations on entities that haven't been
  //    liquidated before the target year. Liquidated-this-year
  //    entities are excluded from rollover into NEXT year by not
  //    matching this predicate (liquidation_date < start of next
  //    year implies they shouldn't get new filings). Stint 40.H.
  const obligations = await query<ObligationForRollover>(
    `SELECT o.id, o.entity_id, e.legal_name AS entity_name,
            o.tax_type, o.period_pattern
       FROM tax_obligations o
       JOIN tax_entities e ON e.id = o.entity_id
      WHERE o.is_active = TRUE
        AND (e.is_active = TRUE
             OR (e.liquidation_date IS NOT NULL AND e.liquidation_date >= make_date($1::int, 1, 1)))
      ORDER BY e.legal_name, o.tax_type`,
    [year],
  );

  // 2. Load deadline rules
  const ruleRows = await query<DeadlineRule>(
    `SELECT tax_type, period_pattern, rule_kind, rule_params, admin_tolerance_days
       FROM tax_deadline_rules`,
  );
  const ruleByKey = new Map<string, DeadlineRule>();
  for (const r of ruleRows) ruleByKey.set(`${r.tax_type}|${r.period_pattern}`, r);

  // 3. Compute the to-create set (idempotent — skip (obligation_id, period_label)
  //    pairs that already exist).
  const existing = await query<{ obligation_id: string; period_label: string }>(
    `SELECT obligation_id, period_label
       FROM tax_filings WHERE period_year = $1`,
    [year],
  );
  const existingKeys = new Set(existing.map(e => `${e.obligation_id}|${e.period_label}`));

  interface ToCreate {
    obligation_id: string;
    entity_id: string;
    entity_name: string;
    tax_type: string;
    period_label: string;
    deadline_date: string | null;
  }
  const toCreate: ToCreate[] = [];
  const skippedAdhoc: string[] = [];

  for (const ob of obligations) {
    const labels = periodLabelsFor(ob.period_pattern, year);
    if (labels.length === 0) {
      skippedAdhoc.push(ob.id);
      continue;
    }
    const rule = ruleByKey.get(`${ob.tax_type}|${ob.period_pattern}`);
    for (const label of labels) {
      if (existingKeys.has(`${ob.id}|${label}`)) continue;
      let deadlineIso: string | null = null;
      if (rule) {
        try { deadlineIso = computeDeadline(rule, year, label).effective; }
        catch { deadlineIso = null; }
      }
      toCreate.push({
        obligation_id: ob.id,
        entity_id: ob.entity_id,
        entity_name: ob.entity_name,
        tax_type: ob.tax_type,
        period_label: label,
        deadline_date: deadlineIso,
      });
    }
  }

  const byTaxType = new Map<string, number>();
  for (const c of toCreate) byTaxType.set(c.tax_type, (byTaxType.get(c.tax_type) ?? 0) + 1);

  if (mode === MODE_PREVIEW) {
    return NextResponse.json({
      year,
      filings_to_create: toCreate.length,
      by_tax_type: Object.fromEntries(byTaxType),
      obligations_skipped_adhoc: skippedAdhoc.length,
      already_existing: existing.length,
    });
  }

  // COMMIT mode
  let inserted = 0;
  await tx(async (txSql) => {
    for (const c of toCreate) {
      const id = generateId();
      const res = await qTx<{ id: string }>(
        txSql,
        `INSERT INTO tax_filings (id, obligation_id, period_year, period_label,
                                   deadline_date, status, import_source)
         VALUES ($1, $2, $3, $4, $5, 'info_to_request', 'rollover')
         ON CONFLICT (obligation_id, period_label) DO NOTHING
         RETURNING id`,
        [id, c.obligation_id, year, c.period_label, c.deadline_date],
      );
      if (res[0]) inserted += 1;
    }
    await logAuditTx(txSql, {
      userId: 'founder',
      action: 'tax_ops_year_rollover',
      targetType: 'tax_filings',
      targetId: `rollover_${year}`,
      newValue: JSON.stringify({ year, inserted, planned: toCreate.length }),
    });
  });

  return NextResponse.json({ year, inserted, planned: toCreate.length });
}
