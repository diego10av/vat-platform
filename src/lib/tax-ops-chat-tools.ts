// ════════════════════════════════════════════════════════════════════════
// tax-ops-chat-tools.ts
//
// 4 read-only tools that let Ask cifra answer questions about the
// tax-ops module (filings, entities, tasks) from real DB data instead
// of guessing. Registered from /api/chat when the current page is
// under /tax-ops/*.
//
// Shape mirrors crm-chat-tools.ts (same Anthropic.Tool[] layout +
// executeTool signature) — keeps route.ts tool-loop code uniform.
//
// Safety:
//   - All tools READ-ONLY. Writeback is via the UI, not Ask cifra.
//   - Parametrized queries, explicit LIMIT 20 — no unbounded scans.
//   - Inactive entities filtered out unless the caller asks otherwise.
// ════════════════════════════════════════════════════════════════════════

import Anthropic from '@anthropic-ai/sdk';
import { query } from '@/lib/db';

const ROW_LIMIT = 20;

export const TAX_OPS_TOOLS: Anthropic.Tool[] = [
  {
    name: 'tax_query_filings',
    description:
      'Find tax filings with filters. Use for questions like "CIT 2026 pending info", ' +
      '"overdue VAT filings", "what\'s due in the next 14 days". All filters optional — ' +
      'omit any to match everything on that dimension. Returns up to 20 filings with ' +
      'entity_name, group_name, tax_type, period_label, deadline_date, days_until_deadline, ' +
      'status, assigned_to, filed_at.',
    input_schema: {
      type: 'object',
      properties: {
        tax_type: {
          type: 'string',
          description:
            'e.g. cit_annual, nwt_annual, vat_annual, vat_quarterly, vat_monthly, ' +
            'subscription_tax_quarterly, wht_director_monthly, fatca_crs_annual, ' +
            'bcl_sbs_quarterly, functional_currency_request.',
        },
        year: { type: 'number', description: 'Filing period year, e.g. 2026.' },
        status: {
          type: 'string',
          enum: ['info_to_request', 'working',
                 'awaiting_client_clarification', 'draft_sent',
                 'partially_approved', 'client_approved', 'filed'],
          description: 'Exact status match. Omit for any status.',
        },
        group_name_contains: {
          type: 'string',
          description: 'Substring match on the fund-family group name (case-insensitive).',
        },
        deadline_in_days: {
          type: 'number',
          description:
            'Only return filings with deadline on or before today + N days. ' +
            'Pass 0 for today, 14 for the next two weeks. Already-filed/paid/waived excluded.',
        },
        assigned_to: { type: 'string', description: 'Assignee short name as configured in Settings › Team.' },
        overdue: {
          type: 'boolean',
          description: 'If true, only filings past their deadline and not filed/paid/waived.',
        },
        entity_name_contains: { type: 'string', description: 'Substring on legal_name.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'tax_query_entities',
    description:
      'Find legal entities (148-ish after dedup from Diego\'s Excel books). Filters by ' +
      'group, active status, presence of a specific obligation type, or name. Returns up ' +
      'to 20 rows with id, legal_name, vat_number, matricule, group_name, is_active, ' +
      'obligations_count, last_assessment_year.',
    input_schema: {
      type: 'object',
      properties: {
        group_name_contains: { type: 'string', description: 'Substring on fund-family group.' },
        name_contains: { type: 'string', description: 'Substring on legal_name.' },
        is_active: { type: 'boolean', description: 'Defaults to true. Pass false to include liquidated / archived.' },
        has_obligation_type: {
          type: 'string',
          description: 'Return only entities that have an active obligation of this tax_type.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'tax_query_tasks',
    description:
      'Find tax-ops tasks (separate from CRM tasks). Filters by status (multi-valued via status_any), ' +
      'priority, assignee, due date window, related_filing_id. Returns up to 20 with ' +
      'id, title, status, priority, due_date, assignee, subtask counts, related_entity_name, ' +
      'related_filing_label.',
    input_schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['queued', 'in_progress', 'waiting_on_external', 'waiting_on_internal', 'done', 'cancelled'],
        },
        priority: { type: 'string', enum: ['urgent', 'high', 'medium', 'low'] },
        assignee: { type: 'string', description: 'Short name match.' },
        due_in_days: { type: 'number', description: 'On or before today + N days. 0 = overdue today.' },
        related_filing_id: { type: 'string' },
        related_entity_id: { type: 'string' },
        text_contains: { type: 'string', description: 'Substring on title or description.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'tax_find_record',
    description:
      'Fuzzy lookup for a tax-ops record by name, VAT number, or task title. Use when ' +
      'the user says "the AIFM Foo entity" or "my NWT-extension task". Returns up to 10 ' +
      'best matches across entities, filings, tasks.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name, reference, VAT, or partial string.' },
        type: {
          type: 'string',
          enum: ['entity', 'filing', 'task', 'any'],
          description: 'Restrict to one type or "any".',
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

export async function executeTaxOpsTool(name: string, input: ToolInput): Promise<string> {
  try {
    switch (name) {
      case 'tax_query_filings':  return JSON.stringify(await queryFilings(input));
      case 'tax_query_entities': return JSON.stringify(await queryEntities(input));
      case 'tax_query_tasks':    return JSON.stringify(await queryTasks(input));
      case 'tax_find_record':    return JSON.stringify(await findRecord(input));
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

async function queryFilings(input: ToolInput) {
  const conds: string[] = ['e.is_active = TRUE'];
  const params: unknown[] = [];
  const add = (v: unknown) => { params.push(v); return `$${params.length}`; };

  if (typeof input.tax_type === 'string') conds.push(`o.tax_type = ${add(input.tax_type)}`);
  if (typeof input.year === 'number') conds.push(`f.period_year = ${add(input.year)}`);
  if (typeof input.status === 'string') conds.push(`f.status = ${add(input.status)}`);
  if (typeof input.group_name_contains === 'string') {
    conds.push(`g.name ILIKE ${add(`%${input.group_name_contains}%`)}`);
  }
  if (typeof input.entity_name_contains === 'string') {
    conds.push(`e.legal_name ILIKE ${add(`%${input.entity_name_contains}%`)}`);
  }
  if (typeof input.deadline_in_days === 'number') {
    conds.push(`f.deadline_date IS NOT NULL
                AND f.deadline_date <= CURRENT_DATE + (${add(String(input.deadline_in_days))} || ' days')::interval
                AND f.status <> 'filed'`);
  }
  if (typeof input.assigned_to === 'string') conds.push(`f.assigned_to = ${add(input.assigned_to)}`);
  if (input.overdue === true) {
    conds.push(`f.deadline_date < CURRENT_DATE AND f.status <> 'filed'`);
  }

  const rows = await query(
    `SELECT f.id, e.legal_name AS entity_name, g.name AS group_name,
            o.tax_type, f.period_year, f.period_label,
            f.deadline_date::text,
            (f.deadline_date - CURRENT_DATE)::int AS days_until_deadline,
            f.status, f.assigned_to,
            f.filed_at::text, f.draft_sent_at::text,
            f.amount_due::text
       FROM tax_filings f
       JOIN tax_obligations o ON o.id = f.obligation_id
       JOIN tax_entities e    ON e.id = o.entity_id
       LEFT JOIN tax_client_groups g ON g.id = e.client_group_id
      WHERE ${conds.join(' AND ')}
      ORDER BY f.deadline_date ASC NULLS LAST, e.legal_name
      LIMIT ${ROW_LIMIT}`,
    params,
  );
  return rows;
}

async function queryEntities(input: ToolInput) {
  const conds: string[] = [];
  const params: unknown[] = [];
  const add = (v: unknown) => { params.push(v); return `$${params.length}`; };

  // Default is_active=true unless explicitly set
  if (input.is_active === false) {
    conds.push(`e.is_active = FALSE`);
  } else {
    conds.push(`e.is_active = TRUE`);
  }

  if (typeof input.group_name_contains === 'string') {
    conds.push(`g.name ILIKE ${add(`%${input.group_name_contains}%`)}`);
  }
  if (typeof input.name_contains === 'string') {
    conds.push(`e.legal_name ILIKE ${add(`%${input.name_contains}%`)}`);
  }
  if (typeof input.has_obligation_type === 'string') {
    conds.push(`EXISTS (
      SELECT 1 FROM tax_obligations o2
       WHERE o2.entity_id = e.id
         AND o2.is_active = TRUE
         AND o2.tax_type = ${add(input.has_obligation_type)}
    )`);
  }

  const rows = await query(
    `SELECT e.id, e.legal_name, e.vat_number, e.matricule, e.rcs_number,
            e.is_active, g.name AS group_name,
            (SELECT COUNT(*)::int FROM tax_obligations o
              WHERE o.entity_id = e.id AND o.is_active) AS obligations_count,
            (SELECT EXTRACT(YEAR FROM MAX(f.tax_assessment_received_at))::int
               FROM tax_filings f
               JOIN tax_obligations o3 ON o3.id = f.obligation_id
              WHERE o3.entity_id = e.id) AS last_assessment_year
       FROM tax_entities e
       LEFT JOIN tax_client_groups g ON g.id = e.client_group_id
      WHERE ${conds.join(' AND ')}
      ORDER BY g.name ASC NULLS LAST, e.legal_name ASC
      LIMIT ${ROW_LIMIT}`,
    params,
  );
  return rows;
}

async function queryTasks(input: ToolInput) {
  const conds: string[] = [];
  const params: unknown[] = [];
  const add = (v: unknown) => { params.push(v); return `$${params.length}`; };

  if (typeof input.status === 'string') conds.push(`t.status = ${add(input.status)}`);
  if (typeof input.priority === 'string') conds.push(`t.priority = ${add(input.priority)}`);
  if (typeof input.assignee === 'string') conds.push(`t.assignee = ${add(input.assignee)}`);
  if (typeof input.due_in_days === 'number') {
    conds.push(`t.due_date IS NOT NULL
                AND t.due_date <= CURRENT_DATE + (${add(String(input.due_in_days))} || ' days')::interval`);
  }
  if (typeof input.related_filing_id === 'string') conds.push(`t.related_filing_id = ${add(input.related_filing_id)}`);
  if (typeof input.related_entity_id === 'string') conds.push(`t.related_entity_id = ${add(input.related_entity_id)}`);
  if (typeof input.text_contains === 'string') {
    conds.push(`(t.title ILIKE ${add(`%${input.text_contains}%`)} OR t.description ILIKE $${params.length})`);
  }

  const whereSQL = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  const rows = await query(
    `SELECT t.id, t.title, t.status, t.priority,
            t.due_date::text, t.assignee,
            (SELECT COUNT(*)::int FROM tax_ops_tasks s WHERE s.parent_task_id = t.id) AS subtask_total,
            (SELECT COUNT(*)::int FROM tax_ops_tasks s WHERE s.parent_task_id = t.id AND s.status = 'done') AS subtask_done,
            e.legal_name AS related_entity_name,
            CASE WHEN f.id IS NOT NULL
                 THEN (SELECT ent.legal_name FROM tax_obligations ob
                        JOIN tax_entities ent ON ent.id = ob.entity_id
                        WHERE ob.id = f.obligation_id) || ' · ' || f.period_label
                 ELSE NULL END AS related_filing_label
       FROM tax_ops_tasks t
       LEFT JOIN tax_entities e ON e.id = t.related_entity_id
       LEFT JOIN tax_filings f  ON f.id = t.related_filing_id
       ${whereSQL}
      ORDER BY
        CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1
                        WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
        t.due_date ASC NULLS LAST
      LIMIT ${ROW_LIMIT}`,
    params,
  );
  return rows;
}

async function findRecord(input: ToolInput) {
  const q = typeof input.query === 'string' ? input.query.trim() : '';
  if (!q) return [];
  const type = typeof input.type === 'string' ? input.type : 'any';
  const like = `%${q}%`;
  const results: Array<{ type: string; id: string; label: string; sublabel?: string }> = [];

  if (type === 'any' || type === 'entity') {
    const rows = await query<{ id: string; legal_name: string; group_name: string | null }>(
      `SELECT e.id, e.legal_name, g.name AS group_name
         FROM tax_entities e
         LEFT JOIN tax_client_groups g ON g.id = e.client_group_id
        WHERE (e.legal_name ILIKE $1 OR e.vat_number ILIKE $1)
          AND e.is_active = TRUE
        LIMIT 5`,
      [like],
    );
    for (const r of rows) results.push({ type: 'entity', id: r.id, label: r.legal_name, sublabel: r.group_name ?? undefined });
  }

  if (type === 'any' || type === 'filing') {
    const rows = await query<{
      id: string; entity_name: string; tax_type: string; period_label: string; status: string;
    }>(
      `SELECT f.id, e.legal_name AS entity_name, o.tax_type, f.period_label, f.status
         FROM tax_filings f
         JOIN tax_obligations o ON o.id = f.obligation_id
         JOIN tax_entities e    ON e.id = o.entity_id
        WHERE e.legal_name ILIKE $1 OR f.period_label ILIKE $1
        LIMIT 5`,
      [like],
    );
    for (const r of rows) {
      results.push({
        type: 'filing', id: r.id,
        label: `${r.entity_name} · ${r.tax_type} · ${r.period_label}`,
        sublabel: r.status,
      });
    }
  }

  if (type === 'any' || type === 'task') {
    const rows = await query<{ id: string; title: string; status: string; priority: string }>(
      `SELECT id, title, status, priority
         FROM tax_ops_tasks
        WHERE title ILIKE $1 OR description ILIKE $1
        LIMIT 5`,
      [like],
    );
    for (const r of rows) {
      results.push({ type: 'task', id: r.id, label: r.title, sublabel: `${r.status} · ${r.priority}` });
    }
  }

  return results.slice(0, 10);
}
