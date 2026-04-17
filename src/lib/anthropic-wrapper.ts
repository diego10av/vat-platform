// Wrapper around Anthropic SDK that:
//   1. Centralises client construction (trimmed API key, consistent baseURL)
//   2. Logs every call to api_calls with token counts + EUR cost estimate
//   3. Retries once on 401 (transient auth) — we observed this historically
//
// Pricing (EUR per 1M tokens, approximate, update as Anthropic changes
// prices). Used only for cost estimation — this is not authoritative billing.

import Anthropic from '@anthropic-ai/sdk';
import { execute, generateId } from '@/lib/db';
import { logger } from '@/lib/logger';

const log = logger.bind('anthropic-wrapper');

// Approximate EUR/USD conversion used for coarse estimates. Anthropic bills in
// USD; we store EUR for the UI. Update as FX shifts.
const USD_TO_EUR = 0.92;

// Prices per 1M tokens (USD) — approximate published Anthropic rates.
// Structure: { input, output, cache_read?, cache_write? }
const PRICING_USD: Record<string, { input: number; output: number; cache_read?: number; cache_write?: number }> = {
  // Haiku — cheap mechanical tasks
  'claude-haiku-4-5-20251001':        { input: 1.0, output: 5.0, cache_read: 0.1, cache_write: 1.25 },
  // Sonnet
  'claude-sonnet-4-5-20250929':       { input: 3.0, output: 15.0, cache_read: 0.3, cache_write: 3.75 },
  // Opus (when available for this key)
  'claude-opus-4-5-20250929':         { input: 15.0, output: 75.0, cache_read: 1.5, cache_write: 18.75 },
};

export function priceCall(model: string, usage: {
  input_tokens?: number; output_tokens?: number;
  cache_read_input_tokens?: number; cache_creation_input_tokens?: number;
}): number {
  const p = PRICING_USD[model];
  if (!p) return 0;
  const input = (usage.input_tokens || 0) / 1_000_000 * p.input;
  const output = (usage.output_tokens || 0) / 1_000_000 * p.output;
  const cacheRead = (usage.cache_read_input_tokens || 0) / 1_000_000 * (p.cache_read || p.input);
  const cacheWrite = (usage.cache_creation_input_tokens || 0) / 1_000_000 * (p.cache_write || p.input * 1.25);
  return (input + output + cacheRead + cacheWrite) * USD_TO_EUR;
}

export function getAnthropicClient(): Anthropic {
  const raw = process.env.ANTHROPIC_API_KEY;
  if (!raw) throw Object.assign(new Error('ANTHROPIC_API_KEY not set'), { status: 500, code: 'no_api_key' });
  return new Anthropic({ apiKey: raw.trim() });
}

export function maskKey(k: string | undefined): string {
  if (!k) return 'MISSING';
  const t = k.trim();
  if (t.length < 12) return 'TOO_SHORT';
  return `${t.slice(0, 8)}...${t.slice(-4)}`;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export interface AnthropicCallContext {
  agent:
    | 'triage' | 'extractor' | 'classifier' | 'drafter' | 'aed_reader' | 'validator'
    | 'chat-haiku' | 'chat-opus'
    | 'other';
  declaration_id?: string | null;
  entity_id?: string | null;
  /**
   * Optional attribution. If omitted, the call is attributed to 'founder'
   * (single-user baseline until multi-tenant auth lands). The DB default
   * matches, so sending null is equivalent to omitting it.
   */
  user_id?: string | null;
  label?: string; // e.g. document filename for logs
}

// One call, logged. Retries once on 401.
export async function anthropicCreate(
  body: Anthropic.MessageCreateParamsNonStreaming,
  context: AnthropicCallContext
): Promise<Anthropic.Message> {
  const started = Date.now();
  let message: Anthropic.Message;
  try {
    message = await getAnthropicClient().messages.create(body);
  } catch (e) {
    const err = e as { status?: number; message?: string };
    if (err.status === 401) {
      await sleep(1000);
      try {
        message = await getAnthropicClient().messages.create(body);
      } catch (e2) {
        await logApiCall({
          ...context,
          model: body.model,
          input_tokens: 0, output_tokens: 0,
          cost_eur: 0,
          duration_ms: Date.now() - started,
          status: 'error',
          error_message: (e2 as Error).message,
        });
        throw e2;
      }
    } else {
      await logApiCall({
        ...context,
        model: body.model,
        input_tokens: 0, output_tokens: 0,
        cost_eur: 0,
        duration_ms: Date.now() - started,
        status: 'error',
        error_message: (e as Error).message,
      });
      throw e;
    }
  }

  const usage = message.usage as {
    input_tokens?: number; output_tokens?: number;
    cache_read_input_tokens?: number; cache_creation_input_tokens?: number;
  };
  const cost = priceCall(body.model, usage);

  await logApiCall({
    ...context,
    model: body.model,
    input_tokens: usage.input_tokens || 0,
    output_tokens: usage.output_tokens || 0,
    cache_read_tokens: usage.cache_read_input_tokens || 0,
    cache_creation_tokens: usage.cache_creation_input_tokens || 0,
    cost_eur: cost,
    duration_ms: Date.now() - started,
    status: 'ok',
  });

  return message;
}

// Exported so callers that orchestrate streaming (which can't use
// `anthropicCreate`) can still write the same row into api_calls.
export async function logApiCall(args: {
  declaration_id?: string | null;
  entity_id?: string | null;
  user_id?: string | null;
  agent: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens?: number;
  cache_creation_tokens?: number;
  cost_eur: number;
  duration_ms: number;
  status: 'ok' | 'error';
  error_message?: string;
  label?: string;
}): Promise<string | null> {
  const id = generateId();
  try {
    // Try with user_id first (post-migration-001 schema). On failure
    // (old schema, missing column), retry without it so dev/staging
    // without the migration applied continue to work.
    try {
      await execute(
        `INSERT INTO api_calls (id, declaration_id, entity_id, user_id, agent, model,
           input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
           cost_eur, duration_ms, status, error_message)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          id,
          args.declaration_id || null,
          args.entity_id || null,
          args.user_id || 'founder',
          args.agent,
          args.model,
          args.input_tokens,
          args.output_tokens,
          args.cache_read_tokens || 0,
          args.cache_creation_tokens || 0,
          args.cost_eur,
          args.duration_ms,
          args.status,
          args.error_message || null,
        ]
      );
    } catch (e) {
      const err = e as { message?: string };
      if (err.message && /column ["']?user_id["']?/i.test(err.message)) {
        // Migration 001 not yet applied — insert without user_id.
        await execute(
          `INSERT INTO api_calls (id, declaration_id, entity_id, agent, model,
             input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
             cost_eur, duration_ms, status, error_message)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            id,
            args.declaration_id || null,
            args.entity_id || null,
            args.agent,
            args.model,
            args.input_tokens,
            args.output_tokens,
            args.cache_read_tokens || 0,
            args.cache_creation_tokens || 0,
            args.cost_eur,
            args.duration_ms,
            args.status,
            args.error_message || null,
          ]
        );
      } else {
        throw e;
      }
    }
    return id;
  } catch (e) {
    // Never let logging failures break the actual request
    log.error('failed to persist api_call row', e, {
      agent: args.agent,
      model: args.model,
    });
    return null;
  }
}
