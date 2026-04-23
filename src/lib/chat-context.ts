// ════════════════════════════════════════════════════════════════════════
// Chat context builder — composes the system prompt for /api/chat calls.
//
// Job: take the current page context (entity id, declaration id) and
// turn it into a focused, legally-grounded system prompt that the model
// can answer from. Never stuffs everything in — that wastes tokens and
// degrades attention. Instead: compact legal index + the specific
// entity/declaration the user is currently looking at.
//
// Returned prompt structure:
//
//   [role] You are cifra's in-product assistant …
//   [guardrails] Always cite …
//   [legal index] ID · citation · subject (one line each)
//   [current context] entity + declaration snapshot (if on that page)
//
// Size target: ~1,500 tokens. Anthropic caches this between turns so
// subsequent messages pay only output cost.
// ════════════════════════════════════════════════════════════════════════

import { queryOne, query } from '@/lib/db';
import {
  LU_LAW, EU_LAW, CIRCULARS, CASES_EU, CASES_LU, PRACTICE,
} from '@/config/legal-sources';

export interface ChatContextInput {
  entity_id?: string | null;
  declaration_id?: string | null;
  /** Current page pathname (e.g. "/crm/companies/xyz"). Used to
   *  decide whether to enable CRM tools + load CRM-specific context. */
  path?: string | null;
  /** Optional CRM entity id in focus (company/contact/opp/matter/invoice).
   *  Extracted client-side from the URL. */
  crm_target_type?: 'crm_company' | 'crm_contact' | 'crm_opportunity' | 'crm_matter' | 'crm_invoice' | null;
  crm_target_id?: string | null;
}

interface EntitySnapshot {
  id: string;
  name: string;
  vat_number: string | null;
  regime: string | null;
  country: string | null;
  activity: string | null;
  vat_status: string | null;
}

interface DeclarationSnapshot {
  id: string;
  year: number;
  period: string;
  status: string;
  matricule: string | null;
  total_vat_due: number | null;
  line_count: number;
}

// ─────────────────────────── compact legal index ────────────────────────

function compactIndex(): string {
  const lines: string[] = [];

  const pushGroup = (label: string, map: Record<string, { id: string; citation: string; subject: string; article?: string }>) => {
    lines.push(`\n## ${label}`);
    for (const s of Object.values(map)) {
      const art = s.article ? ` Art. ${s.article}` : '';
      lines.push(`- \`${s.id}\`${art} — ${s.subject}`);
    }
  };

  pushGroup('Luxembourg law', LU_LAW);
  pushGroup('EU law + directives', EU_LAW);
  pushGroup('AED circulars', CIRCULARS);
  pushGroup('CJEU / EU case law', CASES_EU);
  pushGroup('LU case law', CASES_LU);
  pushGroup('Market practice', PRACTICE);

  return lines.join('\n');
}

// Cache the compact index — it's static data, regenerating on every
// request wastes CPU. Recomputed only if the module is reloaded.
let _cachedIndex: string | null = null;
function getCachedIndex(): string {
  if (_cachedIndex === null) _cachedIndex = compactIndex();
  return _cachedIndex;
}

// ─────────────────────────── per-request context ────────────────────────

async function loadEntity(entityId: string): Promise<EntitySnapshot | null> {
  try {
    return await queryOne<EntitySnapshot>(
      `SELECT id, name, vat_number, regime, country, activity, vat_status
         FROM entities
        WHERE id = $1`,
      [entityId],
    );
  } catch {
    return null;
  }
}

async function loadDeclaration(declarationId: string): Promise<DeclarationSnapshot | null> {
  try {
    const decl = await queryOne<Omit<DeclarationSnapshot, 'line_count'>>(
      `SELECT id, year, period, status, matricule, total_vat_due
         FROM declarations
        WHERE id = $1`,
      [declarationId],
    );
    if (!decl) return null;

    const rows = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM invoice_lines l
         JOIN invoices i ON l.invoice_id = i.id
        WHERE i.declaration_id = $1`,
      [declarationId],
    );
    const line_count = Number(rows[0]?.count ?? 0);
    return { ...decl, line_count };
  } catch {
    return null;
  }
}

function renderEntity(e: EntitySnapshot): string {
  return [
    `- name: ${e.name}`,
    `- VAT number: ${e.vat_number ?? '(none)'}`,
    `- regime: ${e.regime ?? '(unknown)'}`,
    `- country: ${e.country ?? 'LU'}`,
    `- activity: ${e.activity ?? '(unknown)'}`,
    `- VAT status: ${e.vat_status ?? 'registered'}`,
  ].join('\n');
}

function renderDeclaration(d: DeclarationSnapshot): string {
  return [
    `- year/period: ${d.year} ${d.period}`,
    `- status: ${d.status}`,
    `- matricule: ${d.matricule ?? '(none)'}`,
    `- line count: ${d.line_count}`,
    `- current computed VAT due: €${(d.total_vat_due ?? 0).toFixed(2)}`,
  ].join('\n');
}

// ─────────────────────────── CRM context loader ─────────────────────────

// Small, focused snapshot of the CRM record in focus. We DO NOT load
// full listings here — tool-calling handles queries. Snapshot is for
// "this is what the user is currently looking at" orientation only.
async function loadCrmSnapshot(
  type: NonNullable<ChatContextInput['crm_target_type']>,
  id: string,
): Promise<string | null> {
  try {
    if (type === 'crm_company') {
      const r = await queryOne<{
        id: string; company_name: string; classification: string | null;
        country: string | null; industry: string | null;
      }>(
        `SELECT id, company_name, classification, country, industry
           FROM crm_companies WHERE id = $1 AND deleted_at IS NULL`,
        [id],
      );
      return r ? `Company: ${r.company_name} (${r.classification ?? '—'}${r.country ? ` · ${r.country}` : ''}${r.industry ? ` · ${r.industry}` : ''})` : null;
    }
    if (type === 'crm_contact') {
      const r = await queryOne<{
        id: string; full_name: string; job_title: string | null;
        email: string | null; lifecycle_stage: string | null;
        engagement_level: string | null; engagement_override: string | null;
      }>(
        `SELECT id, full_name, job_title, email, lifecycle_stage,
                engagement_level, engagement_override
           FROM crm_contacts WHERE id = $1 AND deleted_at IS NULL`,
        [id],
      );
      if (!r) return null;
      const eng = r.engagement_override ?? r.engagement_level ?? '—';
      return `Contact: ${r.full_name}${r.job_title ? ` · ${r.job_title}` : ''}${r.email ? ` · ${r.email}` : ''} · lifecycle=${r.lifecycle_stage ?? '—'} · engagement=${eng}`;
    }
    if (type === 'crm_opportunity') {
      const r = await queryOne<{
        id: string; name: string; stage: string;
        estimated_value_eur: string | null; probability_pct: number | null;
        estimated_close_date: string | null; client_name: string | null;
      }>(
        `SELECT o.id, o.name, o.stage, o.estimated_value_eur::text,
                o.probability_pct, o.estimated_close_date::text,
                c.company_name AS client_name
           FROM crm_opportunities o
           LEFT JOIN crm_companies c ON c.id = o.company_id
          WHERE o.id = $1 AND o.deleted_at IS NULL`,
        [id],
      );
      if (!r) return null;
      return `Opportunity: ${r.name} · ${r.stage} · ${r.client_name ?? '—'}${r.estimated_value_eur ? ` · €${Number(r.estimated_value_eur).toFixed(0)}` : ''}${r.probability_pct !== null ? ` (${r.probability_pct}%)` : ''}${r.estimated_close_date ? ` · close ${r.estimated_close_date}` : ''}`;
    }
    if (type === 'crm_matter') {
      const r = await queryOne<{
        id: string; matter_reference: string; title: string; status: string;
        practice_areas: string[] | null; fee_type: string | null;
        opening_date: string | null; client_name: string | null;
      }>(
        `SELECT m.id, m.matter_reference, m.title, m.status, m.practice_areas,
                m.fee_type, m.opening_date::text, c.company_name AS client_name
           FROM crm_matters m
           LEFT JOIN crm_companies c ON c.id = m.client_company_id
          WHERE m.id = $1 AND m.deleted_at IS NULL`,
        [id],
      );
      if (!r) return null;
      return `Matter: ${r.matter_reference} ${r.title} · ${r.status} · ${r.client_name ?? '—'}${(r.practice_areas ?? []).length ? ` · ${(r.practice_areas ?? []).join('/')}` : ''}${r.fee_type ? ` · fee=${r.fee_type}` : ''}`;
    }
    if (type === 'crm_invoice') {
      const r = await queryOne<{
        id: string; invoice_number: string; status: string;
        amount_incl_vat: string | null; outstanding: string | null;
        issue_date: string | null; due_date: string | null;
        client_name: string | null;
      }>(
        `SELECT i.id, i.invoice_number, i.status, i.amount_incl_vat::text,
                i.outstanding::text, i.issue_date::text, i.due_date::text,
                c.company_name AS client_name
           FROM crm_billing_invoices i
           LEFT JOIN crm_companies c ON c.id = i.company_id
          WHERE i.id = $1`,
        [id],
      );
      if (!r) return null;
      return `Invoice: ${r.invoice_number} · ${r.status} · ${r.client_name ?? '—'}${r.amount_incl_vat ? ` · €${Number(r.amount_incl_vat).toFixed(2)}` : ''}${Number(r.outstanding ?? 0) > 0 ? ` · outstanding €${Number(r.outstanding).toFixed(2)}` : ''}${r.due_date ? ` · due ${r.due_date}` : ''}`;
    }
  } catch { /* ignore — context failure degrades to no snapshot */ }
  return null;
}

// ─────────────────────────────── public API ─────────────────────────────

/** True when the current page is within /crm. Enables CRM tool-calling
 *  + CRM-flavoured guidance in the system prompt. */
export function isCrmPath(path?: string | null): boolean {
  return typeof path === 'string' && (path === '/crm' || path.startsWith('/crm/'));
}

export async function buildSystemPrompt(input: ChatContextInput): Promise<string> {
  const entity = input.entity_id ? await loadEntity(input.entity_id) : null;
  const declaration = input.declaration_id ? await loadDeclaration(input.declaration_id) : null;
  const crmSnapshot = input.crm_target_type && input.crm_target_id
    ? await loadCrmSnapshot(input.crm_target_type, input.crm_target_id)
    : null;
  const onCrm = isCrmPath(input.path);

  const parts: string[] = [];

  // ── Role + guardrails ──
  parts.push(`You are cifra's in-product assistant.

cifra is a Luxembourg tax & compliance workspace. Today it covers
VAT preparation (LTVA, eCDF XML, EC Sales List) and AED communications;
the roadmap extends to fund-tax filings, Peppol e-invoicing (ViDA),
and related regulatory obligations. Users come from Big 4 firms,
boutique tax advisors, law firms, fiduciaries, and in-house teams —
anyone who has to prepare and review Luxembourg filings. They know
the domain; you're here to save them time, not to lecture.

## How to answer

- **Be concise.** One screen, not a treatise. Most questions need
  2-6 sentences.
- **Cite legal basis** whenever you make a VAT-treatment claim. Use
  the IDs from the legal index below — format like \`[LTVA Art. 44§1 d]\`
  or \`[CIRCULAR 783]\`. These are rendered as clickable pills in the UI.
- **Luxembourg default.** Unless the user specifies otherwise, all
  questions are about Luxembourg VAT practice.
- **Answer in the user's language.** Spanish, English, French, or German.
  Match the language of the most recent user message.
- **Say "I don't know"** when genuinely unsure. Do not fabricate CJEU
  cases or article numbers.
- **Never give tax advice as a legal opinion.** You can explain how a
  rule applies but the human reviewer is accountable.

## Data honesty

- If the user asks about data you don't have in context (e.g. "what
  did you classify invoice #42 as?"), say so plainly and suggest
  where in the app to look.
- If the current context is missing, ask which entity/declaration they
  mean rather than guessing.
`);

  // ── Legal index ──
  parts.push(`\n## Legal source index (cite these IDs)
${getCachedIndex()}
`);

  // ── Current page context ──
  if (entity || declaration || crmSnapshot) {
    parts.push('\n## Current context (what the user is looking at)');
    if (entity) {
      parts.push(`\n### Entity / Client\n${renderEntity(entity)}`);
    }
    if (declaration) {
      parts.push(`\n### Declaration\n${renderDeclaration(declaration)}`);
    }
    if (crmSnapshot) {
      parts.push(`\n### CRM record\n${crmSnapshot}`);
    }
  } else {
    parts.push('\n## Current context\nNo specific entity, declaration, or CRM record in focus. Ask the user which they mean if needed.');
  }

  // ── CRM-mode guidance ──
  // When the user is inside /crm, they're asking sales-ops / relationship
  // questions — not VAT questions. Override the default VAT framing.
  if (onCrm) {
    parts.push(`
## CRM mode (user is inside /crm)

The user is managing their client book, pipeline, matters, billing. VAT / legal
citations are rarely what they want here. Instead:

- **Use the CRM tools** provided (\`crm_query_companies\`, \`crm_query_contacts\`,
  \`crm_query_opportunities\`, \`crm_query_matters\`, \`crm_query_invoices\`,
  \`crm_find_record\`) to answer any question about their data. Don't guess
  — query.
- Prefer **one precise tool call** with filters over multiple broad ones.
  Example: for "Key Accounts I haven't called in 60 days", call
  \`crm_query_companies({ classification: 'key_account', dormant_since_days: 60 })\`,
  not a broad fetch then filter-in-your-head.
- **Quote numbers + names** from tool results verbatim — no rounding, no
  fabrication. If a field is empty, say so.
- **Be concise.** CRM answers are usually a short list + a one-line insight,
  not a memo.
- **Read-only.** You cannot create, edit, or delete records. Suggest the user
  do it via the UI (mention the relevant page path, e.g. "Mark this at
  /crm/contacts/[id] → Edit").
- **Currency**: amounts are EUR unless the invoice's \`currency\` field says
  otherwise.
`);
  }

  return parts.join('\n');
}
