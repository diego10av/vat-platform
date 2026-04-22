// ════════════════════════════════════════════════════════════════════════
// Import Notion CRM → cifra Supabase (stint 25).
//
// One-shot migration tool. Reads the 6 databases of Diego's Notion CRM
// (Companies / Contacts / Opportunities / Matters / Activities / Billing)
// via the Notion official SDK and writes them into the crm_* tables in
// Supabase, converting property types + enum values to cifra's
// snake_case conventions.
//
// Usage:
//   # dry-run (counts + validation, no DB writes)
//   npx tsx scripts/import-notion-crm.ts --dry-run
//
//   # real import (writes to Supabase)
//   npx tsx scripts/import-notion-crm.ts
//
// Required env vars (in .env.local):
//   NOTION_TOKEN       — integration token from notion.so/my-integrations
//   DATABASE_URL       — cifra's Postgres connection string (already set)
//
// Setup for Diego (one-time, ~3 minutes):
//   1. https://www.notion.so/my-integrations → New integration
//      Name: "cifra import", Type: Internal, Workspace: <your workspace>
//      Capabilities: Read content (enough for this script)
//   2. Copy the "Internal Integration Secret" (starts with ntn_)
//   3. Add to .env.local: NOTION_TOKEN=ntn_...
//   4. Open the CRM page in Notion → ... menu → Connect to → cifra import
//      This grants the integration read access to the CRM subtree.
//   5. Run: npx tsx scripts/import-notion-crm.ts --dry-run
//
// Idempotency:
//   Every cifra row gets a notion_page_id column. Re-running the script
//   does an UPSERT — rows that already exist are updated, new rows are
//   inserted. Safe to run multiple times.
//
// Data handling:
//   Rows read from Notion go straight to Diego's Supabase. Nothing real
//   lands in fixtures, commits, or chat. The script prints aggregate
//   counts only (no names / emails / amounts).
// ════════════════════════════════════════════════════════════════════════

import 'dotenv/config';
import { Client } from '@notionhq/client';
import { execute, query, generateId } from '../src/lib/db';

// Data source IDs captured from MCP fetch on 2026-04-23.
const DS = {
  companies:     '31b401eb-dfc7-80cd-ac91-000b132eacdb',
  contacts:      '31b401eb-dfc7-807b-a114-000b784743d3',
  opportunities: '31b401eb-dfc7-80eb-810f-000b8c2a35a7',
  matters:       '31b401eb-dfc7-8033-bd79-000b400d065f',
  activities:    '31b401eb-dfc7-8018-9cbe-000b92ea422e',
  billing:       '31b401eb-dfc7-80b8-ba4a-000b0f0bef0f',
} as const;

// ─────────────────── enum mappings (Notion label → snake_case) ────────

const MAP_CLASSIFICATION: Record<string, string> = {
  '🔑 Key Account': 'key_account',
  '⭐ Standard':    'standard',
  '🔁 Occasional':  'occasional',
  'Not a client yet': 'not_yet_client',
};

const MAP_ENGAGEMENT: Record<string, string> = {
  '🟢 Active':  'active',
  '🟡 Dormant': 'dormant',
  '🔴 Lapsed':  'lapsed',
};

const MAP_OPP_STAGE: Record<string, string> = {
  '🔵 Lead Identified': 'lead_identified',
  '🟡 Initial Contact': 'initial_contact',
  '🟠 Meeting Held':    'meeting_held',
  '🔴 Proposal sent':   'proposal_sent',
  '🟣 In Negotiation':  'in_negotiation',
  '✅ Won':             'won',
  '❌ Lost':            'lost',
};

const MAP_MATTER_STATUS: Record<string, string> = {
  '🟢 Active':   'active',
  '🟡 On Hold':  'on_hold',
  '✅ Closed':   'closed',
  '🗃️ Archived': 'archived',
};

const MAP_BILLING_STATUS: Record<string, string> = {
  '🔴 Overdue': 'overdue',
  '✅ Paid':    'paid',
  '📤 Sent':    'sent',
  '📝 Draft':   'draft',
};

const MAP_ACTIVITY_TYPE: Record<string, string> = {
  '📞 Call':     'call',
  '🤝 Meeting':  'meeting',
  '📧 Email':    'email',
  '📄 Proposal': 'proposal',
  '⚖️ Hearing':  'hearing',
  '⏰ Deadline': 'deadline',
  '📝 Other':    'other',
};

const MAP_FEE_TYPE: Record<string, string> = {
  'Retainer':    'retainer',
  'Success fee': 'success_fee',
  'Fixed fee':   'fixed_fee',
  'Hourly':      'hourly',
};

const MAP_SIZE: Record<string, string> = {
  'Large cap':  'large_cap',
  'Mid-market': 'mid_market',
  'SME':        'sme',
  'Start-up':   'startup',
};

const MAP_INDUSTRY: Record<string, string> = {
  'Family Office':    'family_office',
  'Service Provider': 'service_provider',
  'Law firm':         'law_firm',
  'Private Wealth':   'private_wealth',
  'Real Estate':      'real_estate',
  'Banking':          'banking',
  'Private Equity':   'private_equity',
};

const MAP_PRACTICE: Record<string, string> = {
  'Real Estate':     'real_estate',
  'Litigation':      'litigation',
  'Employment':      'employment',
  'Fund/Regulatory': 'fund_regulatory',
  'Tax':             'tax',
  'M&A':             'm_a',
};

const MAP_SOURCE: Record<string, string> = {
  'Service provider': 'service_provider',
  'Friend':           'friend',
  'Other':            'other',
  'Cold call/email':  'cold_call',
  'Linkedin':         'linkedin',
  'Event':            'event',
  'Website':          'website',
  'Referral':         'referral',
};

const MAP_COUNTRY: Record<string, string> = {
  'Luxembourg':     'LU',
  'France':         'FR',
  'United Kingdom': 'GB',
  'Italy':          'IT',
  'Spain':          'ES',
  'Germany':        'DE',
  'Portugal':       'PT',
  'Brazil':         'BR',
  'Hong Kong':      'HK',
  'Finland':        'FI',
};

const MAP_PAYMENT_METHOD: Record<string, string> = {
  'Bank transfer': 'bank_transfer',
  'Direct debit':  'direct_debit',
  'Other':         'other',
};

const MAP_LOSS_REASON: Record<string, string> = {
  'No response':          'no_response',
  'Competitor':           'competitor',
  'Conflict of interest': 'conflict_of_interest',
  'Price':                'price',
  'Other':                'other',
};

const MAP_AREA_OF_INTEREST: Record<string, string> = {
  'Real Estate':     'real_estate',
  'Litigation':      'litigation',
  'Fund/Regulatory': 'fund_regulatory',
  'Tax':             'tax',
  'M&A':             'm_a',
};

/**
 * The Notion "Type" column in Contacts mixes lifecycle stage with role.
 * Split into our two-column convention.
 */
function splitContactType(notionType: string | null): { lifecycle: string | null; role: string | null } {
  if (!notionType) return { lifecycle: null, role: null };
  switch (notionType) {
    case 'Lead':            return { lifecycle: 'lead', role: null };
    case 'Prospect':        return { lifecycle: 'prospect', role: null };
    case 'Active client':   return { lifecycle: 'customer', role: null };
    case 'Inactive client': return { lifecycle: 'former_customer', role: null };
    case 'Referrer':        return { lifecycle: null, role: 'referrer' };
    case 'Opposing party':  return { lifecycle: null, role: 'opposing_party' };
    default:                return { lifecycle: null, role: null };
  }
}

// ─────────────────── Notion property readers ─────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NotionProp = any;

function readTitle(p: NotionProp): string | null {
  if (!p || p.type !== 'title' || !Array.isArray(p.title)) return null;
  const txt = p.title.map((t: { plain_text: string }) => t.plain_text).join('').trim();
  return txt || null;
}

function readRichText(p: NotionProp): string | null {
  if (!p || p.type !== 'rich_text' || !Array.isArray(p.rich_text)) return null;
  const txt = p.rich_text.map((t: { plain_text: string }) => t.plain_text).join('').trim();
  return txt || null;
}

function readSelect(p: NotionProp): string | null {
  if (!p || p.type !== 'select' || !p.select) return null;
  return (p.select as { name: string }).name;
}

function readMultiSelect(p: NotionProp): string[] {
  if (!p || p.type !== 'multi_select' || !Array.isArray(p.multi_select)) return [];
  return (p.multi_select as Array<{ name: string }>).map(s => s.name);
}

function readDate(p: NotionProp): string | null {
  if (!p || p.type !== 'date' || !p.date) return null;
  const start: string = p.date.start;
  // Keep as ISO — Postgres accepts both date and timestamp.
  return start ?? null;
}

function readNumber(p: NotionProp): number | null {
  if (!p || p.type !== 'number') return null;
  return p.number === null || p.number === undefined ? null : Number(p.number);
}

function readCheckbox(p: NotionProp): boolean {
  if (!p || p.type !== 'checkbox') return false;
  return !!p.checkbox;
}

function readEmail(p: NotionProp): string | null {
  if (!p || p.type !== 'email') return null;
  return p.email ?? null;
}

function readPhone(p: NotionProp): string | null {
  if (!p || p.type !== 'phone_number') return null;
  return p.phone_number ?? null;
}

function readUrl(p: NotionProp): string | null {
  if (!p || p.type !== 'url') return null;
  return p.url ?? null;
}

function readRelationIds(p: NotionProp): string[] {
  if (!p || p.type !== 'relation' || !Array.isArray(p.relation)) return [];
  return (p.relation as Array<{ id: string }>).map(r => r.id);
}

function readPeopleIds(p: NotionProp): string[] {
  if (!p || p.type !== 'people' || !Array.isArray(p.people)) return [];
  return (p.people as Array<{ id: string }>).map(u => u.id);
}

function readFormulaNumber(p: NotionProp): number | null {
  if (!p || p.type !== 'formula' || !p.formula) return null;
  const f = p.formula;
  if (f.type === 'number') return f.number === null || f.number === undefined ? null : Number(f.number);
  return null;
}

function mapEnum(raw: string | null, dict: Record<string, string>, fallback: string | null = null): string | null {
  if (raw === null) return fallback;
  return dict[raw] ?? fallback;
}

function mapEnumArray(raw: string[], dict: Record<string, string>): string[] {
  return raw.map(r => dict[r]).filter((x): x is string => !!x);
}

// ─────────────────── CLI arg parse ───────────────────────────────────

const DRY_RUN = process.argv.includes('--dry-run');

// ─────────────────── Notion client ───────────────────────────────────

if (!process.env.NOTION_TOKEN) {
  console.error('Missing NOTION_TOKEN in env. See script header for setup.');
  process.exit(2);
}
if (!process.env.DATABASE_URL && !DRY_RUN) {
  console.error('Missing DATABASE_URL in env (only required for non-dry-run).');
  process.exit(2);
}

const notion = new Client({ auth: process.env.NOTION_TOKEN });

/** Exhaustive pagination: returns every row of a data source. */
async function fetchAllRows(dataSourceId: string, label: string): Promise<NotionProp[]> {
  const all: NotionProp[] = [];
  let cursor: string | undefined = undefined;
  let page = 0;
  do {
    page += 1;
    // Notion JS SDK v5+ uses dataSources.query; earlier versions use databases.query
    // with the db ID. We support both via the SDK's best-effort discovery.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = notion as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let resp: any;
    if (client.dataSources?.query) {
      resp = await client.dataSources.query({
        data_source_id: dataSourceId,
        start_cursor: cursor,
        page_size: 100,
      });
    } else {
      // Fallback to legacy databases.query using the data source ID as database ID.
      resp = await client.databases.query({
        database_id: dataSourceId,
        start_cursor: cursor,
        page_size: 100,
      });
    }
    all.push(...resp.results);
    cursor = resp.has_more ? resp.next_cursor : undefined;
    process.stderr.write(`  ${label}: fetched page ${page} (${all.length} rows so far)\r`);
  } while (cursor);
  process.stderr.write(`\n`);
  return all;
}

// ─────────────────── UPSERT helpers ──────────────────────────────────

/** Look up cifra id by notion_page_id, or generate + insert later.
 *  Returns a fresh uuid for this notion id if never seen; same uuid on
 *  subsequent calls. */
async function resolveId(
  table: string,
  notionPageId: string,
  cache: Map<string, string>,
): Promise<string> {
  const hit = cache.get(notionPageId);
  if (hit) return hit;
  if (!DRY_RUN) {
    const existing = await query<{ id: string }>(
      `SELECT id FROM ${table} WHERE notion_page_id = $1 LIMIT 1`,
      [notionPageId],
    );
    if (existing[0]?.id) {
      cache.set(notionPageId, existing[0].id);
      return existing[0].id;
    }
  }
  const fresh = generateId();
  cache.set(notionPageId, fresh);
  return fresh;
}

// ─────────────────── Main ────────────────────────────────────────────

async function main() {
  console.log(`\n${DRY_RUN ? '🟡 DRY RUN' : '🔴 REAL IMPORT'} — reading Notion CRM...\n`);

  // Fetch all 6 databases in sequence (Notion rate-limits; no parallel gain).
  console.log('Fetching Notion databases:');
  const companiesRaw    = await fetchAllRows(DS.companies,    'Companies    ');
  const contactsRaw     = await fetchAllRows(DS.contacts,     'Contacts     ');
  const opportunitiesRaw = await fetchAllRows(DS.opportunities, 'Opportunities');
  const mattersRaw      = await fetchAllRows(DS.matters,      'Matters      ');
  const activitiesRaw   = await fetchAllRows(DS.activities,   'Activities   ');
  const billingRaw      = await fetchAllRows(DS.billing,      'Billing      ');

  const counts = {
    companies:    companiesRaw.length,
    contacts:     contactsRaw.length,
    opportunities: opportunitiesRaw.length,
    matters:      mattersRaw.length,
    activities:   activitiesRaw.length,
    billing:      billingRaw.length,
  };
  console.log('\nNotion row counts:');
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v}`);

  // Quality flags (run BEFORE writes — useful in dry-run too).
  console.log('\nData quality checks:');
  const flags: string[] = [];

  const companiesMissingName = companiesRaw.filter(r => !readTitle(r.properties['Company name'])).length;
  if (companiesMissingName) flags.push(`Companies with empty Company name: ${companiesMissingName}`);

  const contactsMissingName = contactsRaw.filter(r => !readTitle(r.properties['Full name'])).length;
  if (contactsMissingName) flags.push(`Contacts with empty Full name: ${contactsMissingName}`);

  const contactsMissingEmail = contactsRaw.filter(r => !readEmail(r.properties['Email'])).length;
  flags.push(`Contacts without email: ${contactsMissingEmail} (informational)`);

  const oppsWithoutStage = opportunitiesRaw.filter(r => !readSelect(r.properties['Stage'])).length;
  if (oppsWithoutStage) flags.push(`Opportunities without Stage: ${oppsWithoutStage}`);

  const mattersWithoutStatus = mattersRaw.filter(r => !readSelect(r.properties['Status'])).length;
  if (mattersWithoutStatus) flags.push(`Matters without Status: ${mattersWithoutStatus}`);

  const activitiesWithoutDate = activitiesRaw.filter(r => !readDate(r.properties['Date'])).length;
  if (activitiesWithoutDate) flags.push(`Activities without Date: ${activitiesWithoutDate}`);

  const billingWithoutAmount = billingRaw.filter(r => readNumber(r.properties['Amount (€) incl. VAT']) === null).length;
  if (billingWithoutAmount) flags.push(`Billing rows without Amount incl VAT: ${billingWithoutAmount}`);

  if (flags.length === 0) console.log('  (no issues detected)');
  else for (const f of flags) console.log(`  · ${f}`);

  if (DRY_RUN) {
    console.log('\n✅ Dry-run complete. No writes performed. Re-run without --dry-run to import.\n');
    return;
  }

  // ───────────── Import begins ─────────────
  const companyIds = new Map<string, string>();    // notion id → cifra id
  const contactIds = new Map<string, string>();
  const opportunityIds = new Map<string, string>();
  const matterIds = new Map<string, string>();

  console.log('\nImporting (UPSERT — idempotent)...');

  // 1. Companies (no external FKs).
  for (const row of companiesRaw) {
    const cifraId = await resolveId('crm_companies', row.id, companyIds);
    const props = row.properties;
    await execute(
      `INSERT INTO crm_companies
         (id, notion_page_id, company_name, country, industry, size, classification,
          website, linkedin_url, tags, notes, lead_counsel, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
       ON CONFLICT (notion_page_id) DO UPDATE SET
         company_name = EXCLUDED.company_name,
         country = EXCLUDED.country,
         industry = EXCLUDED.industry,
         size = EXCLUDED.size,
         classification = EXCLUDED.classification,
         notes = EXCLUDED.notes,
         lead_counsel = EXCLUDED.lead_counsel,
         updated_at = NOW()`,
      [
        cifraId, row.id,
        readTitle(props['Company name']) ?? '(unnamed)',
        mapEnum(readSelect(props['Country']), MAP_COUNTRY),
        mapEnum(readSelect(props['Industry']), MAP_INDUSTRY),
        mapEnum(readSelect(props['Size']), MAP_SIZE),
        mapEnum(readSelect(props['Classification']), MAP_CLASSIFICATION),
        null, null, [],  // website / linkedin_url / tags — not in Notion
        readRichText(props['Notes']),
        readPeopleIds(props['Lead counsel'])[0] ?? null,
      ],
    );
  }
  console.log(`  ✓ crm_companies: ${companiesRaw.length} rows upserted`);

  // 2. Contacts (without referred_by — resolved in pass 2).
  for (const row of contactsRaw) {
    const cifraId = await resolveId('crm_contacts', row.id, contactIds);
    const props = row.properties;
    const { lifecycle, role } = splitContactType(readSelect(props['Type']));
    const consent = readCheckbox(props['GDPR consent']);
    await execute(
      `INSERT INTO crm_contacts
         (id, notion_page_id, full_name, email, phone, linkedin_url, job_title,
          country, lifecycle_stage, role_tags, areas_of_interest, engagement_level,
          source, consent_status, consent_date, next_follow_up, notes, lead_counsel,
          updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW())
       ON CONFLICT (notion_page_id) DO UPDATE SET
         full_name = EXCLUDED.full_name,
         email = EXCLUDED.email,
         phone = EXCLUDED.phone,
         linkedin_url = EXCLUDED.linkedin_url,
         job_title = EXCLUDED.job_title,
         country = EXCLUDED.country,
         lifecycle_stage = EXCLUDED.lifecycle_stage,
         role_tags = EXCLUDED.role_tags,
         areas_of_interest = EXCLUDED.areas_of_interest,
         engagement_level = EXCLUDED.engagement_level,
         source = EXCLUDED.source,
         consent_status = EXCLUDED.consent_status,
         consent_date = EXCLUDED.consent_date,
         next_follow_up = EXCLUDED.next_follow_up,
         notes = EXCLUDED.notes,
         lead_counsel = EXCLUDED.lead_counsel,
         updated_at = NOW()`,
      [
        cifraId, row.id,
        readTitle(props['Full name']) ?? '(unnamed)',
        readEmail(props['Email']),
        readPhone(props['Phone']),
        readUrl(props['Linkedin']),
        readRichText(props['Job Title']),
        mapEnum(readSelect(props['Country']), MAP_COUNTRY),
        lifecycle,
        role ? [role] : [],
        mapEnumArray(readMultiSelect(props['Areas of interest']), MAP_AREA_OF_INTEREST),
        mapEnum(readSelect(props['Engagement level']), MAP_ENGAGEMENT),
        mapEnum(readSelect(props['Source']), MAP_SOURCE),
        consent ? 'explicit' : 'none',
        consent ? new Date().toISOString() : null,
        readDate(props['Next follow-up']),
        readRichText(props['Notes']),
        readPeopleIds(props['Lead counsel'])[0] ?? null,
      ],
    );
  }
  console.log(`  ✓ crm_contacts: ${contactsRaw.length} rows upserted (referred_by pass 2)`);

  // 3. Contact ↔ Company junction from Contacts' "Company" + "Companies (linked)" relations.
  let junctionCount = 0;
  for (const row of contactsRaw) {
    const contactId = contactIds.get(row.id);
    if (!contactId) continue;
    const props = row.properties;
    const primaryCompanies = readRelationIds(props['Company']);
    const linkedCompanies = readRelationIds(props['Companies (linked)']);
    const allCompanies = new Set([...primaryCompanies, ...linkedCompanies]);
    const primarySet = new Set(primaryCompanies);
    for (const notionCompanyId of allCompanies) {
      const companyId = companyIds.get(notionCompanyId);
      if (!companyId) continue;
      const isPrimary = primarySet.has(notionCompanyId);
      const role = isPrimary ? 'main_poc' : 'assistant';
      await execute(
        `INSERT INTO crm_contact_companies (id, contact_id, company_id, role, is_primary)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (contact_id, company_id, role) DO NOTHING`,
        [generateId(), contactId, companyId, role, isPrimary],
      );
      junctionCount += 1;
    }
  }
  console.log(`  ✓ crm_contact_companies: ${junctionCount} junction rows`);

  // 4. Opportunities.
  for (const row of opportunitiesRaw) {
    const cifraId = await resolveId('crm_opportunities', row.id, opportunityIds);
    const props = row.properties;
    const companyRelations = readRelationIds(props['Company']);
    const contactRelations = readRelationIds(props['Contact']);
    await execute(
      `INSERT INTO crm_opportunities
         (id, notion_page_id, name, company_id, primary_contact_id, stage,
          practice_areas, source, estimated_value_eur, probability_pct,
          first_contact_date, estimated_close_date, loss_reason, bd_lawyer, notes, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())
       ON CONFLICT (notion_page_id) DO UPDATE SET
         name = EXCLUDED.name,
         company_id = EXCLUDED.company_id,
         primary_contact_id = EXCLUDED.primary_contact_id,
         stage = EXCLUDED.stage,
         practice_areas = EXCLUDED.practice_areas,
         source = EXCLUDED.source,
         estimated_value_eur = EXCLUDED.estimated_value_eur,
         probability_pct = EXCLUDED.probability_pct,
         first_contact_date = EXCLUDED.first_contact_date,
         estimated_close_date = EXCLUDED.estimated_close_date,
         loss_reason = EXCLUDED.loss_reason,
         bd_lawyer = EXCLUDED.bd_lawyer,
         notes = EXCLUDED.notes,
         updated_at = NOW()`,
      [
        cifraId, row.id,
        readTitle(props['Name']) ?? '(unnamed opportunity)',
        companyRelations[0] ? companyIds.get(companyRelations[0]) ?? null : null,
        contactRelations[0] ? contactIds.get(contactRelations[0]) ?? null : null,
        mapEnum(readSelect(props['Stage']), MAP_OPP_STAGE) ?? 'lead_identified',
        mapEnumArray(readMultiSelect(props['Practice area']), MAP_PRACTICE),
        mapEnum(readSelect(props['Source']), MAP_SOURCE),
        readNumber(props['Estimated value (€)']),
        readNumber(props['Probability (%)']) !== null
          ? Math.round(Number(readNumber(props['Probability (%)'])) * 100)
          : null,
        readDate(props['First contact date']),
        readDate(props['Estimated close date']),
        mapEnum(readSelect(props['Loss reason']), MAP_LOSS_REASON),
        readPeopleIds(props['BD Lawyer'])[0] ?? null,
        readRichText(props['Notes']),
      ],
    );
  }
  console.log(`  ✓ crm_opportunities: ${opportunitiesRaw.length} rows upserted`);

  // 5. Matters.
  for (const row of mattersRaw) {
    const cifraId = await resolveId('crm_matters', row.id, matterIds);
    const props = row.properties;
    const clientRelations = readRelationIds(props['Client company']);
    const contactRelations = readRelationIds(props['Person of contact']);
    const oppRelations = readRelationIds(props['Source opportunity']);
    const matterRef = readTitle(props['Matter reference']) ?? `IMPORTED-${row.id.slice(0, 8)}`;
    await execute(
      `INSERT INTO crm_matters
         (id, notion_page_id, matter_reference, title, client_company_id,
          primary_contact_id, source_opportunity_id, status, practice_areas,
          fee_type, hourly_rate_eur, opening_date, closing_date,
          conflict_check_done, lead_counsel, team_members, documents_link, notes, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW())
       ON CONFLICT (notion_page_id) DO UPDATE SET
         matter_reference = EXCLUDED.matter_reference,
         title = EXCLUDED.title,
         client_company_id = EXCLUDED.client_company_id,
         primary_contact_id = EXCLUDED.primary_contact_id,
         source_opportunity_id = EXCLUDED.source_opportunity_id,
         status = EXCLUDED.status,
         practice_areas = EXCLUDED.practice_areas,
         fee_type = EXCLUDED.fee_type,
         hourly_rate_eur = EXCLUDED.hourly_rate_eur,
         opening_date = EXCLUDED.opening_date,
         closing_date = EXCLUDED.closing_date,
         conflict_check_done = EXCLUDED.conflict_check_done,
         lead_counsel = EXCLUDED.lead_counsel,
         team_members = EXCLUDED.team_members,
         documents_link = EXCLUDED.documents_link,
         notes = EXCLUDED.notes,
         updated_at = NOW()`,
      [
        cifraId, row.id,
        matterRef,
        matterRef,  // title = reference when no separate title exists
        clientRelations[0] ? companyIds.get(clientRelations[0]) ?? null : null,
        contactRelations[0] ? contactIds.get(contactRelations[0]) ?? null : null,
        oppRelations[0] ? opportunityIds.get(oppRelations[0]) ?? null : null,
        mapEnum(readSelect(props['Status']), MAP_MATTER_STATUS) ?? 'active',
        mapEnumArray(readMultiSelect(props['Practice area']), MAP_PRACTICE),
        mapEnum(readSelect(props['Fee type']), MAP_FEE_TYPE),
        readNumber(props['Hourly Rate (€)']),
        readDate(props['Opening date']),
        readDate(props['Closing date']),
        readCheckbox(props['Conflict check done']),
        readPeopleIds(props['Lead counsel'])[0] ?? null,
        readPeopleIds(props['Team']),
        readUrl(props['Documents link']),
        readRichText(props['Notes']),
      ],
    );
  }
  console.log(`  ✓ crm_matters: ${mattersRaw.length} rows upserted`);

  // 6. Activities.
  for (const row of activitiesRaw) {
    const cifraId = generateId();
    const props = row.properties;
    const primaryContactRel = readRelationIds(props['Contact']);
    const linkedContactRel = readRelationIds(props['Contacts (linked)']);
    const oppRel = readRelationIds(props['Opportunity']);
    const matterRel = readRelationIds(props['Matter']);
    const activityDate = readDate(props['Date']);
    if (!activityDate) continue;  // NOT NULL column; skip
    await execute(
      `INSERT INTO crm_activities
         (id, notion_page_id, name, activity_type, activity_date, duration_hours,
          billable, lawyer, primary_contact_id, opportunity_id, matter_id, notes, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
       ON CONFLICT (notion_page_id) DO UPDATE SET
         name = EXCLUDED.name,
         activity_type = EXCLUDED.activity_type,
         activity_date = EXCLUDED.activity_date,
         duration_hours = EXCLUDED.duration_hours,
         billable = EXCLUDED.billable,
         lawyer = EXCLUDED.lawyer,
         primary_contact_id = EXCLUDED.primary_contact_id,
         opportunity_id = EXCLUDED.opportunity_id,
         matter_id = EXCLUDED.matter_id,
         notes = EXCLUDED.notes,
         updated_at = NOW()`,
      [
        cifraId, row.id,
        readTitle(props['Name']) ?? '(activity)',
        mapEnum(readSelect(props['Type']), MAP_ACTIVITY_TYPE) ?? 'other',
        activityDate,
        readNumber(props['Duration (h)']),
        readCheckbox(props['Billable']),
        readPeopleIds(props['Lawyer'])[0] ?? null,
        primaryContactRel[0] ? contactIds.get(primaryContactRel[0]) ?? null : null,
        oppRel[0] ? opportunityIds.get(oppRel[0]) ?? null : null,
        matterRel[0] ? matterIds.get(matterRel[0]) ?? null : null,
        readRichText(props['Notes']),
      ],
    );
    // Resolve actual cifra activity ID (handles UPSERT existing).
    const row2 = await query<{ id: string }>(
      `SELECT id FROM crm_activities WHERE notion_page_id = $1`,
      [row.id],
    );
    const activityCifraId = row2[0]?.id;
    if (!activityCifraId) continue;

    // Extra contacts via junction — only the "linked" relation (primary already on row).
    for (const notionContactId of linkedContactRel) {
      const cId = contactIds.get(notionContactId);
      if (!cId) continue;
      await execute(
        `INSERT INTO crm_activity_contacts (activity_id, contact_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [activityCifraId, cId],
      );
    }
  }
  console.log(`  ✓ crm_activities: ${activitiesRaw.length} rows upserted`);

  // 7. Billing.
  for (const row of billingRaw) {
    const cifraId = generateId();
    const props = row.properties;
    const clientRel = readRelationIds(props['Client']);
    const matterRel = readRelationIds(props['Matter']);
    const contactRel = readRelationIds(props['Person of contact']);
    const amountIncl = readNumber(props['Amount (€) incl. VAT']);
    const amountExcl = readNumber(props['Amount (€) excl. VAT']);
    if (amountIncl === null || amountExcl === null) continue;  // required
    const issueDate = readDate(props['Issue date']);
    const year = issueDate ? new Date(issueDate).getFullYear() : new Date().getFullYear();
    // Generate invoice number based on title + sequence; fallback to unique per import.
    const existingInv = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM crm_billing_invoices WHERE invoice_number LIKE $1`,
      [`MP-${year}-%`],
    );
    const seq = Number(existingInv[0]?.count ?? 0) + 1;
    const fallbackInv = `MP-${year}-${String(seq).padStart(4, '0')}`;
    // If already imported, reuse existing invoice_number.
    const prior = await query<{ invoice_number: string; id: string }>(
      `SELECT id, invoice_number FROM crm_billing_invoices WHERE notion_page_id = $1`,
      [row.id],
    );
    const invoiceNumber = prior[0]?.invoice_number ?? fallbackInv;
    const invoiceId = prior[0]?.id ?? cifraId;
    const vatAmount = amountIncl - amountExcl;
    await execute(
      `INSERT INTO crm_billing_invoices
         (id, notion_page_id, invoice_number, company_id, matter_id, primary_contact_id,
          issue_date, due_date, currency, amount_excl_vat, vat_amount, amount_incl_vat,
          status, payment_method, paid_date, notes, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'EUR',$9,$10,$11,$12,$13,$14,$15,NOW())
       ON CONFLICT (notion_page_id) DO UPDATE SET
         company_id = EXCLUDED.company_id,
         matter_id = EXCLUDED.matter_id,
         primary_contact_id = EXCLUDED.primary_contact_id,
         issue_date = EXCLUDED.issue_date,
         due_date = EXCLUDED.due_date,
         amount_excl_vat = EXCLUDED.amount_excl_vat,
         vat_amount = EXCLUDED.vat_amount,
         amount_incl_vat = EXCLUDED.amount_incl_vat,
         status = EXCLUDED.status,
         payment_method = EXCLUDED.payment_method,
         paid_date = EXCLUDED.paid_date,
         notes = EXCLUDED.notes,
         updated_at = NOW()`,
      [
        invoiceId, row.id,
        invoiceNumber,
        clientRel[0] ? companyIds.get(clientRel[0]) ?? null : null,
        matterRel[0] ? matterIds.get(matterRel[0]) ?? null : null,
        contactRel[0] ? contactIds.get(contactRel[0]) ?? null : null,
        issueDate,
        readDate(props['Due date']),
        amountExcl,
        vatAmount >= 0 ? vatAmount : null,
        amountIncl,
        mapEnum(readSelect(props['Status']), MAP_BILLING_STATUS) ?? 'draft',
        mapEnum(readSelect(props['Payment method']), MAP_PAYMENT_METHOD),
        readSelect(props['Status']) === '✅ Paid' ? issueDate : null,  // best-effort
        null,
      ],
    );
  }
  console.log(`  ✓ crm_billing_invoices: ${billingRaw.length} rows upserted`);

  // 8. Pass 2: resolve referred_by_contact_id on contacts.
  let referredCount = 0;
  for (const row of contactsRaw) {
    const props = row.properties;
    const referredBy = readRelationIds(props['Referred by']);
    if (!referredBy[0]) continue;
    const contactId = contactIds.get(row.id);
    const referrerId = contactIds.get(referredBy[0]);
    if (!contactId || !referrerId) continue;
    await execute(
      `UPDATE crm_contacts SET referred_by_contact_id = $1, updated_at = NOW() WHERE id = $2`,
      [referrerId, contactId],
    );
    referredCount += 1;
  }
  console.log(`  ✓ pass 2 — referred_by resolved for ${referredCount} contacts`);

  // Final report.
  console.log('\n✅ Import complete.\n');
  console.log('Row counts in cifra after import:');
  const tables = [
    'crm_companies', 'crm_contacts', 'crm_contact_companies',
    'crm_opportunities', 'crm_matters', 'crm_activities',
    'crm_activity_contacts', 'crm_billing_invoices', 'crm_billing_payments',
  ];
  for (const t of tables) {
    const r = await query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${t}`);
    console.log(`  ${t}: ${r[0]?.count ?? 0}`);
  }
}

main().catch(err => {
  console.error('\n❌ Import failed:', err instanceof Error ? err.stack : err);
  process.exit(1);
});
