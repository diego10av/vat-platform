import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

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
