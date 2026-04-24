import { NextRequest, NextResponse } from 'next/server';
import { tx, qTx, execTx, logAuditTx } from '@/lib/db';
import { computeDeadline, type DeadlineRule } from '@/lib/tax-ops-deadlines';

// PATCH /api/tax-ops/deadline-rules/[id]
//   Body: { rule_kind?, rule_params?, statutory_description?,
//           admin_tolerance_days?, market_practice_note?,
//           propagate?: boolean }
//
// When `propagate=true`, after the rule UPDATE we recompute the deadline
// of every open filing of the same (tax_type, period_pattern) — i.e.
// status NOT IN (filed, paid, waived, assessment_received). The historic
// ones keep their deadline so the audit trail stays intact.
//
// Response: { ok: true, propagated: N, preview?: [...] }
//
// GET /api/tax-ops/deadline-rules/[id]?preview_propagate=1
//   → returns the list of open filings that WOULD be re-dated, with
//     old + new deadline. Lets the UI show a confirm dialog.

interface RuleRow extends DeadlineRule {
  id: string;
  statutory_description: string | null;
  market_practice_note: string | null;
}

interface AffectedFiling {
  id: string;
  entity_name: string;
  period_year: number;
  period_label: string;
  old_deadline: string | null;
  new_deadline: string | null;
  status: string;
}

const OPEN_STATUSES = ['pending_info', 'info_received', 'working', 'draft_sent',
                        'pending_client_approval', 'blocked'];

async function fetchRule(id: string): Promise<RuleRow | null> {
  const rows = await (await import('@/lib/db')).query<RuleRow>(
    `SELECT id, tax_type, period_pattern, rule_kind, rule_params,
            statutory_description, market_practice_note,
            admin_tolerance_days
       FROM tax_deadline_rules WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

async function computeAffected(rule: RuleRow): Promise<AffectedFiling[]> {
  const { query } = await import('@/lib/db');
  const filings = await query<{
    id: string; entity_name: string; period_year: number;
    period_label: string; deadline_date: string | null; status: string;
  }>(
    `SELECT f.id, e.legal_name AS entity_name, f.period_year, f.period_label,
            f.deadline_date::text AS deadline_date, f.status
       FROM tax_filings f
       JOIN tax_obligations o ON o.id = f.obligation_id
       JOIN tax_entities e    ON e.id = o.entity_id
      WHERE o.tax_type = $1
        AND o.period_pattern = $2
        AND f.status = ANY($3::text[])`,
    [rule.tax_type, rule.period_pattern, OPEN_STATUSES],
  );

  const out: AffectedFiling[] = [];
  for (const f of filings) {
    let newDeadline: string | null = null;
    try { newDeadline = computeDeadline(rule, f.period_year, f.period_label).effective; }
    catch { /* fallback to null, UI will show "—" */ }
    out.push({
      id: f.id,
      entity_name: f.entity_name,
      period_year: f.period_year,
      period_label: f.period_label,
      old_deadline: f.deadline_date,
      new_deadline: newDeadline,
      status: f.status,
    });
  }
  return out;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const url = new URL(request.url);
  const wantPreview = url.searchParams.get('preview_propagate') === '1';

  const rule = await fetchRule(id);
  if (!rule) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  if (!wantPreview) return NextResponse.json(rule);

  // With a custom rule_kind/params in the querystring we could preview a
  // hypothetical edit. Today the preview uses the stored rule — UX-wise
  // that's still useful ("would change N open filings on current rule?"),
  // and the full diff preview lands on PATCH with propagate=true.
  const affected = await computeAffected(rule);
  return NextResponse.json({ rule, affected, count: affected.length });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const body = await request.json() as {
    rule_kind?: string;
    rule_params?: Record<string, unknown>;
    statutory_description?: string | null;
    admin_tolerance_days?: number;
    market_practice_note?: string | null;
    propagate?: boolean;
  };

  const existing = await fetchRule(id);
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Basic param validation by rule_kind
  const kind = body.rule_kind ?? existing.rule_kind;
  const params_ = body.rule_params ?? existing.rule_params;
  if (kind === 'days_after_period_end') {
    if (typeof (params_ as { days_after?: unknown }).days_after !== 'number') {
      return NextResponse.json({ error: 'params_days_after_required' }, { status: 400 });
    }
  } else if (kind === 'fixed_md') {
    const p = params_ as { month?: unknown; day?: unknown };
    if (typeof p.month !== 'number' || typeof p.day !== 'number') {
      return NextResponse.json({ error: 'params_month_day_required' }, { status: 400 });
    }
  } else if (kind === 'fixed_md_with_extension') {
    const p = params_ as { month?: unknown; day?: unknown; extension_month?: unknown; extension_day?: unknown };
    if (typeof p.month !== 'number' || typeof p.day !== 'number' ||
        typeof p.extension_month !== 'number' || typeof p.extension_day !== 'number') {
      return NextResponse.json({ error: 'params_extension_required' }, { status: 400 });
    }
  }

  const propagate = body.propagate === true;
  let propagated = 0;

  await tx(async (txSql) => {
    await execTx(
      txSql,
      `UPDATE tax_deadline_rules
          SET rule_kind = $1,
              rule_params = $2::jsonb,
              statutory_description = COALESCE($3, statutory_description),
              admin_tolerance_days = COALESCE($4, admin_tolerance_days),
              market_practice_note = COALESCE($5, market_practice_note),
              updated_at = NOW(),
              updated_by = $6
        WHERE id = $7`,
      [
        kind, JSON.stringify(params_),
        body.statutory_description ?? null,
        body.admin_tolerance_days ?? null,
        body.market_practice_note ?? null,
        'founder', id,
      ],
    );

    if (propagate) {
      // Recompute deadline for every open filing. We use the NEW rule
      // (existing merged with the patch) by refetching via txSql.
      const updatedRuleRows = await qTx<RuleRow>(
        txSql,
        `SELECT id, tax_type, period_pattern, rule_kind, rule_params,
                statutory_description, market_practice_note,
                admin_tolerance_days
           FROM tax_deadline_rules WHERE id = $1`,
        [id],
      );
      const updated = updatedRuleRows[0]!;

      const filings = await qTx<{
        id: string; period_year: number; period_label: string;
      }>(
        txSql,
        `SELECT f.id, f.period_year, f.period_label
           FROM tax_filings f
           JOIN tax_obligations o ON o.id = f.obligation_id
          WHERE o.tax_type = $1
            AND o.period_pattern = $2
            AND f.status = ANY($3::text[])`,
        [updated.tax_type, updated.period_pattern, OPEN_STATUSES],
      );

      for (const f of filings) {
        let newIso: string | null = null;
        try { newIso = computeDeadline(updated, f.period_year, f.period_label).effective; }
        catch { newIso = null; }
        await execTx(
          txSql,
          `UPDATE tax_filings SET deadline_date = $1, updated_at = NOW() WHERE id = $2`,
          [newIso, f.id],
        );
        propagated += 1;
      }
    }

    await logAuditTx(txSql, {
      userId: 'founder',
      action: 'tax_deadline_rule_update',
      targetType: 'tax_deadline_rule',
      targetId: id,
      oldValue: JSON.stringify({
        rule_kind: existing.rule_kind,
        rule_params: existing.rule_params,
        admin_tolerance_days: existing.admin_tolerance_days,
      }),
      newValue: JSON.stringify({
        rule_kind: kind,
        rule_params: params_,
        admin_tolerance_days: body.admin_tolerance_days,
        propagate, propagated,
      }),
    });
  });

  return NextResponse.json({ ok: true, propagated });
}
