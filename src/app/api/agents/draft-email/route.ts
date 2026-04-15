import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'fs/promises';
import path from 'path';
import { query, queryOne } from '@/lib/db';
import { computeECDF } from '@/lib/ecdf';
import { generatePaymentReference } from '@/lib/payment-ref';

// Use the most capable model — client-facing copy must be impeccable.
// Falls back to claude-sonnet if Opus is unavailable.
const MODEL = 'claude-opus-4-5-20250929';
const FALLBACK_MODEL = 'claude-sonnet-4-5-20250929';

export const maxDuration = 120;

function getClient(): Anthropic {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw new Error('ANTHROPIC_API_KEY not set');
  return new Anthropic({ apiKey: key });
}

async function readPrompt(name: string): Promise<string> {
  return readFile(path.join(process.cwd(), 'prompts', name), 'utf-8');
}

// POST /api/agents/draft-email
// Body: { declaration_id, expert_notes?: string }
// Returns: { subject, body, full_text, model, observations_data }
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { declaration_id, expert_notes } = body;
  if (!declaration_id) return NextResponse.json({ error: 'declaration_id required' }, { status: 400 });

  const decl = await queryOne<{
    year: number; period: string; matricule: string | null;
    entity_name: string; client_name: string | null; regime: string;
  }>(
    `SELECT d.year, d.period, e.matricule, e.name AS entity_name,
            e.client_name, e.regime
       FROM declarations d JOIN entities e ON d.entity_id = e.id
      WHERE d.id = $1`,
    [declaration_id]
  );
  if (!decl) return NextResponse.json({ error: 'Declaration not found' }, { status: 404 });

  // Aggregate the data the drafter needs to write its observations.
  const ecdf = await computeECDF(declaration_id);
  let payment = null;
  try {
    payment = generatePaymentReference({
      matricule: decl.matricule, year: decl.year, period: decl.period,
      amount: ecdf.totals.payable,
    });
  } catch { /* matricule missing — drafter can still produce text */ }

  // Observations data: collect signals for the LLM
  const inferenceLines = await query<{ provider: string; description: string; treatment: string; flag_reason: string | null; amount_eur: number }>(
    `SELECT i.provider, il.description, il.treatment, il.flag_reason, il.amount_eur::float AS amount_eur
       FROM invoice_lines il
       JOIN invoices i ON il.invoice_id = i.id
      WHERE il.declaration_id = $1
        AND il.state != 'deleted'
        AND il.treatment_source = 'inference'
      ORDER BY il.amount_eur DESC NULLS LAST`,
    [declaration_id]
  );

  const lateLines = await query<{ provider: string; description: string; invoice_date: string; amount_eur: number }>(
    `SELECT i.provider, il.description, i.invoice_date,
            il.amount_eur::float AS amount_eur
       FROM invoice_lines il
       JOIN invoices i ON il.invoice_id = i.id
      WHERE il.declaration_id = $1
        AND il.state != 'deleted'
        AND i.invoice_date < ($2::int || '-01-01')::date
      ORDER BY i.invoice_date ASC`,
    [declaration_id, decl.year]
  );

  const fxLines = await query<{ provider: string; currency: string; currency_amount: number; ecb_rate: number | null }>(
    `SELECT i.provider, i.currency, i.currency_amount::float AS currency_amount,
            i.ecb_rate::float AS ecb_rate
       FROM invoice_lines il
       JOIN invoices i ON il.invoice_id = i.id
      WHERE il.declaration_id = $1
        AND il.state != 'deleted'
        AND i.currency IS NOT NULL
        AND UPPER(i.currency) != 'EUR'`,
    [declaration_id]
  );

  const newProviders = await query<{ provider: string; total: number }>(
    `SELECT i.provider, SUM(il.amount_eur)::float AS total
       FROM invoice_lines il
       JOIN invoices i ON il.invoice_id = i.id
       JOIN declarations d2 ON il.declaration_id = d2.id
      WHERE il.declaration_id = $1
        AND il.state != 'deleted'
        AND i.provider IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM precedents p
          WHERE p.entity_id = d2.entity_id
            AND LOWER(REGEXP_REPLACE(p.provider,'[^a-zA-Z0-9]','','g')) =
                LOWER(REGEXP_REPLACE(i.provider,'[^a-zA-Z0-9]','','g'))
        )
      GROUP BY i.provider
      ORDER BY total DESC NULLS LAST
      LIMIT 10`,
    [declaration_id]
  );

  const observations = {
    entity_name: decl.entity_name,
    client_name: decl.client_name,
    year: decl.year,
    period: decl.period,
    regime: decl.regime,
    totals: ecdf.totals,
    payment_reference: payment?.reference || null,
    inference_lines: inferenceLines,
    late_lines: lateLines,
    fx_lines: fxLines,
    new_providers: newProviders,
    expert_notes: expert_notes || null,
  };

  // Build prompt
  const systemPrompt = await readPrompt('drafter.md');
  const userMsg = `# Declaration data

\`\`\`json
${JSON.stringify(observations, null, 2)}
\`\`\`

Draft the email per your instructions.`;

  const client = getClient();
  let usedModel = MODEL;
  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMsg }],
    });
  } catch (e) {
    const err = e as { status?: number; message?: string };
    if (err.status === 404 || err.message?.includes('model')) {
      // Fallback: try Sonnet
      usedModel = FALLBACK_MODEL;
      response = await client.messages.create({
        model: FALLBACK_MODEL,
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMsg }],
      });
    } else {
      throw e;
    }
  }

  const text = response.content.find(b => b.type === 'text')?.text || '';
  // Split out subject line
  const lines = text.trim().split('\n');
  let subject = '';
  let bodyStart = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().startsWith('subject:')) {
      subject = lines[i].slice(8).trim();
      bodyStart = i + 1;
      break;
    }
  }
  // Skip the blank line right after subject
  while (bodyStart < lines.length && lines[bodyStart].trim() === '') bodyStart += 1;
  const bodyText = lines.slice(bodyStart).join('\n').trim();

  if (!subject) {
    // Drafter didn't include a subject — derive a sensible one
    subject = `VAT declaration — ${decl.entity_name} — ${decl.year} ${decl.period}`;
  }

  return NextResponse.json({
    subject,
    body: bodyText || text.trim(),
    full_text: text.trim(),
    model: usedModel,
    observations_data: observations,
  });
}
