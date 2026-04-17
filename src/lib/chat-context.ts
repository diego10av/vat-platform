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

// ─────────────────────────────── public API ─────────────────────────────

export async function buildSystemPrompt(input: ChatContextInput): Promise<string> {
  const entity = input.entity_id ? await loadEntity(input.entity_id) : null;
  const declaration = input.declaration_id ? await loadDeclaration(input.declaration_id) : null;

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
  if (entity || declaration) {
    parts.push('\n## Current context (what the user is looking at)');
    if (entity) {
      parts.push(`\n### Entity / Client\n${renderEntity(entity)}`);
    }
    if (declaration) {
      parts.push(`\n### Declaration\n${renderDeclaration(declaration)}`);
    }
  } else {
    parts.push('\n## Current context\nNo specific entity or declaration in focus. Ask the user which they mean if needed.');
  }

  return parts.join('\n');
}
