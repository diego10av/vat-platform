// ════════════════════════════════════════════════════════════════════════
// POST /api/chat/stream — Server-Sent Events streaming chat endpoint.
//
// Same body shape + same gates as /api/chat. The difference is the
// response: instead of a single JSON blob at the end, we stream
// incremental text deltas as they arrive from Anthropic, then a final
// `done` event with the cost + budget snapshot + persisted thread_id.
//
// Why SSE and not WebSocket?
// - Unidirectional (server → client), which is all the chat needs.
// - Works over plain HTTP with any Vercel runtime, no WS upgrade dance.
// - Auto-reconnect is handled by the browser's EventSource API (we
//   don't use EventSource here because POST isn't supported; we
//   parse the SSE byte-stream manually in the client).
//
// Event types:
//   data: {"type":"text_delta","text":"Hello"}\n\n
//   data: {"type":"text_delta","text":" world"}\n\n
//   data: {"type":"done","reply":"…","model":"…","cost_eur":0.02,
//          "thread_id":"…","budget":{…},"tokens":{…}}\n\n
//   data: {"type":"error","message":"…"}\n\n   (sent instead of done)
//
// Budget and rate-limit gates run BEFORE the stream starts (synchronously
// before the Response is returned), so a 429 still behaves like a
// normal JSON error — the browser never opens the SSE reader.
// ════════════════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { apiError } from '@/lib/api-errors';
import {
  getAnthropicClient, priceCall, logApiCall,
} from '@/lib/anthropic-wrapper';
import { checkRateLimit } from '@/lib/rate-limit';
import { requireBudget, requireUserBudget } from '@/lib/budget-guard';
import { buildSystemPrompt, type ChatContextInput } from '@/lib/chat-context';
import { persistTurn } from '@/lib/chat-persistence';
import { logger } from '@/lib/logger';

const log = logger.bind('chat/stream');

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
// "Ask Opus" on the streaming path — upgraded to 4.7 alongside /api/chat.
const OPUS_MODEL = 'claude-opus-4-7';
const MOCK_USER_ID = 'founder';

export const maxDuration = 120;

interface ChatMessage { role: 'user' | 'assistant'; content: string }

interface ChatStreamBody {
  messages: ChatMessage[];
  use_opus?: boolean;
  context?: ChatContextInput;
  thread_id?: string | null;
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
    if (content.length > 40_000) return null;
    out.push({ role, content });
  }
  if (out.length === 0 || out.length > 40) return null;
  if (out[out.length - 1]!.role !== 'user') return null;
  return out;
}

function estimateTurnCost(model: string, messages: ChatMessage[]): number {
  const userInputChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  const estInputTokens = Math.ceil(userInputChars / 4) + 2000;
  const estOutputTokens = model === OPUS_MODEL ? 4000 : 2000;
  return priceCall(model, {
    input_tokens: estInputTokens,
    output_tokens: estOutputTokens,
  });
}

function sseEvent(payload: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`);
}

export async function POST(request: NextRequest) {
  // ── Gate 1: rate limit ──
  const rl = checkRateLimit(request, { max: 30, windowMs: 60_000, scope: '/api/chat/stream' });
  if (!rl.ok) return rl.response;

  // ── Parse + validate body ──
  let body: Partial<ChatStreamBody>;
  try {
    body = (await request.json()) as Partial<ChatStreamBody>;
  } catch {
    return apiError('bad_json', 'Request body is not valid JSON.', { status: 400 });
  }

  const messages = validateMessages(body.messages);
  if (!messages) {
    return apiError(
      'bad_messages',
      'messages must be non-empty, end with a user turn, ≤ 40 entries, each ≤ 40 000 chars.',
      { status: 400 },
    );
  }

  const useOpus = body.use_opus === true;
  const context: ChatContextInput = {
    entity_id: body.context?.entity_id ?? null,
    declaration_id: body.context?.declaration_id ?? null,
  };

  // ── Gate 1.5: per-entity AI mode ──
  // If the user is chatting from an entity/declaration whose entity has
  // ai_mode='classifier_only', refuse the chat stream. This is the
  // compliance-mode kill-switch per migration 009.
  if (context.entity_id || context.declaration_id) {
    const { queryOne } = await import('@/lib/db');
    const row = await queryOne<{ ai_mode: string | null }>(
      context.entity_id
        ? `SELECT COALESCE(ai_mode, 'full') AS ai_mode FROM entities WHERE id = $1`
        : `SELECT COALESCE(e.ai_mode, 'full') AS ai_mode
             FROM declarations d JOIN entities e ON d.entity_id = e.id WHERE d.id = $1`,
      [context.entity_id || context.declaration_id],
    );
    if (row?.ai_mode === 'classifier_only') {
      return apiError(
        'ai_mode_restricted',
        'The assistant is disabled for this entity (classifier-only mode).',
        {
          hint: 'Switch the entity\u2019s AI mode to Full to use the assistant, or consult the rule references manually.',
          status: 409,
        },
      );
    }
  }
  const inboundThreadId =
    typeof body.thread_id === 'string' && body.thread_id.length > 0
      ? body.thread_id
      : null;
  const model = useOpus ? OPUS_MODEL : HAIKU_MODEL;

  // ── Gate 2: per-user budget (pre-flight estimate) ──
  const estimatedCost = estimateTurnCost(model, messages);
  const userBudget = await requireUserBudget(MOCK_USER_ID, estimatedCost);
  if (!userBudget.ok) {
    return apiError(userBudget.error.code, userBudget.error.message, {
      hint: userBudget.error.hint,
      status: 429,
    });
  }

  // ── Gate 3: firm-wide budget ──
  const firmBudget = await requireBudget();
  if (!firmBudget.ok) {
    return apiError(firmBudget.error.code, firmBudget.error.message, {
      hint: firmBudget.error.hint,
      status: 429,
    });
  }

  // ── Build system prompt ──
  const systemPrompt = await buildSystemPrompt(context);

  // ── Start the SSE stream ──
  const started = Date.now();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const anthropicBody: Anthropic.MessageCreateParamsStreaming = {
          model,
          max_tokens: useOpus ? 4000 : 2000,
          stream: true,
          system: [
            { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
          ],
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
        };

        let accumulated = '';

        const anthropicStream = getAnthropicClient().messages.stream(anthropicBody);

        for await (const event of anthropicStream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            const delta = event.delta.text;
            accumulated += delta;
            controller.enqueue(sseEvent({ type: 'text_delta', text: delta }));
          }
        }

        // Authoritative usage comes from finalMessage — the per-event
        // message_delta usage is a nullable-partial and mixing it in
        // here would complicate typing for no benefit.
        const finalMessage = await anthropicStream.finalMessage();
        const usage = finalMessage.usage as Anthropic.Usage | undefined;

        const cost = priceCall(model, {
          input_tokens: usage?.input_tokens || 0,
          output_tokens: usage?.output_tokens || 0,
          cache_read_input_tokens: (usage as { cache_read_input_tokens?: number } | undefined)?.cache_read_input_tokens || 0,
          cache_creation_input_tokens: (usage as { cache_creation_input_tokens?: number } | undefined)?.cache_creation_input_tokens || 0,
        });

        // Log to api_calls (same row shape as non-streaming endpoint).
        await logApiCall({
          agent: useOpus ? 'chat-opus' : 'chat-haiku',
          user_id: MOCK_USER_ID,
          declaration_id: context.declaration_id ?? undefined,
          entity_id: context.entity_id ?? undefined,
          model,
          input_tokens: usage?.input_tokens || 0,
          output_tokens: usage?.output_tokens || 0,
          cache_read_tokens: (usage as { cache_read_input_tokens?: number } | undefined)?.cache_read_input_tokens || 0,
          cache_creation_tokens: (usage as { cache_creation_input_tokens?: number } | undefined)?.cache_creation_input_tokens || 0,
          cost_eur: cost,
          duration_ms: Date.now() - started,
          status: 'ok',
          label: `chat stream turn ${messages.length}`,
        });

        // Persist the turn (tolerant — null threadId if migration missing).
        const lastUserMessage = messages[messages.length - 1]!.content;
        const threadId = await persistTurn({
          threadId: inboundThreadId,
          userId: MOCK_USER_ID,
          userMessage: lastUserMessage,
          assistantMessage: accumulated,
          model,
          inputTokens: usage?.input_tokens || 0,
          outputTokens: usage?.output_tokens || 0,
          cacheReadTokens: (usage as { cache_read_input_tokens?: number } | undefined)?.cache_read_input_tokens || 0,
          costEur: cost,
          escalatedToOpus: useOpus,
          contextEntityId: context.entity_id ?? null,
          contextDeclarationId: context.declaration_id ?? null,
        });

        const postBudget = await requireUserBudget(MOCK_USER_ID, 0);

        controller.enqueue(sseEvent({
          type: 'done',
          reply: accumulated,
          model,
          thread_id: threadId,
          cost_eur: cost,
          tokens: {
            input: usage?.input_tokens || 0,
            output: usage?.output_tokens || 0,
            cache_read: (usage as { cache_read_input_tokens?: number } | undefined)?.cache_read_input_tokens || 0,
          },
          budget: {
            spent_eur: postBudget.status.month_spend_eur,
            cap_eur: Number.isFinite(postBudget.status.cap_eur) ? postBudget.status.cap_eur : null,
            remaining_eur: Number.isFinite(postBudget.status.remaining_eur) ? postBudget.status.remaining_eur : null,
          },
        }));

        controller.close();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error('chat stream failed', err, {});
        try {
          controller.enqueue(sseEvent({ type: 'error', message }));
        } catch {
          // already closed
        }
        try {
          controller.close();
        } catch {
          // already closed
        }

        // Log the failed call so the metrics dashboard attributes
        // spend attempts to the streaming chat agent too.
        await logApiCall({
          agent: useOpus ? 'chat-opus' : 'chat-haiku',
          user_id: MOCK_USER_ID,
          model,
          input_tokens: 0,
          output_tokens: 0,
          cost_eur: 0,
          duration_ms: Date.now() - started,
          status: 'error',
          error_message: message,
        });
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // disable nginx/vercel proxy buffering
    },
  });
}
