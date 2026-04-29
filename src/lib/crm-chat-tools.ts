// ════════════════════════════════════════════════════════════════════════
// crm-chat-tools.ts
//
// Tool definitions (Anthropic tool-use schema) + executors that let the
// chat model query the CRM read-only. Registered from /api/chat when
// the current page is under /crm/*.
//
// Safety design:
//   - Every tool is READ-ONLY. No crm_update_* / crm_delete_* here.
//     Writeback is a stint 34 decision, not this stint.
//   - Every SQL is parametrized + has explicit LIMIT 20 — no unbounded
//     lists. Chatty models sometimes loop; the LIMIT caps blast radius.
//   - Filters are all optional; missing filters degrade to "no filter"
//     on that dimension (NULL-safe WHERE clauses).
//   - Soft-deleted rows are always excluded.
//
// The tools are intentionally coarse-grained. The model should pick
// the right one based on the user's question; we don't have a
// "run-arbitrary-SQL" tool (too risky).
// ════════════════════════════════════════════════════════════════════════

import Anthropic from '@anthropic-ai/sdk';
import { query } from '@/lib/db';

const ROW_LIMIT = 20;

export const CRM_TOOLS: Anthropic.Tool[] = [
  {
    name: 'crm_query_companies',
    description:
      'Find companies in the CRM. Use for questions about clients, prospects, service providers. ' +
      'All filters are optional — omit a filter to match everything on that dimension. ' +
      'Returns up to 20 rows with id, name, classification, country, industry, ' +
      'open opportunity count, open matters count, outstanding invoice €.',
    input_schema: {
      type: 'object',
      properties: {
        classification: {
          type: 'string',
          enum: ['key_account', 'standard', 'occasional', 'not_yet_client'],
          description: 'KAM tier.',
        },
        country: { type: 'string', description: 'ISO-3166 alpha-2, e.g. "LU", "FR".' },
        min_pipeline_value: { type: 'number', description: 'Minimum total € in open opps.' },
        dormant_since_days: {
          type: 'number',
          description: 'Only return companies with no activity logged in at least this many days.',
        },
        name_contains: { type: 'string', description: 'Substring match on company_name (case-insensitive).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'crm_query_contacts',
    description:
      'Find contacts (people) in the CRM. Filters: lifecycle_stage (lead/prospect/customer/former_customer), ' +
      'engagement_level (active/dormant/lapsed), dormant since N days, role_tag, ' +
      'company_name substring. Returns up to 20 with id, full_name, job_title, email, ' +
      'engagement_level, lead_score, last_activity_at, primary company.',
    input_schema: {
      type: 'object',
      properties: {
        lifecycle_stage: { type: 'string', enum: ['peer', 'lead', 'prospect', 'customer', 'former_customer'] },
        engagement_level: { type: 'string', enum: ['active', 'dormant', 'lapsed'] },
        dormant_since_days: { type: 'number' },
        role_tag: { type: 'string', description: 'e.g. "main_poc", "decision_maker", "billing_contact".' },
        company_name_contains: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'crm_query_opportunities',
    description:
      'Find opportunities (deals). Filters: stage, min estimated value, stuck-since N days, ' +
      'close date window. Returns up to 20 with id, name, stage, value, probability, ' +
      'weighted value, close date, days in stage, company name.',
    input_schema: {
      type: 'object',
      properties: {
        stage: {
          type: 'string',
          enum: [
            'cold_identified', 'warm', 'first_touch', 'meeting_held', 'proposal_sent',
            'in_negotiation', 'won', 'lost',
          ],
        },
        stage_not: {
          type: 'string',
          enum: ['won', 'lost'],
          description: 'Exclude closed stages. Use "won" to get active pipeline, "lost" rarely.',
        },
        min_value: { type: 'number', description: 'Minimum estimated_value_eur.' },
        stuck_since_days: { type: 'number', description: 'Only opps not advanced in this many days.' },
        close_in_next_days: { type: 'number', description: 'estimated_close_date within N days from today.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'crm_query_matters',
    description:
      'Find matters (legal engagements). Filters: status, practice_area, closing-in N days, ' +
      'over-budget percentage. Returns up to 20 with id, matter_reference, title, status, ' +
      'practice areas, fee_type, opening/closing dates, budget, spent€, client name.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['active', 'on_hold', 'closed', 'archived'] },
        practice_area: { type: 'string', description: 'e.g. "tax", "m_a", "fund_regulatory".' },
        closing_in_next_days: { type: 'number' },
        over_budget_pct: {
          type: 'number',
          description: 'Only matters where spent / budget > this percent (0-200 typical).',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'crm_query_invoices',
    description:
      'Find invoices. Filters: status (draft/sent/paid/partial_paid/overdue/cancelled/credit_note), ' +
      'min outstanding, days overdue. Returns up to 20 with id, invoice_number, client name, ' +
      'issue/due dates, amounts, outstanding, status.',
    input_schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['draft', 'sent', 'paid', 'partial_paid', 'overdue', 'cancelled', 'credit_note'],
        },
        min_outstanding: { type: 'number' },
        days_overdue_at_least: { type: 'number' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'crm_find_record',
    description:
      'Fuzzy lookup for a specific record by name or reference. Use when the user mentions ' +
      'something like "the Acme matter" or "Jean Dupont". Returns up to 10 best matches ' +
      'across companies, contacts, opportunities, matters, and invoices.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name, reference, or partial string to search for.' },
        type: {
          type: 'string',
          enum: ['company', 'contact', 'opportunity', 'matter', 'invoice', 'any'],
          description: 'Restrict search to one type, or "any" to search all.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
];

// ═══════════════════════════════════════════════════════════════════
// Executor — dispatch tool_use → JSON string for tool_result.
// ═══════════════════════════════════════════════════════════════════

type ToolInput = Record<string, unknown>;

export async function executeCrmTool(name: string, input: ToolInput): Promise<string> {
  try {
    switch (name) {
      case 'crm_query_companies':     return JSON.stringify(await queryCompanies(input));
      case 'crm_query_contacts':      return JSON.stringify(await queryContacts(input));
      case 'crm_query_opportunities': return JSON.stringify(await queryOpportunities(input));
      case 'crm_query_matters':       return JSON.stringify(await queryMatters(input));
      case 'crm_query_invoices':      return JSON.stringify(await queryInvoices(input));
      case 'crm_find_record':         return JSON.stringify(await findRecord(input));
      default: return JSON.stringify({ error: `unknown tool: ${name}` });
    }
  } catch (e) {
    return JSON.stringify({
      error: 'tool_execution_failed',
      detail: e instanceof Error ? e.message : String(e),
    });
  }
}

// ─── Implementations ─────────────────────────────────────────────────

async function queryCompanies(input: ToolInput) {
  const conds: string[] = ['c.deleted_at IS NULL'];
  const params: unknown[] = [];
  const add = (v: unknown) => { params.push(v); return `$${params.length}`; };

  if (typeof input.classification === 'string') conds.push(`c.classification = ${add(input.classification)}`);
  if (typeof input.country === 'string') conds.push(`c.country = ${add(input.country)}`);
  if (typeof input.name_contains === 'string') conds.push(`c.company_name ILIKE ${add(`%${input.name_contains}%`)}`);

  const rows = await query(
    `SELECT c.id, c.company_name AS name, c.classification, c.country, c.industry,
            (SELECT COUNT(*) FROM crm_opportunities o
              WHERE o.company_id = c.id AND o.deleted_at IS NULL
                AND o.stage NOT IN ('won','lost')) AS open_opps_count,
            (SELECT COALESCE(SUM(estimated_value_eur), 0) FROM crm_opportunities o
              WHERE o.company_id = c.id AND o.deleted_at IS NULL
                AND o.stage NOT IN ('won','lost')) AS pipeline_value,
            (SELECT COUNT(*) FROM crm_matters m
              WHERE m.client_company_id = c.id AND m.deleted_at IS NULL
                AND m.status IN ('active','on_hold')) AS open_matters_count,
            (SELECT COALESCE(SUM(outstanding), 0) FROM crm_billing_invoices i
              WHERE i.company_id = c.id AND i.outstanding > 0) AS outstanding_total,
            (SELECT MAX(activity_date) FROM crm_activities a
              WHERE a.company_id = c.id) AS last_activity_at
       FROM crm_companies c
      WHERE ${conds.join(' AND ')}
      ORDER BY c.company_name
      LIMIT ${ROW_LIMIT}`,
    params,
  );

  // Post-filter for min_pipeline_value + dormant_since_days in JS — keeps
  // SQL composable without nested subselect filters.
  const minPipeline = Number(input.min_pipeline_value ?? 0);
  const dormantDays = Number(input.dormant_since_days ?? 0);
  const now = Date.now();

  return rows.filter(r => {
    const row = r as { pipeline_value: string; last_activity_at: string | null };
    if (minPipeline > 0 && Number(row.pipeline_value) < minPipeline) return false;
    if (dormantDays > 0) {
      const last = row.last_activity_at ? new Date(row.last_activity_at).getTime() : null;
      if (last === null) return true;
      const ageDays = Math.floor((now - last) / (1000 * 60 * 60 * 24));
      if (ageDays < dormantDays) return false;
    }
    return true;
  });
}

async function queryContacts(input: ToolInput) {
  const conds: string[] = ['c.deleted_at IS NULL'];
  const params: unknown[] = [];
  const add = (v: unknown) => { params.push(v); return `$${params.length}`; };

  if (typeof input.lifecycle_stage === 'string') conds.push(`c.lifecycle_stage = ${add(input.lifecycle_stage)}`);
  if (typeof input.engagement_level === 'string') {
    conds.push(`COALESCE(c.engagement_override, c.engagement_level) = ${add(input.engagement_level)}`);
  }
  if (typeof input.dormant_since_days === 'number' && input.dormant_since_days > 0) {
    conds.push(`(c.last_activity_at IS NULL OR c.last_activity_at < NOW() - ($${params.length + 1} || ' days')::interval)`);
    params.push(String(input.dormant_since_days));
  }
  if (typeof input.role_tag === 'string') conds.push(`${add(input.role_tag)} = ANY(c.role_tags)`);
  if (typeof input.company_name_contains === 'string') {
    conds.push(`EXISTS (
      SELECT 1 FROM crm_contact_companies cc
      JOIN crm_companies co ON co.id = cc.company_id
      WHERE cc.contact_id = c.id
        AND co.company_name ILIKE ${add(`%${input.company_name_contains}%`)}
        AND co.deleted_at IS NULL
    )`);
  }

  const rows = await query(
    `SELECT c.id, c.full_name, c.job_title, c.email, c.lifecycle_stage,
            COALESCE(c.engagement_override, c.engagement_level) AS engagement_level,
            c.lead_score, c.last_activity_at::text,
            (SELECT co.company_name
               FROM crm_contact_companies cc
               JOIN crm_companies co ON co.id = cc.company_id
              WHERE cc.contact_id = c.id AND co.deleted_at IS NULL
              ORDER BY cc.is_primary DESC
              LIMIT 1) AS primary_company
       FROM crm_contacts c
      WHERE ${conds.join(' AND ')}
      ORDER BY c.last_activity_at ASC NULLS LAST
      LIMIT ${ROW_LIMIT}`,
    params,
  );
  return rows;
}

async function queryOpportunities(input: ToolInput) {
  const conds: string[] = ['o.deleted_at IS NULL'];
  const params: unknown[] = [];
  const add = (v: unknown) => { params.push(v); return `$${params.length}`; };

  if (typeof input.stage === 'string') conds.push(`o.stage = ${add(input.stage)}`);
  if (typeof input.stage_not === 'string') conds.push(`o.stage <> ${add(input.stage_not)}`);
  if (typeof input.min_value === 'number') conds.push(`o.estimated_value_eur >= ${add(input.min_value)}`);
  if (typeof input.stuck_since_days === 'number' && input.stuck_since_days > 0) {
    conds.push(`o.stage_entered_at IS NOT NULL`);
    conds.push(`o.stage_entered_at < NOW() - (${add(String(input.stuck_since_days))} || ' days')::interval`);
  }
  if (typeof input.close_in_next_days === 'number') {
    conds.push(`o.estimated_close_date BETWEEN CURRENT_DATE AND CURRENT_DATE + (${add(String(input.close_in_next_days))} || ' days')::interval`);
  }

  const rows = await query(
    `SELECT o.id, o.name, o.stage, o.estimated_value_eur::text, o.probability_pct,
            o.weighted_value_eur::text, o.estimated_close_date::text,
            (CURRENT_DATE - o.stage_entered_at::date)::int AS days_in_stage,
            c.company_name AS client_name
       FROM crm_opportunities o
       LEFT JOIN crm_companies c ON c.id = o.company_id
      WHERE ${conds.join(' AND ')}
      ORDER BY o.weighted_value_eur DESC NULLS LAST
      LIMIT ${ROW_LIMIT}`,
    params,
  );
  return rows;
}

async function queryMatters(input: ToolInput) {
  const conds: string[] = ['m.deleted_at IS NULL'];
  const params: unknown[] = [];
  const add = (v: unknown) => { params.push(v); return `$${params.length}`; };

  if (typeof input.status === 'string') conds.push(`m.status = ${add(input.status)}`);
  if (typeof input.practice_area === 'string') conds.push(`${add(input.practice_area)} = ANY(m.practice_areas)`);
  if (typeof input.closing_in_next_days === 'number') {
    conds.push(`m.closing_date BETWEEN CURRENT_DATE AND CURRENT_DATE + (${add(String(input.closing_in_next_days))} || ' days')::interval`);
  }

  const rows = await query<{
    id: string; matter_reference: string; title: string; status: string;
    practice_areas: string[] | null; fee_type: string | null;
    opening_date: string | null; closing_date: string | null;
    estimated_budget_eur: string | null; spent_eur: string;
    client_name: string | null;
  }>(
    `SELECT m.id, m.matter_reference, m.title, m.status, m.practice_areas,
            m.fee_type, m.opening_date::text, m.closing_date::text,
            m.estimated_budget_eur::text,
            COALESCE((SELECT SUM(te.hours * COALESCE(te.rate_eur, m.hourly_rate_eur, 0))
                        FROM crm_time_entries te
                       WHERE te.matter_id = m.id AND te.billable = TRUE), 0)::text AS spent_eur,
            c.company_name AS client_name
       FROM crm_matters m
       LEFT JOIN crm_companies c ON c.id = m.client_company_id
      WHERE ${conds.join(' AND ')}
      ORDER BY m.opening_date DESC NULLS LAST
      LIMIT ${ROW_LIMIT}`,
    params,
  );

  // Post-filter for over_budget_pct (needs spent + budget both non-null).
  const pct = Number(input.over_budget_pct ?? 0);
  if (pct <= 0) return rows;
  return rows.filter(r => {
    const budget = Number(r.estimated_budget_eur ?? 0);
    const spent = Number(r.spent_eur ?? 0);
    if (budget <= 0) return false;
    return (spent / budget) * 100 >= pct;
  });
}

async function queryInvoices(input: ToolInput) {
  const conds: string[] = [];
  const params: unknown[] = [];
  const add = (v: unknown) => { params.push(v); return `$${params.length}`; };

  if (typeof input.status === 'string') conds.push(`i.status = ${add(input.status)}`);
  if (typeof input.min_outstanding === 'number') conds.push(`i.outstanding >= ${add(input.min_outstanding)}`);
  if (typeof input.days_overdue_at_least === 'number' && input.days_overdue_at_least > 0) {
    conds.push(`i.due_date IS NOT NULL`);
    conds.push(`(CURRENT_DATE - i.due_date) >= ${add(input.days_overdue_at_least)}`);
    conds.push(`i.outstanding > 0`);
  }

  const rows = await query(
    `SELECT i.id, i.invoice_number, c.company_name AS client_name,
            i.issue_date::text, i.due_date::text,
            i.amount_incl_vat::text, i.amount_paid::text, i.outstanding::text,
            i.status, i.currency
       FROM crm_billing_invoices i
       LEFT JOIN crm_companies c ON c.id = i.company_id
      ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}
      ORDER BY i.due_date ASC NULLS LAST
      LIMIT ${ROW_LIMIT}`,
    params,
  );
  return rows;
}

async function findRecord(input: ToolInput) {
  const q = typeof input.query === 'string' ? input.query.trim() : '';
  if (!q) return { error: 'query is required' };
  const type = typeof input.type === 'string' ? input.type : 'any';
  const like = `%${q}%`;

  const results: Array<{ type: string; id: string; label: string; sublabel?: string }> = [];

  const shouldSearch = (t: string) => type === 'any' || type === t;

  if (shouldSearch('company')) {
    const rows = await query<{ id: string; company_name: string; classification: string | null }>(
      `SELECT id, company_name, classification FROM crm_companies
        WHERE deleted_at IS NULL AND company_name ILIKE $1
        LIMIT 5`, [like],
    );
    for (const r of rows) results.push({ type: 'company', id: r.id, label: r.company_name, sublabel: r.classification ?? undefined });
  }
  if (shouldSearch('contact')) {
    const rows = await query<{ id: string; full_name: string; email: string | null }>(
      `SELECT id, full_name, email FROM crm_contacts
        WHERE deleted_at IS NULL AND full_name ILIKE $1
        LIMIT 5`, [like],
    );
    for (const r of rows) results.push({ type: 'contact', id: r.id, label: r.full_name, sublabel: r.email ?? undefined });
  }
  if (shouldSearch('opportunity')) {
    const rows = await query<{ id: string; name: string; stage: string }>(
      `SELECT id, name, stage FROM crm_opportunities
        WHERE deleted_at IS NULL AND name ILIKE $1
        LIMIT 5`, [like],
    );
    for (const r of rows) results.push({ type: 'opportunity', id: r.id, label: r.name, sublabel: r.stage });
  }
  if (shouldSearch('matter')) {
    const rows = await query<{ id: string; matter_reference: string; title: string }>(
      `SELECT id, matter_reference, title FROM crm_matters
        WHERE deleted_at IS NULL AND (matter_reference ILIKE $1 OR title ILIKE $1)
        LIMIT 5`, [like],
    );
    for (const r of rows) results.push({ type: 'matter', id: r.id, label: `${r.matter_reference} — ${r.title}` });
  }
  if (shouldSearch('invoice')) {
    const rows = await query<{ id: string; invoice_number: string; status: string }>(
      `SELECT id, invoice_number, status FROM crm_billing_invoices
        WHERE invoice_number ILIKE $1
        LIMIT 5`, [like],
    );
    for (const r of rows) results.push({ type: 'invoice', id: r.id, label: r.invoice_number, sublabel: r.status });
  }

  return results.slice(0, 10);
}
