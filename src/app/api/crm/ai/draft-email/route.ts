import { NextRequest, NextResponse } from 'next/server';
import { queryOne, query, logAudit } from '@/lib/db';
import { anthropicCreate } from '@/lib/anthropic-wrapper';
import { apiError } from '@/lib/api-errors';

// POST /api/crm/ai/draft-email
//
// Generates a short, contextually-aware email draft for a CRM
// target (contact / invoice / opportunity / matter). Opus 4.7 —
// this is client-facing output so quality dominates cost.
//
// Body: {
//   target_type: 'crm_contact' | 'crm_invoice' | 'crm_opportunity' | 'crm_matter',
//   target_id:   string,
//   intent:      'follow_up' | 'overdue_chase' | 'check_in' | 'next_step'
// }
//
// Returns: { subject, body_markdown, body_plain_text, mailto_url,
//            recipient_email? }
//
// The user is expected to review + edit before sending. We return
// mailto: with the subject + body pre-encoded so "Open in mail client"
// is one click.
const MODEL = 'claude-opus-4-7';

type TargetType = 'crm_contact' | 'crm_invoice' | 'crm_opportunity' | 'crm_matter';
type Intent = 'follow_up' | 'overdue_chase' | 'check_in' | 'next_step';

const VALID_TARGETS = new Set<TargetType>([
  'crm_contact', 'crm_invoice', 'crm_opportunity', 'crm_matter',
]);
const VALID_INTENTS = new Set<Intent>([
  'follow_up', 'overdue_chase', 'check_in', 'next_step',
]);

interface ContextSummary {
  summary: string;
  recipient_name: string | null;
  recipient_email: string | null;
  firm_name: string | null;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const targetType = body.target_type as TargetType;
  const targetId = typeof body.target_id === 'string' ? body.target_id : '';
  const intent = (body.intent as Intent) ?? 'follow_up';

  if (!VALID_TARGETS.has(targetType)) {
    return apiError('invalid_target_type', `target_type must be one of: ${[...VALID_TARGETS].join(', ')}`, { status: 400 });
  }
  if (!targetId) {
    return apiError('target_id_required', 'target_id is required.', { status: 400 });
  }
  if (!VALID_INTENTS.has(intent)) {
    return apiError('invalid_intent', `intent must be one of: ${[...VALID_INTENTS].join(', ')}`, { status: 400 });
  }

  // Load context + recipient depending on target type.
  const ctx = await loadContext(targetType, targetId);
  if (!ctx) return apiError('not_found', 'Target record not found.', { status: 404 });

  const message = await anthropicCreate(
    {
      model: MODEL,
      max_tokens: 800,
      system: buildSystemPrompt(intent, ctx.firm_name),
      messages: [{ role: 'user', content: ctx.summary }],
    },
    { agent: 'other', label: `draft-email:${targetType}:${intent}` },
  );

  const raw = message.content
    .filter((b): b is { type: 'text'; text: string; citations: null } => b.type === 'text')
    .map(b => b.text).join('\n').trim();
  const parsed = parseDraft(raw);
  if (!parsed) {
    return apiError('parse_failed', 'AI returned an unparseable response. Try again.', { status: 502 });
  }

  await logAudit({
    action: 'email_drafted',
    targetType,
    targetId,
    field: 'draft_email',
    reason: `AI draft-email for ${intent}`,
  });

  // Build mailto url with minimal encoding so the user's mail client
  // populates subject + body cleanly.
  const to = ctx.recipient_email ?? '';
  const mailtoUrl = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(parsed.subject)}&body=${encodeURIComponent(parsed.body_plain_text)}`;

  return NextResponse.json({
    subject: parsed.subject,
    body_markdown: parsed.body_markdown,
    body_plain_text: parsed.body_plain_text,
    mailto_url: mailtoUrl,
    recipient_email: ctx.recipient_email,
    recipient_name: ctx.recipient_name,
  });
}

// ─── Context loading per target type ──────────────────────────────

async function loadContext(type: TargetType, id: string): Promise<ContextSummary | null> {
  const firm = await queryOne<{ firm_name: string }>(
    `SELECT firm_name FROM crm_firm_settings WHERE id = 'default'`,
  );
  const firmName = firm?.firm_name ?? null;

  if (type === 'crm_contact') {
    const c = await queryOne<{
      id: string; full_name: string; email: string | null;
      job_title: string | null; lifecycle_stage: string | null;
    }>(
      `SELECT id, full_name, email, job_title, lifecycle_stage
         FROM crm_contacts WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    if (!c) return null;
    const activities = await query<{ activity_date: string; activity_type: string; name: string }>(
      `SELECT a.activity_date::text, a.activity_type, a.name
         FROM crm_activity_contacts ac
         JOIN crm_activities a ON a.id = ac.activity_id
        WHERE ac.contact_id = $1
        ORDER BY a.activity_date DESC LIMIT 5`,
      [id],
    );
    const company = await queryOne<{ company_name: string }>(
      `SELECT co.company_name FROM crm_contact_companies cc
         JOIN crm_companies co ON co.id = cc.company_id
        WHERE cc.contact_id = $1 AND co.deleted_at IS NULL
        ORDER BY cc.is_primary DESC LIMIT 1`,
      [id],
    );
    const lines = [
      `Contact: ${c.full_name}${c.job_title ? ` (${c.job_title})` : ''}`,
      company ? `Company: ${company.company_name}` : '',
      c.lifecycle_stage ? `Lifecycle: ${c.lifecycle_stage}` : '',
      activities.length > 0 ? `\nRecent activities:` : 'No recent activities logged.',
      ...activities.map(a => `- ${a.activity_date}: ${a.activity_type} — ${a.name}`),
    ].filter(Boolean);
    return {
      summary: lines.join('\n'),
      recipient_name: c.full_name,
      recipient_email: c.email,
      firm_name: firmName,
    };
  }

  if (type === 'crm_invoice') {
    const inv = await queryOne<{
      invoice_number: string; status: string; amount_incl_vat: string | null;
      outstanding: string | null; issue_date: string | null;
      due_date: string | null; currency: string;
      client_name: string | null; contact_name: string | null;
      contact_email: string | null;
      matter_reference: string | null;
    }>(
      `SELECT i.invoice_number, i.status, i.amount_incl_vat::text,
              i.outstanding::text, i.issue_date::text, i.due_date::text,
              i.currency,
              co.company_name AS client_name,
              ct.full_name AS contact_name,
              ct.email AS contact_email,
              m.matter_reference
         FROM crm_billing_invoices i
         LEFT JOIN crm_companies co ON co.id = i.company_id
         LEFT JOIN crm_contacts ct ON ct.id = i.primary_contact_id
         LEFT JOIN crm_matters m ON m.id = i.matter_id
        WHERE i.id = $1`,
      [id],
    );
    if (!inv) return null;
    const daysOverdue = inv.due_date
      ? Math.floor((Date.now() - new Date(inv.due_date).getTime()) / (1000 * 60 * 60 * 24))
      : null;
    const lines = [
      `Invoice: ${inv.invoice_number} (${inv.status})`,
      `Client: ${inv.client_name ?? 'unknown'}`,
      `Amount: ${inv.amount_incl_vat ? `${inv.currency} ${Number(inv.amount_incl_vat).toFixed(2)}` : '—'}`,
      `Outstanding: ${inv.outstanding ? `${inv.currency} ${Number(inv.outstanding).toFixed(2)}` : '—'}`,
      `Issue date: ${inv.issue_date ?? '—'}`,
      `Due date: ${inv.due_date ?? '—'}${daysOverdue !== null && daysOverdue > 0 ? ` (${daysOverdue}d past due)` : ''}`,
      inv.matter_reference ? `Related matter: ${inv.matter_reference}` : '',
    ].filter(Boolean);
    return {
      summary: lines.join('\n'),
      recipient_name: inv.contact_name,
      recipient_email: inv.contact_email,
      firm_name: firmName,
    };
  }

  if (type === 'crm_opportunity') {
    const o = await queryOne<{
      name: string; stage: string; estimated_value_eur: string | null;
      probability_pct: number | null; estimated_close_date: string | null;
      next_action: string | null;
      client_name: string | null; contact_name: string | null; contact_email: string | null;
    }>(
      `SELECT o.name, o.stage, o.estimated_value_eur::text,
              o.probability_pct, o.estimated_close_date::text, o.next_action,
              co.company_name AS client_name,
              ct.full_name AS contact_name,
              ct.email AS contact_email
         FROM crm_opportunities o
         LEFT JOIN crm_companies co ON co.id = o.company_id
         LEFT JOIN crm_contacts ct ON ct.id = o.primary_contact_id
        WHERE o.id = $1 AND o.deleted_at IS NULL`,
      [id],
    );
    if (!o) return null;
    const lines = [
      `Opportunity: ${o.name}`,
      `Stage: ${o.stage}`,
      o.client_name ? `Client: ${o.client_name}` : '',
      o.estimated_value_eur ? `Est. value: €${Number(o.estimated_value_eur).toFixed(0)}${o.probability_pct !== null ? ` (${o.probability_pct}%)` : ''}` : '',
      o.estimated_close_date ? `Est. close: ${o.estimated_close_date}` : '',
      o.next_action ? `Planned next step: ${o.next_action}` : '',
    ].filter(Boolean);
    return {
      summary: lines.join('\n'),
      recipient_name: o.contact_name,
      recipient_email: o.contact_email,
      firm_name: firmName,
    };
  }

  if (type === 'crm_matter') {
    const m = await queryOne<{
      matter_reference: string; title: string; status: string;
      client_name: string | null; contact_name: string | null; contact_email: string | null;
      practice_areas: string[] | null; fee_type: string | null;
    }>(
      `SELECT m.matter_reference, m.title, m.status, m.practice_areas, m.fee_type,
              co.company_name AS client_name,
              ct.full_name AS contact_name,
              ct.email AS contact_email
         FROM crm_matters m
         LEFT JOIN crm_companies co ON co.id = m.client_company_id
         LEFT JOIN crm_contacts ct ON ct.id = m.primary_contact_id
        WHERE m.id = $1 AND m.deleted_at IS NULL`,
      [id],
    );
    if (!m) return null;
    const lines = [
      `Matter: ${m.matter_reference} — ${m.title}`,
      `Status: ${m.status}`,
      m.client_name ? `Client: ${m.client_name}` : '',
      (m.practice_areas ?? []).length > 0 ? `Practice: ${(m.practice_areas ?? []).join(', ')}` : '',
      m.fee_type ? `Fee basis: ${m.fee_type}` : '',
    ].filter(Boolean);
    return {
      summary: lines.join('\n'),
      recipient_name: m.contact_name,
      recipient_email: m.contact_email,
      firm_name: firmName,
    };
  }

  return null;
}

// ─── Prompt + parser ──────────────────────────────────────────────

function buildSystemPrompt(intent: Intent, firmName: string | null): string {
  const tones: Record<Intent, string> = {
    follow_up:
      'warm + forward-looking. Short follow-up on an open loop in the relationship. Ask for a clear next step (call / meeting / document).',
    overdue_chase:
      'polite but firm. Remind them the invoice is past due. Reference specific numbers + dates. Offer flexibility if they need it, but create gentle pressure.',
    check_in:
      'relationship-first, no ask. The contact has gone dormant — reach out to see how they are, mention something specific from past interactions if available.',
    next_step:
      'concise + concrete. Propose the next action in a deal. Tie it to the last known state. Make it easy to say yes.',
  };
  const signer = firmName ? `The sender is a partner at ${firmName}.` : 'The sender is a senior counsel.';
  return `You are drafting a professional email from a Luxembourg private-equity law firm partner to a client / prospect. ${signer}

Tone for this draft: ${tones[intent]}

Requirements:
- Keep it SHORT: 4-8 sentences maximum. Partners don't write essays. The reader is busy.
- Natural English, no jargon, no legalese unless necessary.
- Do NOT invent facts not in the context. If a detail isn't provided, keep it generic.
- End with a clear next step or question.
- Sign off with "Kind regards,\\n[Sender name]" (the user will replace [Sender name]).

Output format — STRICT JSON only, no prose, no markdown fences:
{"subject":"...","body":"...","plain_text":"..."}

Where:
- subject: ≤70 chars, no "Re:" prefix (user adds if needed).
- body: the email body with \\n line breaks. May include plain markdown like **bold** but nothing heavy.
- plain_text: same as body but with zero formatting, ready to paste into any mail client.`;
}

function parseDraft(raw: string): { subject: string; body_markdown: string; body_plain_text: string } | null {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    const obj = JSON.parse(cleaned);
    const subject = typeof obj.subject === 'string' ? obj.subject.trim() : '';
    const body = typeof obj.body === 'string' ? obj.body.trim() : '';
    const plain = typeof obj.plain_text === 'string' ? obj.plain_text.trim() : body;
    if (!subject || !body) return null;
    return {
      subject: subject.slice(0, 200),
      body_markdown: body,
      body_plain_text: plain,
    };
  } catch {
    return null;
  }
}
