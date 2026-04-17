import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';
import { query, queryOne } from '@/lib/db';
import { computeECDF } from '@/lib/ecdf';
import { generatePaymentReference } from '@/lib/payment-ref';
import { anthropicCreate } from '@/lib/anthropic-wrapper';
import { checkRateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

const log = logger.bind('agents/draft-email');

const PRIMARY_MODEL = 'claude-haiku-4-5-20251001';
const FALLBACK_MODEL = 'claude-haiku-4-5-20251001';

export const maxDuration = 120;

async function readPrompt(name: string): Promise<string> {
  return readFile(path.join(process.cwd(), 'prompts', name), 'utf-8');
}

// POST /api/agents/draft-email
// Body: { declaration_id, expert_notes?: string }
// Returns: { subject, body, full_text, model, observations_data }
export async function POST(request: NextRequest) {
  try {
    // Rate limit: 15 email drafts per minute per IP. Haiku is cheap
    // but this is user-triggered, so a stampede suggests a UI bug.
    const rl = checkRateLimit(request, { max: 15, windowMs: 60_000 });
    if (!rl.ok) return rl.response;

    return await handleDraft(request);
  } catch (e) {
    const err = e as { status?: number; message?: string };
    log.error('fatal in draft-email POST', e, { err_status: err.status });
    return NextResponse.json({
      error: err.message || String(e),
      status: err.status || 500,
    }, { status: 500 });
  }
}

async function handleDraft(request: NextRequest): Promise<NextResponse> {
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

  // invoice_date is TEXT (YYYY-MM-DD). Cast safely; rows that fail to parse are excluded.
  const lateLines = await query<{ provider: string; description: string; invoice_date: string; amount_eur: number }>(
    `SELECT i.provider, il.description, i.invoice_date,
            il.amount_eur::float AS amount_eur
       FROM invoice_lines il
       JOIN invoices i ON il.invoice_id = i.id
      WHERE il.declaration_id = $1
        AND il.state != 'deleted'
        AND i.invoice_date IS NOT NULL
        AND i.invoice_date ~ '^\\d{4}-\\d{2}-\\d{2}'
        AND TO_DATE(i.invoice_date, 'YYYY-MM-DD') < MAKE_DATE($2::int, 1, 1)
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

  let usedModel = PRIMARY_MODEL;
  let response;
  try {
    response = await anthropicCreate({
      model: PRIMARY_MODEL,
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMsg }],
    }, { agent: 'drafter', declaration_id });
  } catch (e) {
    const err = e as { status?: number; message?: string };
    if (err.status === 404 || err.message?.includes('model')) {
      usedModel = FALLBACK_MODEL;
      response = await anthropicCreate({
        model: FALLBACK_MODEL,
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMsg }],
      }, { agent: 'drafter', declaration_id });
    } else {
      log.error('drafter call failed', e, { err_status: err.status });
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
