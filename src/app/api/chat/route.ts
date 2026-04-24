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
import { buildSystemPrompt, isCrmPath, isTaxOpsPath, type ChatContextInput } from '@/lib/chat-context';
import { CRM_TOOLS, executeCrmTool } from '@/lib/crm-chat-tools';
import { TAX_OPS_TOOLS, executeTaxOpsTool } from '@/lib/tax-ops-chat-tools';
import { persistTurn } from '@/lib/chat-persistence';
import { logger } from '@/lib/logger';

const log = logger.bind('chat');

// Per docs/MODELS.md §4 — Haiku default, Opus on explicit escalation only.
// "Ask Opus" upgraded to Opus 4.7 2026-04-22.
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const OPUS_MODEL  = 'claude-opus-4-7';

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
  /**
   * Optional thread id for persistent history. If omitted a new thread
   * is auto-created from the first user message. Tolerant of the chat_*
   * tables not existing — then persistence is skipped and thread_id
   * comes back null.
   */
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
      path: body.context?.path ?? null,
      crm_target_type: body.context?.crm_target_type ?? null,
      crm_target_id: body.context?.crm_target_id ?? null,
    };
    const inboundThreadId =
      typeof body.thread_id === 'string' && body.thread_id.length > 0
        ? body.thread_id
        : null;
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

    // ── Tool setup ──
    // CRM mode: 6 CRM read-only tools.
    // Tax-Ops mode: 4 tax-ops read-only tools.
    // Neither is compatible with the other (different DB scopes + framing),
    // so we pick one based on the current page path.
    const onCrm = isCrmPath(context.path);
    const onTaxOps = isTaxOpsPath(context.path);
    const tools: Anthropic.Tool[] | undefined =
      onTaxOps ? TAX_OPS_TOOLS
      : onCrm   ? CRM_TOOLS
      : undefined;

    // ── Anthropic call with tool-use loop ──
    // Bounded to 4 iterations: user turn → (tool calls → tool results)
    // × up to 3 → final text. Each tool_use block executes, results
    // get appended as a user-role message, and the model is re-invoked.
    const timer = log.time('chat turn complete');
    const MAX_TOOL_ROUNDS = 4;

    type AggUsage = {
      input_tokens: number; output_tokens: number;
      cache_read_input_tokens: number; cache_creation_input_tokens: number;
    };
    const aggUsage: AggUsage = {
      input_tokens: 0, output_tokens: 0,
      cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
    };

    const convo: Anthropic.MessageParam[] = messages.map((m) => ({ role: m.role, content: m.content }));
    let finalReply = '';
    let toolCallsCount = 0;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
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
        messages: convo,
        ...(tools ? { tools } : {}),
      };

      const message = await anthropicCreate(anthropicBody, {
        agent: useOpus ? 'chat-opus' : 'chat-haiku',
        user_id: MOCK_USER_ID,
        declaration_id: context.declaration_id ?? undefined,
        entity_id: context.entity_id ?? undefined,
        label: `chat turn ${messages.length} round ${round + 1}`,
      });

      const u = message.usage as {
        input_tokens?: number; output_tokens?: number;
        cache_read_input_tokens?: number; cache_creation_input_tokens?: number;
      };
      aggUsage.input_tokens            += u.input_tokens ?? 0;
      aggUsage.output_tokens           += u.output_tokens ?? 0;
      aggUsage.cache_read_input_tokens += u.cache_read_input_tokens ?? 0;
      aggUsage.cache_creation_input_tokens += u.cache_creation_input_tokens ?? 0;

      const toolUses = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      const textBlocks = message.content.filter((b): b is Anthropic.TextBlock => b.type === 'text');

      if (message.stop_reason !== 'tool_use' || toolUses.length === 0) {
        // Terminal turn — capture the model's answer and break.
        finalReply = textBlocks.map(t => t.text).join('\n').trim();
        break;
      }

      // Append the assistant turn (with tool_use blocks) to the convo.
      convo.push({ role: 'assistant', content: message.content });

      // Execute every tool in parallel, then append one user turn with
      // all the tool_result blocks.
      const toolResults = await Promise.all(
        toolUses.map(async (tu) => {
          toolCallsCount += 1;
          const input = (tu.input as Record<string, unknown>) ?? {};
          // Dispatch to the right executor based on the tool-name prefix.
          // (Both tool sets are never exposed simultaneously, but pref
          // matching keeps the branch defensive if that ever changes.)
          const result = tu.name.startsWith('tax_')
            ? await executeTaxOpsTool(tu.name, input)
            : await executeCrmTool(tu.name, input);
          return {
            type: 'tool_result' as const,
            tool_use_id: tu.id,
            content: result.slice(0, 15000),  // safety clamp
          };
        }),
      );
      convo.push({ role: 'user', content: toolResults });

      // Loop continues — next iteration will re-invoke the model with
      // the tool_results attached.
    }

    const reply = finalReply;
    const usage = aggUsage;
    const actualCost = priceCall(model, usage);
    timer({
      model,
      input_tokens: usage.input_tokens || 0,
      output_tokens: usage.output_tokens || 0,
      cost_eur: actualCost,
    });

    // ── Persist the turn (tolerant — null threadId if tables missing) ──
    const lastUserMessage = messages[messages.length - 1]!.content;
    const threadId = await persistTurn({
      threadId: inboundThreadId,
      userId: MOCK_USER_ID,
      userMessage: lastUserMessage,
      assistantMessage: reply,
      model,
      inputTokens: usage.input_tokens || 0,
      outputTokens: usage.output_tokens || 0,
      cacheReadTokens: usage.cache_read_input_tokens || 0,
      costEur: actualCost,
      escalatedToOpus: useOpus,
      contextEntityId: context.entity_id ?? null,
      contextDeclarationId: context.declaration_id ?? null,
    });

    // Fresh budget snapshot so the client can render the quota bar.
    const postBudget = await requireUserBudget(MOCK_USER_ID, 0);

    return apiOk({
      reply,
      model,
      thread_id: threadId,
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
