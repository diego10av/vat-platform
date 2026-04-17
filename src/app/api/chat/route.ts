// ════════════════════════════════════════════════════════════════════════
// POST /api/chat — stateless multi-turn chat with Claude.
//
// Body:
//   {
//     messages: [{ role: 'user' | 'assistant', content: string }],
//     use_opus?: boolean,                  // "Ask Opus" escalation
//     context?: {
//       entity_id?: string,
//       declaration_id?: string,
//     }
//   }
//
// Returns:
//   {
//     reply: string,
//     model: string,
//     tokens: { input, output, cache_read },
//     cost_eur: number,
//     budget: {
//       spent_eur: number,
//       cap_eur: number,
//       remaining_eur: number,
//     }
//   }
//
// Gates:
//   1. Rate limit       (30/min per IP — chat is chatty, so higher than agents)
//   2. Per-user budget  (default €2/mo via users.monthly_ai_cap_eur)
//   3. Firm-wide budget (BUDGET_MONTHLY_EUR, default €75)
//
// Why stateless? The MVP doesn't persist chat history — the client holds
// the messages array in component state and sends the full transcript
// every turn. Anthropic's prompt caching keeps this cheap. chat_threads
// + chat_messages in migration 001 are there for a future persistent
// variant; today we chose simplicity over features.
//
// Why always attribute to 'founder'? Single-user baseline. When multi-
// tenant auth lands, replace with `await getCurrentUser(request)`.
// ════════════════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { apiError, apiOk, apiFail } from '@/lib/api-errors';
import { anthropicCreate, priceCall } from '@/lib/anthropic-wrapper';
import { checkRateLimit } from '@/lib/rate-limit';
import { requireBudget, requireUserBudget } from '@/lib/budget-guard';
import { buildSystemPrompt, type ChatContextInput } from '@/lib/chat-context';
import { logger } from '@/lib/logger';

const log = logger.bind('chat');

// Per docs/MODELS.md §4 — Haiku default, Opus on explicit escalation only.
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const OPUS_MODEL  = 'claude-opus-4-5-20250929';

// Who the chat is attributed to in api_calls. Replace with real auth
// when multi-user lands.
const MOCK_USER_ID = 'founder';

export const maxDuration = 120;

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatRequestBody {
  messages: ChatMessage[];
  use_opus?: boolean;
  context?: ChatContextInput;
}

function validateMessages(input: unknown): ChatMessage[] | null {
  if (!Array.isArray(input)) return null;
  const out: ChatMessage[] = [];
  for (const m of input) {
    if (typeof m !== 'object' || m === null) return null;
    const role = (m as { role?: unknown }).role;
    const content = (m as { content?: unknown }).content;
    if (role !== 'user' && role !== 'assistant') return null;
    if (typeof content !== 'string' || content.length === 0) return null;
    if (content.length > 40_000) return null; // 40k char / ~10k tokens hard ceiling per message
    out.push({ role, content });
  }
  if (out.length === 0) return null;
  if (out.length > 40) return null; // max 40 turns — avoids runaway context
  // Last message must be from the user (otherwise what are we replying to?)
  if (out[out.length - 1]!.role !== 'user') return null;
  return out;
}

export async function POST(request: NextRequest) {
  try {
    // ── Gate 1: rate limit ──
    const rl = checkRateLimit(request, { max: 30, windowMs: 60_000, scope: '/api/chat' });
    if (!rl.ok) return rl.response;

    // ── Parse + validate body ──
    const body = (await request.json()) as Partial<ChatRequestBody>;
    const messages = validateMessages(body.messages);
    if (!messages) {
      return apiError('bad_messages',
        'The messages array must be non-empty, end with a user turn, have ≤ 40 entries, and each content ≤ 40 000 chars.',
        { status: 400 });
    }
    const useOpus = body.use_opus === true;
    const context: ChatContextInput = {
      entity_id: body.context?.entity_id ?? null,
      declaration_id: body.context?.declaration_id ?? null,
    };
    const model = useOpus ? OPUS_MODEL : HAIKU_MODEL;

    // ── Gate 2: per-user budget (with cost estimate for Ask-Opus) ──
    // Rough cost estimate so we block BEFORE spending the last euro.
    // We assume ~2k input tokens for context + ~1k output for a turn.
    const estimatedCost = estimateTurnCost(model, messages);
    const userBudget = await requireUserBudget(MOCK_USER_ID, estimatedCost);
    if (!userBudget.ok) {
      return apiError(
        userBudget.error.code,
        userBudget.error.message,
        { hint: userBudget.error.hint, status: 429 },
      );
    }

    // ── Gate 3: firm-wide budget ──
    const firmBudget = await requireBudget();
    if (!firmBudget.ok) {
      return apiError(
        firmBudget.error.code,
        firmBudget.error.message,
        { hint: firmBudget.error.hint, status: 429 },
      );
    }

    // ── Build system prompt from current page context ──
    const systemPrompt = await buildSystemPrompt(context);

    // ── Anthropic call ──
    const timer = log.time('chat turn complete');
    const anthropicBody: Anthropic.MessageCreateParamsNonStreaming = {
      model,
      max_tokens: useOpus ? 4000 : 2000,
      system: [
        // Marking the system prompt as cache-eligible cuts input cost
        // ~90% from turn 2 onward. The TTL is 5 min — plenty for a
        // conversation.
        {
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    };

    const message = await anthropicCreate(anthropicBody, {
      agent: useOpus ? 'chat-opus' : 'chat-haiku',
      user_id: MOCK_USER_ID,
      declaration_id: context.declaration_id ?? undefined,
      entity_id: context.entity_id ?? undefined,
      label: `chat turn ${messages.length}`,
    });

    const reply = message.content.find((b) => b.type === 'text')?.text || '';
    const usage = message.usage as {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
    const actualCost = priceCall(model, usage);
    timer({
      model,
      input_tokens: usage.input_tokens || 0,
      output_tokens: usage.output_tokens || 0,
      cost_eur: actualCost,
    });

    // Fresh budget snapshot so the client can render the quota bar.
    const postBudget = await requireUserBudget(MOCK_USER_ID, 0);

    return apiOk({
      reply,
      model,
      tokens: {
        input: usage.input_tokens || 0,
        output: usage.output_tokens || 0,
        cache_read: usage.cache_read_input_tokens || 0,
      },
      cost_eur: actualCost,
      budget: {
        spent_eur: postBudget.status.month_spend_eur,
        cap_eur: Number.isFinite(postBudget.status.cap_eur) ? postBudget.status.cap_eur : null,
        remaining_eur: Number.isFinite(postBudget.status.remaining_eur) ? postBudget.status.remaining_eur : null,
      },
    });
  } catch (e) {
    return apiFail(e, 'chat');
  }
}

// GET /api/chat — returns the current user's budget snapshot so the
// drawer header can render the quota bar on open without sending a
// message first.
export async function GET() {
  try {
    const budget = await requireUserBudget(MOCK_USER_ID, 0);
    return apiOk({
      spent_eur: budget.status.month_spend_eur,
      cap_eur: Number.isFinite(budget.status.cap_eur) ? budget.status.cap_eur : null,
      remaining_eur: Number.isFinite(budget.status.remaining_eur) ? budget.status.remaining_eur : null,
      pct_used: budget.status.pct_used,
      over_soft_warn: budget.status.over_soft_warn,
      over_budget: budget.status.over_budget,
    });
  } catch (e) {
    return apiFail(e, 'chat/GET');
  }
}

// ───────────────────────── estimation helpers ─────────────────────────

// Rough upfront cost for a turn, used by the per-user budget gate BEFORE
// we hit Anthropic. Over-estimates slightly so we fail safely when near
// the cap.
function estimateTurnCost(model: string, messages: ChatMessage[]): number {
  // Compact approximation: 4 chars ~ 1 token.
  const userInputChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  const estInputTokens = Math.ceil(userInputChars / 4) + 2000; // +system prompt
  // Assume the reply is close to max_tokens cap to be conservative.
  const estOutputTokens = model === OPUS_MODEL ? 4000 : 2000;
  return priceCall(model, {
    input_tokens: estInputTokens,
    output_tokens: estOutputTokens,
  });
}
