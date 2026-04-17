'use client';

// ════════════════════════════════════════════════════════════════════════
// ChatDrawer — the in-product "Ask cifra" assistant.
//
// Mounts as a right-side drawer above the main content. Opens / closes
// via the button in the TopBar. Context-aware: reads entity_id /
// declaration_id from the current URL (/entities/[id], /declarations/[id])
// so the assistant already knows what the user is looking at.
//
// State model (stateless on the server side):
//   - All conversation state lives in this component.
//   - Each POST to /api/chat sends the full messages array; the server
//     is stateless.
//   - On mount, we GET /api/chat to fetch current quota snapshot.
//
// UI features per docs/MODELS.md §4:
//   - Haiku 4.5 default (cheap, fast).
//   - "Ask Opus" button on the last assistant message — re-runs the
//     preceding user question on Opus with a cost toast.
//   - Quota header: "€0.47 / €2.00 used this month".
//   - When quota is reached, input becomes read-only with an explanation.
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { XIcon, SendIcon, SparklesIcon, Loader2Icon, MessageSquareIcon } from 'lucide-react';

type Role = 'user' | 'assistant';

interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  model?: string;           // only on assistant
  cost_eur?: number;        // only on assistant
  escalated_to_opus?: boolean;
}

interface BudgetSnapshot {
  spent_eur: number;
  cap_eur: number | null;   // null ⇒ migration not applied, no cap enforced
  remaining_eur: number | null;
  pct_used: number;
  over_budget: boolean;
  over_soft_warn: boolean;
}

// Extract entity / declaration id from the current URL if the user is
// on one of those pages. Keeps the drawer context-aware without
// requiring a global store.
function useUrlContext(): { entity_id: string | null; declaration_id: string | null } {
  const pathname = usePathname() || '/';
  const entMatch = pathname.match(/^\/entities\/([^/]+)/);
  const declMatch = pathname.match(/^\/declarations\/([^/]+)/);
  return {
    entity_id: entMatch?.[1] ?? null,
    declaration_id: declMatch?.[1] ?? null,
  };
}

function genId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export interface ChatDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function ChatDrawer({ open, onClose }: ChatDrawerProps) {
  const context = useUrlContext();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [askingOpus, setAskingOpus] = useState(false);
  const [budget, setBudget] = useState<BudgetSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Autoscroll to newest message
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Fetch quota when the drawer opens
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/chat');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setBudget(data);
      } catch {
        // silent — budget bar simply stays hidden
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  const sendTurn = useCallback(
    async (outgoing: ChatMessage[], useOpus: boolean) => {
      setError(null);
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: outgoing.map((m) => ({ role: m.role, content: m.content })),
            use_opus: useOpus,
            context,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          const errMsg =
            data?.error?.message ||
            data?.error?.hint ||
            `Chat failed (${res.status}).`;
          setError(errMsg);
          return null;
        }
        if (data.budget) setBudget((prev) => ({ ...(prev || {} as BudgetSnapshot), ...data.budget }));
        return data as {
          reply: string;
          model: string;
          cost_eur: number;
          tokens: { input: number; output: number; cache_read: number };
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(`Network error: ${msg}`);
        return null;
      }
    },
    [context],
  );

  async function handleSend() {
    const text = input.trim();
    if (!text || sending) return;

    const userMsg: ChatMessage = { id: genId(), role: 'user', content: text };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput('');
    setSending(true);

    const result = await sendTurn(next, false);
    if (result) {
      setMessages((cur) => [
        ...cur,
        {
          id: genId(),
          role: 'assistant',
          content: result.reply,
          model: result.model,
          cost_eur: result.cost_eur,
        },
      ]);
    }
    setSending(false);
  }

  async function handleAskOpus() {
    // Find the most-recent user message preceding the last assistant
    // message, and re-run it on Opus. We drop the last assistant turn
    // because it's about to be replaced with a better answer.
    if (askingOpus || sending || messages.length === 0) return;
    const lastAssistantIdx = [...messages].reverse().findIndex((m) => m.role === 'assistant');
    if (lastAssistantIdx === -1) return;
    const realIdx = messages.length - 1 - lastAssistantIdx;
    const preceding = messages.slice(0, realIdx);

    setAskingOpus(true);
    const result = await sendTurn(preceding, true);
    if (result) {
      const opusMsg: ChatMessage = {
        id: genId(),
        role: 'assistant',
        content: result.reply,
        model: result.model,
        cost_eur: result.cost_eur,
        escalated_to_opus: true,
      };
      setMessages([...preceding, opusMsg]);
    }
    setAskingOpus(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Cmd/Ctrl+Enter sends. Plain Enter inserts newline (mirrors Slack).
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void handleSend();
    }
  }

  if (!open) return null;

  const capReached =
    budget?.over_budget === true ||
    (budget?.remaining_eur !== null && budget?.remaining_eur !== undefined && budget.remaining_eur <= 0);

  return (
    <>
      {/* Backdrop on small screens */}
      <div
        className="fixed inset-0 bg-ink/20 backdrop-blur-[2px] z-40 md:hidden"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Drawer */}
      <aside
        className="fixed right-0 top-0 bottom-0 w-full md:w-[420px] bg-surface border-l border-divider z-50 flex flex-col shadow-xl"
        role="dialog"
        aria-label="cifra assistant"
      >
        <Header
          onClose={onClose}
          budget={budget}
          contextSummary={
            context.declaration_id
              ? 'Current declaration'
              : context.entity_id
              ? 'Current client'
              : null
          }
        />

        {/* Message stream */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-4 py-4 space-y-4"
        >
          {messages.length === 0 && <EmptyState />}
          {messages.map((m, i) => (
            <MessageBubble
              key={m.id}
              message={m}
              isLast={i === messages.length - 1}
              onAskOpus={
                m.role === 'assistant' && !m.escalated_to_opus && i === messages.length - 1
                  ? handleAskOpus
                  : undefined
              }
              askingOpus={askingOpus}
            />
          ))}
          {sending && <TypingIndicator model="Haiku" />}
          {askingOpus && <TypingIndicator model="Opus" />}
        </div>

        {/* Error bar */}
        {error && (
          <div className="px-4 py-2 bg-danger-50 border-t border-danger-200 text-[12px] text-danger-700">
            {error}
          </div>
        )}

        {/* Input */}
        <div className="border-t border-divider p-3 bg-surface-alt/40">
          {capReached ? (
            <QuotaReachedBanner />
          ) : (
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={2}
                placeholder="Ask about Lux VAT, this declaration, a provider…"
                className="flex-1 resize-none text-[13px] rounded-md border border-border-strong bg-surface px-3 py-2 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 placeholder:text-ink-faint"
                disabled={sending || askingOpus}
              />
              <button
                onClick={handleSend}
                disabled={sending || askingOpus || input.trim().length === 0}
                className="h-9 w-9 inline-flex items-center justify-center rounded-md bg-brand-500 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-brand-600 transition-colors"
                aria-label="Send message"
                title="Send (Cmd/Ctrl+Enter)"
              >
                <SendIcon size={15} strokeWidth={2} />
              </button>
            </div>
          )}
          <div className="mt-1.5 text-[10.5px] text-ink-faint">
            Default answers use Haiku. Press <span className="font-medium">Ask Opus</span> on an
            answer for deeper reasoning (costs more).
          </div>
        </div>
      </aside>
    </>
  );
}

// ───────────────────────────── subcomponents ─────────────────────────────

function Header({
  onClose, budget, contextSummary,
}: {
  onClose: () => void;
  budget: BudgetSnapshot | null;
  contextSummary: string | null;
}) {
  const capLabel =
    budget?.cap_eur === null || budget?.cap_eur === undefined
      ? '—'
      : `€${budget.cap_eur.toFixed(2)}`;
  const spentLabel = budget ? `€${budget.spent_eur.toFixed(2)}` : '—';

  const pct = budget?.cap_eur ? Math.min(100, (budget.spent_eur / budget.cap_eur) * 100) : 0;

  return (
    <div className="shrink-0 border-b border-divider">
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-md bg-brand-50 text-brand-700 inline-flex items-center justify-center shrink-0">
            <SparklesIcon size={14} />
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-ink leading-tight">Ask cifra</div>
            {contextSummary && (
              <div className="text-[11px] text-ink-muted leading-tight truncate">{contextSummary} · in focus</div>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          className="w-8 h-8 inline-flex items-center justify-center rounded-md hover:bg-surface-alt text-ink-soft"
          aria-label="Close assistant"
        >
          <XIcon size={16} />
        </button>
      </div>

      {/* Quota bar */}
      {budget && budget.cap_eur !== null && (
        <div className="px-4 pb-3">
          <div className="flex items-center justify-between text-[10.5px] text-ink-muted mb-1">
            <span>{spentLabel} used this month</span>
            <span>of {capLabel}</span>
          </div>
          <div className="h-1.5 rounded-full bg-surface-alt overflow-hidden">
            <div
              className={[
                'h-full transition-all',
                budget.over_budget ? 'bg-danger-500' : budget.over_soft_warn ? 'bg-warning-500' : 'bg-brand-500',
              ].join(' ')}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="py-10 px-2 text-center">
      <div className="w-10 h-10 mx-auto rounded-lg bg-brand-50 text-brand-700 inline-flex items-center justify-center mb-3">
        <MessageSquareIcon size={18} />
      </div>
      <div className="text-[13px] font-medium text-ink">How can I help?</div>
      <div className="text-[11.5px] text-ink-muted mt-1.5 max-w-[260px] mx-auto leading-relaxed">
        I can answer Lux VAT questions, explain classification rules, and look up the current
        declaration or client. Cite me with a legal reference and I'll explain it.
      </div>
      <div className="mt-4 space-y-1.5 max-w-[280px] mx-auto">
        <SuggestionChip text="What's the deadline for this declaration?" />
        <SuggestionChip text="Explain RULE 4 (EU intra-community service)" />
        <SuggestionChip text="Is this supplier treated as EU or third-country?" />
      </div>
    </div>
  );
}

function SuggestionChip({ text }: { text: string }) {
  return (
    <div className="text-[11.5px] text-ink-soft bg-surface-alt/60 rounded px-2.5 py-1.5 italic">
      "{text}"
    </div>
  );
}

function MessageBubble({
  message,
  isLast,
  onAskOpus,
  askingOpus,
}: {
  message: ChatMessage;
  isLast: boolean;
  onAskOpus?: () => void;
  askingOpus: boolean;
}) {
  const isUser = message.role === 'user';
  return (
    <div className={isUser ? 'flex justify-end' : 'flex justify-start'}>
      <div
        className={[
          'max-w-[85%] rounded-lg px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap',
          isUser
            ? 'bg-brand-500 text-white'
            : 'bg-surface-alt text-ink border border-border',
        ].join(' ')}
      >
        {renderAssistantContent(message.content)}
        {message.role === 'assistant' && (
          <div className="mt-2 flex items-center justify-between gap-2 text-[10.5px] text-ink-muted">
            <div className="flex items-center gap-2">
              <span>{modelBadge(message.model)}</span>
              {typeof message.cost_eur === 'number' && (
                <span>€{message.cost_eur.toFixed(3)}</span>
              )}
              {message.escalated_to_opus && (
                <span className="text-brand-700 font-medium">Opus</span>
              )}
            </div>
            {onAskOpus && isLast && !askingOpus && (
              <button
                onClick={onAskOpus}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-brand-700 hover:text-brand-800"
                title="Re-ask this question on Opus (costs more)"
              >
                <SparklesIcon size={11} /> Ask Opus
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Very light-weight rendering: turn `[LTVA Art. 44]` style citations into
// visually-distinct pills. Full legal-ref clickability is a P1 polish.
function renderAssistantContent(text: string): React.ReactNode {
  const parts = text.split(/(\[[A-Z_][A-Z0-9_. §§§()-]*(?:\sArt\.?\s\d+[a-z]*)?(?:§\d+)?(?:\s\w+)?])/gi);
  return parts.map((p, i) => {
    if (p.startsWith('[') && p.endsWith(']')) {
      return (
        <span
          key={i}
          className="inline-block bg-brand-50 text-brand-700 rounded px-1.5 py-0.5 text-[11px] font-mono mx-0.5 align-baseline"
        >
          {p.slice(1, -1)}
        </span>
      );
    }
    return <span key={i}>{p}</span>;
  });
}

function modelBadge(model?: string): string {
  if (!model) return '';
  if (model.includes('haiku')) return 'Haiku';
  if (model.includes('opus'))  return 'Opus';
  if (model.includes('sonnet')) return 'Sonnet';
  return model;
}

function TypingIndicator({ model }: { model: string }) {
  return (
    <div className="flex justify-start">
      <div className="bg-surface-alt text-ink-muted border border-border rounded-lg px-3 py-2 text-[12px] flex items-center gap-2">
        <Loader2Icon size={12} className="animate-spin" />
        <span>{model} is thinking…</span>
      </div>
    </div>
  );
}

function QuotaReachedBanner() {
  return (
    <div className="bg-warning-50 border border-warning-200 rounded px-3 py-2.5 text-[12px] text-warning-800">
      <div className="font-medium mb-0.5">Monthly AI quota reached</div>
      <div className="text-[11.5px]">
        Your chat resumes on the 1st of next month, or ask your admin to raise the cap in{' '}
        <a href="/settings" className="underline">Settings</a>.
      </div>
    </div>
  );
}
