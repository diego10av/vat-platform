import { NextRequest, NextResponse } from 'next/server';
import { query, execute, logAudit, generateId } from '@/lib/db';

// GET /api/tax-ops/deadline-rules — list all editable rules
//
// Each row also reports how many open filings would be affected if the
// deadline re-computed — helps Diego gauge impact before editing.

interface RuleListRow {
  id: string;
  tax_type: string;
  period_pattern: string;
  rule_kind: string;
  rule_params: Record<string, unknown>;
  statutory_description: string | null;
  admin_tolerance_days: number;
  market_practice_note: string | null;
  updated_at: string;
  updated_by: string | null;
  open_filings_count: number;
}

export async function GET() {
  const rows = await query<RuleListRow>(
    `SELECT r.id, r.tax_type, r.period_pattern, r.rule_kind, r.rule_params,
            r.statutory_description, r.admin_tolerance_days,
            r.market_practice_note,
            r.updated_at::text, r.updated_by,
            (SELECT COUNT(*)::int
               FROM tax_filings f
               JOIN tax_obligations o ON o.id = f.obligation_id
              WHERE o.tax_type = r.tax_type
                AND o.period_pattern = r.period_pattern
                AND f.status NOT IN ('filed','paid','waived','assessment_received')
            ) AS open_filings_count
       FROM tax_deadline_rules r
      ORDER BY r.tax_type, r.period_pattern`,
  );
  return NextResponse.json({ rules: rows });
}

// POST /api/tax-ops/deadline-rules — create a new rule (stint 37.H)
//   Body: { tax_type, period_pattern, rule_kind, rule_params,
//           statutory_description?, admin_tolerance_days?, market_practice_note? }
//   Rule-kind valid values: days_after_period_end | fixed_md |
//                            fixed_md_with_extension | adhoc_no_deadline
export async function POST(request: NextRequest) {
  const body = await request.json() as {
    tax_type?: string;
    period_pattern?: string;
    rule_kind?: string;
    rule_params?: Record<string, unknown>;
    statutory_description?: string | null;
    admin_tolerance_days?: number;
    market_practice_note?: string | null;
  };

  if (!body.tax_type?.trim() || !body.period_pattern?.trim() || !body.rule_kind?.trim()) {
    return NextResponse.json({ error: 'required_fields_missing' }, { status: 400 });
  }

  const id = `rule_${body.tax_type.toLowerCase().replace(/[^a-z0-9_]+/g, '_')}_${generateId().slice(0, 8)}`;

  try {
    await execute(
      `INSERT INTO tax_deadline_rules
         (id, tax_type, period_pattern, rule_kind, rule_params,
          statutory_description, admin_tolerance_days, market_practice_note, updated_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, 'founder')`,
      [
        id,
        body.tax_type.trim(),
        body.period_pattern.trim(),
        body.rule_kind.trim(),
        JSON.stringify(body.rule_params ?? {}),
        body.statutory_description ?? null,
        body.admin_tolerance_days ?? 0,
        body.market_practice_note ?? null,
      ],
    );
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    if (/unique|duplicate/i.test(msg)) {
      return NextResponse.json({ error: 'rule_exists_for_combo' }, { status: 409 });
    }
    throw e;
  }

  await logAudit({
    userId: 'founder',
    action: 'tax_deadline_rule_create',
    targetType: 'tax_deadline_rule',
    targetId: id,
    newValue: JSON.stringify({
      tax_type: body.tax_type,
      period_pattern: body.period_pattern,
      rule_kind: body.rule_kind,
    }),
  });

  return NextResponse.json({ id });
}
