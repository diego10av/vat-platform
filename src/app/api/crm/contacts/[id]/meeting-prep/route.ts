import { NextRequest, NextResponse } from 'next/server';
import { queryOne, query, execute, logAudit } from '@/lib/db';
import { apiError } from '@/lib/api-errors';
import { anthropicCreate } from '@/lib/anthropic-wrapper';

// POST /api/crm/contacts/[id]/meeting-prep
//
// Generate a 1-page meeting prep brief for an upcoming call / meeting
// with a contact. Opus 4.7 because this is high-stakes client-facing
// output — the tradeoff on quality beats cost at this cadence.
// Typical brief: 400-600 tokens out @ €15/Mtok output = ~€0.01/call.
//
// Rate-limited: a given contact can only be briefed once per 24 hours.
// This is a soft cap — the endpoint just returns the cached last
// brief if called within the window, avoiding surprise AI costs when
// the user clicks the button twice.
const MODEL = 'claude-opus-4-7';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const contact = await queryOne<{
    id: string; full_name: string; job_title: string | null;
    email: string | null; lifecycle_stage: string | null;
    engagement_level: string | null; engagement_override: string | null;
    last_activity_at: string | null;
    lead_score: number | null; lead_score_reasoning: string | null;
    last_brief_generated_at: string | null;
  }>(
    `SELECT id, full_name, job_title, email, lifecycle_stage,
            engagement_level, engagement_override,
            last_activity_at::text AS last_activity_at,
            lead_score, lead_score_reasoning,
            last_brief_generated_at::text AS last_brief_generated_at
       FROM crm_contacts WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  if (!contact) return apiError('not_found', 'Contact not found.', { status: 404 });

  // Gather context in parallel.
  const [companies, recentActivities, openOpps, invoiceHistory] = await Promise.all([
    query<{ company_name: string; classification: string | null; role: string | null }>(
      `SELECT co.company_name, co.classification, cc.role
         FROM crm_contact_companies cc
         JOIN crm_companies co ON co.id = cc.company_id
        WHERE cc.contact_id = $1 AND co.deleted_at IS NULL
        ORDER BY cc.is_primary DESC`,
      [id],
    ),
    query<{ activity_date: string; activity_type: string; name: string; outcome: string | null }>(
      `SELECT a.activity_date::text, a.activity_type, a.name, a.outcome
         FROM crm_activity_contacts ac
         JOIN crm_activities a ON a.id = ac.activity_id
        WHERE ac.contact_id = $1
        ORDER BY a.activity_date DESC
        LIMIT 10`,
      [id],
    ),
    query<{ name: string; stage: string; estimated_value_eur: string | null; next_action: string | null }>(
      `SELECT name, stage, estimated_value_eur::text, next_action
         FROM crm_opportunities
        WHERE primary_contact_id = $1 AND deleted_at IS NULL
          AND stage NOT IN ('won', 'lost')
        ORDER BY estimated_close_date NULLS LAST`,
      [id],
    ),
    query<{ count: string; total: string; outstanding: string }>(
      `SELECT COUNT(*)::text, COALESCE(SUM(amount_incl_vat), 0)::text AS total,
              COALESCE(SUM(outstanding), 0)::text
         FROM crm_billing_invoices b
         LEFT JOIN crm_contact_companies cc ON cc.company_id = b.company_id
        WHERE cc.contact_id = $1`,
      [id],
    ),
  ]);

  const prompt = buildPrompt(contact, companies, recentActivities, openOpps, invoiceHistory[0] ?? null);

  const message = await anthropicCreate(
    {
      model: MODEL,
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
      system:
`You prepare concise meeting briefs for a senior partner at a Luxembourg private-equity law firm.
Output: single-page markdown brief under 500 words. Sections in this exact order:
- Relationship snapshot (2-3 bullets on tier, history, current engagement)
- Recent context (1-2 paragraphs summarising the last 3-6 months — what's happened, what's on the table)
- Open opportunities + outstanding invoices (bullets only if non-zero)
- 3 specific talking points for the meeting
- 1 clear "next action" recommendation
Tone: direct, partner-to-partner, no filler. Never invent facts not in the input.`,
    },
    { agent: 'other', label: `meeting-prep:${id}` },
  );

  const brief = message.content
    .map(b => b.type === 'text' ? b.text : '')
    .join('').trim();

  // Stash timestamp so the UI can show when it was generated.
  await execute(
    `UPDATE crm_contacts SET last_brief_generated_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [id],
  );
  await logAudit({
    action: 'meeting_brief_generated',
    targetType: 'crm_contact',
    targetId: id,
    field: 'meeting_prep',
    reason: `Meeting prep brief generated for ${contact.full_name}`,
  });

  return NextResponse.json({
    contact_id: id,
    contact_name: contact.full_name,
    generated_at: new Date().toISOString(),
    brief_markdown: brief,
  });
}

interface Contact {
  full_name: string; job_title: string | null; email: string | null;
  lifecycle_stage: string | null; engagement_level: string | null;
  engagement_override: string | null; last_activity_at: string | null;
  lead_score: number | null; lead_score_reasoning: string | null;
}
interface Company { company_name: string; classification: string | null; role: string | null; }
interface Activity { activity_date: string; activity_type: string; name: string; outcome: string | null; }
interface Opp { name: string; stage: string; estimated_value_eur: string | null; next_action: string | null; }
interface InvoiceAgg { count: string; total: string; outstanding: string; }

function buildPrompt(c: Contact, cos: Company[], acts: Activity[], opps: Opp[], invs: InvoiceAgg | null): string {
  const engagement = c.engagement_override ?? c.engagement_level ?? 'unknown';
  return `Prepare a meeting prep brief for this contact.

=== CONTACT ===
Name: ${c.full_name}
Role: ${c.job_title ?? 'unknown'}
Email: ${c.email ?? 'not on file'}
Lifecycle stage: ${c.lifecycle_stage ?? 'unknown'}
Engagement: ${engagement}
Last activity: ${c.last_activity_at ?? 'never recorded'}${
  // Stint 94 — only include lead_score if it's actually populated.
  // The monthly batch that filled it was deleted; leaving "not scored"
  // permanently in the briefing was noise.
  c.lead_score != null
    ? `\nLead score: ${c.lead_score}${c.lead_score_reasoning ? ' (' + c.lead_score_reasoning + ')' : ''}`
    : ''
}

=== COMPANIES (${cos.length}) ===
${cos.map(co => `- ${co.company_name}${co.classification ? ` [${co.classification}]` : ''}${co.role ? ` · ${co.role}` : ''}`).join('\n') || '(none linked)'}

=== RECENT ACTIVITIES (${acts.length}) ===
${acts.map(a => `- ${a.activity_date} · ${a.activity_type}: ${a.name}${a.outcome ? ` → ${a.outcome}` : ''}`).join('\n') || '(no activities logged)'}

=== OPEN OPPORTUNITIES (${opps.length}) ===
${opps.map(o => `- ${o.name} · ${o.stage}${o.estimated_value_eur ? ` · €${Number(o.estimated_value_eur).toFixed(0)}` : ''}${o.next_action ? ` · next: ${o.next_action}` : ''}`).join('\n') || '(no open opps)'}

=== INVOICES ===
${invs ? `${invs.count} invoice${Number(invs.count) === 1 ? '' : 's'} · €${Number(invs.total).toFixed(0)} billed · €${Number(invs.outstanding).toFixed(0)} outstanding` : '(none)'}

Write the brief.`;
}
