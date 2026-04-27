import { NextRequest, NextResponse } from 'next/server';
import { query, execute, logAudit, buildUpdate } from '@/lib/db';

// GET    /api/tax-ops/filings/[id]  — full detail
// PATCH  /api/tax-ops/filings/[id]  — partial update
// DELETE /api/tax-ops/filings/[id]  — hard delete (audit-logged, rarely used)

interface FilingDetail {
  id: string;
  obligation_id: string;
  entity_id: string;
  entity_name: string;
  group_id: string | null;
  group_name: string | null;
  tax_type: string;
  period_pattern: string;
  period_year: number;
  period_label: string;
  deadline_date: string | null;
  status: string;
  assigned_to: string | null;
  prepared_with: string[];
  /** Stint 43.D11 — partner(s) who own the engagement. */
  partner_in_charge: string[];
  /** Stint 43.D11 — associate(s) doing the prep work. */
  associates_working: string[];
  /** Stint 44.F3 — assessment outcome category. */
  tax_assessment_outcome: string | null;
  draft_sent_at: string | null;
  client_approved_at: string | null;
  filed_at: string | null;
  tax_assessment_received_at: string | null;
  tax_assessment_url: string | null;
  amount_due: string | null;
  amount_paid: string | null;
  paid_at: string | null;
  csp_contacts: Array<{ name: string; email?: string; role?: string }>;
  entity_csp_contacts: Array<{ name: string; email?: string; role?: string }>;
  comments: string | null;
  internal_matter_code: string | null;
  // Stint 39.F + 40.O — fields added after initial schema.
  last_info_request_sent_at: string | null;
  invoice_price_eur: string | null;
  invoice_price_note: string | null;
  // Stint 52 — separate price for the ISS / Intra-community Supply of Services companion.
  invoice_price_iss_eur: string | null;
  invoice_price_iss_note: string | null;
  import_source: string;
  created_at: string;
  updated_at: string;
  // Rule metadata so the detail page can show "statutory vs effective"
  rule_statutory_description: string | null;
  rule_admin_tolerance_days: number | null;
  rule_market_practice_note: string | null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const rows = await query<FilingDetail>(
    `SELECT f.id, f.obligation_id,
            e.id AS entity_id, e.legal_name AS entity_name,
            g.id AS group_id, g.name AS group_name,
            o.tax_type, o.period_pattern,
            f.period_year, f.period_label,
            f.deadline_date::text AS deadline_date,
            f.status, f.assigned_to, f.prepared_with,
            f.partner_in_charge, f.associates_working,
            f.draft_sent_at::text AS draft_sent_at,
            f.client_approved_at::text AS client_approved_at,
            f.filed_at::text AS filed_at,
            f.tax_assessment_received_at::text AS tax_assessment_received_at,
            f.tax_assessment_outcome,
            f.tax_assessment_url,
            f.amount_due::text, f.amount_paid::text, f.paid_at::text,
            f.csp_contacts, e.csp_contacts AS entity_csp_contacts,
            f.comments, f.internal_matter_code,
            f.last_info_request_sent_at::text AS last_info_request_sent_at,
            f.invoice_price_eur::text AS invoice_price_eur,
            f.invoice_price_note,
            f.invoice_price_iss_eur::text AS invoice_price_iss_eur,
            f.invoice_price_iss_note,
            f.import_source,
            f.created_at::text, f.updated_at::text,
            r.statutory_description AS rule_statutory_description,
            r.admin_tolerance_days AS rule_admin_tolerance_days,
            r.market_practice_note AS rule_market_practice_note
       FROM tax_filings f
       JOIN tax_obligations o ON o.id = f.obligation_id
       JOIN tax_entities e    ON e.id = o.entity_id
       LEFT JOIN tax_client_groups g  ON g.id = e.client_group_id
       LEFT JOIN tax_deadline_rules r
             ON r.tax_type = o.tax_type AND r.period_pattern = o.period_pattern
      WHERE f.id = $1`,
    [id],
  );
  if (!rows[0]) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(rows[0]);
}

const ALLOWED_FIELDS = [
  'status', 'assigned_to', 'deadline_date', 'prepared_with',
  'draft_sent_at', 'client_approved_at', 'filed_at',
  'tax_assessment_received_at', 'tax_assessment_url',
  // Stint 44.F3 — assessment outcome category ('aligned' / 'under_audit' / null).
  'tax_assessment_outcome',
  'amount_due', 'amount_paid', 'paid_at',
  'csp_contacts', 'comments', 'internal_matter_code',
  // Stint 39.F — last chase date for info requests to client/CSP.
  'last_info_request_sent_at',
  // Stint 40.O — invoice price per filing + free-text clarification.
  'invoice_price_eur', 'invoice_price_note',
  // Stint 52 — separate price for ISS (Intra-community Supply of Services /
  // Liste récapitulative) companion deliverable. Surfaced only on VAT
  // matrices but lives on every filing.
  'invoice_price_iss_eur', 'invoice_price_iss_note',
  // Stint 43.D6 — last_action_at (manual override of the auto-stamp).
  'last_action_at',
  // Stint 43.D11 — partner in charge + associates working (TEXT[]).
  'partner_in_charge', 'associates_working',
] as const;

// Stint 43.D6 — fields whose change should trigger auto-stamp of
// last_action_at. Anything in the user's mental model of "an action"
// counts — the date column is meant to answer "when was the last
// time anything happened with this filing?".
const AUTOSTAMP_TRIGGER_FIELDS = new Set<string>([
  'status', 'assigned_to', 'prepared_with', 'csp_contacts',
  'comments', 'draft_sent_at', 'client_approved_at', 'filed_at',
  'tax_assessment_received_at', 'last_info_request_sent_at',
  'amount_due', 'amount_paid', 'paid_at',
  // Stint 43.D11 — ownership re-assignment counts as an action too.
  'partner_in_charge', 'associates_working',
]);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const body = await request.json() as Record<string, unknown>;

  // Auto-stamp last_action_at when any "action" field changed and the
  // caller didn't supply an explicit value. Diego can override by
  // sending last_action_at in the body.
  const triggersAutostamp = Object.keys(body).some(k => AUTOSTAMP_TRIGGER_FIELDS.has(k));
  if (triggersAutostamp && body.last_action_at === undefined) {
    body.last_action_at = new Date().toISOString().slice(0, 10);
  }

  const { sql, values, changes } = buildUpdate(
    'tax_filings', ALLOWED_FIELDS, body, 'id', id, ['updated_at = NOW()'],
  );
  if (!sql) {
    return NextResponse.json({ error: 'empty_patch' }, { status: 400 });
  }
  await execute(sql, values);
  await logAudit({
    userId: 'founder',
    action: 'tax_filing_update',
    targetType: 'tax_filing',
    targetId: id,
    newValue: JSON.stringify(changes),
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  await execute(`DELETE FROM tax_filings WHERE id = $1`, [id]);
  await logAudit({
    userId: 'founder',
    action: 'tax_filing_delete',
    targetType: 'tax_filing',
    targetId: id,
  });
  return NextResponse.json({ ok: true });
}
