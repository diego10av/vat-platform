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
import {
  XIcon, SendIcon, SparklesIcon, Loader2Icon, MessageSquareIcon,
  HistoryIcon, PlusIcon, Trash2Icon, ChevronLeftIcon, PencilIcon, CheckIcon,
} from 'lucide-react';
import { parseBlocks, type InlineNode, type BlockNode } from './render-markdown';

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

interface ThreadSummary {
  id: string;
  title: string;
  total_cost_eur: number;
  updated_at: string;
  entity_id: string | null;
  declaration_id: string | null;
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

  // Persisted-thread state. All tolerant of migration 001 not being
  // applied: threadId stays null, history view is empty, everything
  // still works statelessly.
  const [threadId, setThreadId] = useState<string | null>(null);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);

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

  // ── Streaming turn sender ──
  //
  // Opens POST /api/chat/stream, parses Server-Sent Events, pipes
  // text deltas to `onDelta` so the UI can progressively append to
  // the live assistant bubble. Resolves with the final metadata
  // (or null on error / 429).
  const streamTurn = useCallback(
    async (
      outgoing: ChatMessage[],
      useOpus: boolean,
      onDelta: (chunk: string) => void,
    ): Promise<{
      reply: string;
      model: string;
      cost_eur: number;
      thread_id: string | null;
    } | null> => {
      setError(null);
      try {
        const res = await fetch('/api/chat/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: outgoing.map((m) => ({ role: m.role, content: m.content })),
            use_opus: useOpus,
            context,
            thread_id: threadId,
          }),
        });

        // Gate rejections (rate limit, budget, validation) come back as
        // regular JSON with non-2xx; handle them like the old endpoint.
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          const errMsg =
            data?.error?.message ||
            data?.error?.hint ||
            `Chat failed (${res.status}).`;
          setError(errMsg);
          return null;
        }
        if (!res.body) {
          setError('Chat endpoint returned no stream body.');
          return null;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let accumulated = '';
        let finalPayload: {
          reply: string; model: string; cost_eur: number;
          thread_id: string | null;
          tokens?: { input: number; output: number; cache_read: number };
          budget?: BudgetSnapshot;
        } | null = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // SSE events are separated by a double newline.
          let sep: number;
          while ((sep = buffer.indexOf('\n\n')) !== -1) {
            const raw = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            const dataLine = raw.split('\n').find((l) => l.startsWith('data:'));
            if (!dataLine) continue;
            const json = dataLine.slice(5).trim();
            if (!json) continue;
            try {
              const ev = JSON.parse(json) as
                | { type: 'text_delta'; text: string }
                | { type: 'done'; reply: string; model: string; cost_eur: number;
                    thread_id: string | null; tokens: { input: number; output: number; cache_read: number };
                    budget: BudgetSnapshot }
                | { type: 'error'; message: string };
              if (ev.type === 'text_delta') {
                accumulated += ev.text;
                onDelta(ev.text);
              } else if (ev.type === 'done') {
                finalPayload = ev;
                if (ev.budget) {
                  setBudget((prev) => ({ ...(prev || {} as BudgetSnapshot), ...ev.budget }));
                }
                if (typeof ev.thread_id === 'string') {
                  setThreadId(ev.thread_id);
                }
              } else if (ev.type === 'error') {
                setError(ev.message);
                return null;
              }
            } catch {
              // skip malformed event rather than abort the whole stream
            }
          }
        }

        if (!finalPayload) {
          // Stream closed without a done event — fall back to the
          // accumulated text as the reply.
          return {
            reply: accumulated,
            model: useOpus ? 'claude-opus-4-5' : 'claude-haiku-4-5',
            cost_eur: 0,
            thread_id: threadId,
          };
        }
        return finalPayload;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(`Network error: ${msg}`);
        return null;
      }
    },
    [context, threadId],
  );

  async function handleSend() {
    const text = input.trim();
    if (!text || sending) return;

    const userMsg: ChatMessage = { id: genId(), role: 'user', content: text };
    // Insert a placeholder assistant bubble that we'll stream into.
    const assistantId = genId();
    const assistantPlaceholder: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
    };
    const outgoing = [...messages, userMsg];
    setMessages([...outgoing, assistantPlaceholder]);
    setInput('');
    setSending(true);

    const result = await streamTurn(outgoing, false, (chunk) => {
      // Append to the placeholder's content as each delta arrives.
      setMessages((cur) =>
        cur.map((m) =>
          m.id === assistantId ? { ...m, content: m.content + chunk } : m,
        ),
      );
    });

    if (result) {
      // Finalise the placeholder with canonical model + cost fields.
      setMessages((cur) =>
        cur.map((m) =>
          m.id === assistantId
            ? { ...m, content: result.reply, model: result.model, cost_eur: result.cost_eur }
            : m,
        ),
      );
    } else {
      // Failure — drop the empty placeholder so the UI doesn't show a blank bubble.
      setMessages((cur) => cur.filter((m) => m.id !== assistantId));
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

    const assistantId = genId();
    const placeholder: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      escalated_to_opus: true,
    };
    setMessages([...preceding, placeholder]);
    setAskingOpus(true);

    const result = await streamTurn(preceding, true, (chunk) => {
      setMessages((cur) =>
        cur.map((m) =>
          m.id === assistantId ? { ...m, content: m.content + chunk } : m,
        ),
      );
    });

    if (result) {
      setMessages((cur) =>
        cur.map((m) =>
          m.id === assistantId
            ? { ...m, content: result.reply, model: result.model, cost_eur: result.cost_eur }
            : m,
        ),
      );
    } else {
      setMessages((cur) => cur.filter((m) => m.id !== assistantId));
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

  // ── Thread management ──

  async function openHistory() {
    setShowHistory(true);
    try {
      const res = await fetch('/api/chat/threads');
      if (!res.ok) return;
      const data = await res.json();
      setThreads(Array.isArray(data?.threads) ? data.threads : []);
    } catch {
      // silent — history panel shows empty + "no saved conversations"
    }
  }

  async function switchToThread(id: string) {
    setLoadingThread(true);
    setError(null);
    try {
      const res = await fetch(`/api/chat/threads/${id}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? 'Could not load that conversation.');
        return;
      }
      type ApiMessage = {
        id: string;
        role: 'user' | 'assistant' | 'system';
        content: string;
        model: string | null;
        cost_eur: number | null;
        escalated_to_opus: boolean;
      };
      const rebuilt: ChatMessage[] = (data.messages as ApiMessage[])
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({
          id: m.id,
          role: m.role as Role,
          content: m.content,
          model: m.model ?? undefined,
          cost_eur: m.cost_eur ?? undefined,
          escalated_to_opus: m.escalated_to_opus || undefined,
        }));
      setMessages(rebuilt);
      setThreadId(id);
      setShowHistory(false);
    } finally {
      setLoadingThread(false);
    }
  }

  function newChat() {
    setThreadId(null);
    setMessages([]);
    setError(null);
    setShowHistory(false);
  }

  async function archiveCurrentThread(id: string) {
    if (!confirm('Archive this conversation? It will disappear from the list.')) return;
    try {
      await fetch(`/api/chat/threads/${id}`, { method: 'DELETE' });
      setThreads((cur) => cur.filter((t) => t.id !== id));
      if (threadId === id) {
        newChat();
      }
    } catch {
      // silent
    }
  }

  async function renameThread(id: string, title: string) {
    const safe = title.trim().slice(0, 200);
    if (!safe) return;
    // Optimistic update — flip the cached list before the server responds.
    setThreads((cur) => cur.map((t) => (t.id === id ? { ...t, title: safe } : t)));
    try {
      await fetch(`/api/chat/threads/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: safe }),
      });
    } catch {
      // silent — the optimistic title stays locally; next history load
      // would reconcile if the server rejected.
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
          showHistory={showHistory}
          onToggleHistory={showHistory ? () => setShowHistory(false) : openHistory}
          onNewChat={newChat}
          hasMessages={messages.length > 0}
        />

        {/* History panel (replaces message stream when open) */}
        {showHistory ? (
          <HistoryPanel
            threads={threads}
            currentThreadId={threadId}
            onPick={switchToThread}
            onArchive={archiveCurrentThread}
            onRename={renameThread}
            loading={loadingThread}
          />
        ) : (
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
                  m.role === 'assistant' && !m.escalated_to_opus && i === messages.length - 1 && !sending && !askingOpus
                    ? handleAskOpus
                    : undefined
                }
                askingOpus={askingOpus}
              />
            ))}
            {/* Show the "Haiku/Opus is thinking" indicator only until the
                first delta lands — after that the streamed bubble itself
                is the live feedback, and a second spinner is noise. */}
            {(sending || askingOpus) && (() => {
              const last = messages[messages.length - 1];
              const bubbleIsGrowing = last?.role === 'assistant' && last.content.length > 0;
              if (bubbleIsGrowing) return null;
              return <TypingIndicator model={askingOpus ? 'Opus' : 'Haiku'} />;
            })()}
          </div>
        )}

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
  onClose, budget, contextSummary, showHistory, onToggleHistory, onNewChat, hasMessages,
}: {
  onClose: () => void;
  budget: BudgetSnapshot | null;
  contextSummary: string | null;
  showHistory: boolean;
  onToggleHistory: () => void;
  onNewChat: () => void;
  hasMessages: boolean;
}) {
  const capLabel =
    budget?.cap_eur === null || budget?.cap_eur === undefined
      ? '—'
      : `€${budget.cap_eur.toFixed(2)}`;
  const spentLabel = budget ? `€${budget.spent_eur.toFixed(2)}` : '—';

  const pct = budget?.cap_eur ? Math.min(100, (budget.spent_eur / budget.cap_eur) * 100) : 0;

  return (
    <div className="shrink-0 border-b border-divider">
      <div className="px-4 py-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {showHistory ? (
            <button
              onClick={onToggleHistory}
              className="w-7 h-7 inline-flex items-center justify-center rounded-md hover:bg-surface-alt text-ink-soft"
              aria-label="Back to chat"
              title="Back to chat"
            >
              <ChevronLeftIcon size={16} />
            </button>
          ) : (
            <div className="w-7 h-7 rounded-md bg-brand-50 text-brand-700 inline-flex items-center justify-center shrink-0">
              <SparklesIcon size={14} />
            </div>
          )}
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-ink leading-tight">
              {showHistory ? 'Conversations' : 'Ask cifra'}
            </div>
            {!showHistory && contextSummary && (
              <div className="text-[11px] text-ink-muted leading-tight truncate">{contextSummary} · in focus</div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {!showHistory && hasMessages && (
            <button
              onClick={onNewChat}
              className="w-8 h-8 inline-flex items-center justify-center rounded-md hover:bg-surface-alt text-ink-soft"
              aria-label="New chat"
              title="New chat"
            >
              <PlusIcon size={15} />
            </button>
          )}
          {!showHistory && (
            <button
              onClick={onToggleHistory}
              className="w-8 h-8 inline-flex items-center justify-center rounded-md hover:bg-surface-alt text-ink-soft"
              aria-label="Conversation history"
              title="Conversation history"
            >
              <HistoryIcon size={15} />
            </button>
          )}
          <button
            onClick={onClose}
            className="w-8 h-8 inline-flex items-center justify-center rounded-md hover:bg-surface-alt text-ink-soft"
            aria-label="Close assistant"
          >
            <XIcon size={16} />
          </button>
        </div>
      </div>

      {/* Quota bar — hidden when showing history to keep the panel quiet */}
      {!showHistory && budget && budget.cap_eur !== null && (
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

function HistoryPanel({
  threads, currentThreadId, onPick, onArchive, onRename, loading,
}: {
  threads: ThreadSummary[];
  currentThreadId: string | null;
  onPick: (id: string) => void;
  onArchive: (id: string) => void;
  onRename: (id: string, title: string) => void;
  loading: boolean;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-[12px] text-ink-muted gap-2">
        <Loader2Icon size={14} className="animate-spin" /> Loading conversation…
      </div>
    );
  }

  if (threads.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <div className="w-10 h-10 rounded-lg bg-surface-alt text-ink-muted inline-flex items-center justify-center mb-3">
          <HistoryIcon size={16} />
        </div>
        <div className="text-[13px] font-medium text-ink">No saved conversations</div>
        <div className="text-[11.5px] text-ink-muted mt-1.5 max-w-[260px] leading-relaxed">
          Ask something to start a new conversation. Once you send a
          message, it's saved here and you can come back to it anytime.
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <ul className="divide-y divide-divider">
        {threads.map((t) => {
          const updated = new Date(t.updated_at);
          const niceDate = updated.toLocaleDateString('en-GB', {
            day: '2-digit', month: 'short',
            year: updated.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
          });
          const isActive = t.id === currentThreadId;
          const isEditing = editingId === t.id;
          return (
            <li key={t.id} className={isActive ? 'bg-brand-50/50' : ''}>
              <div className="flex items-start gap-1 px-4 py-3 group">
                {isEditing ? (
                  <InlineTitleEditor
                    initial={t.title}
                    onSave={(title) => {
                      onRename(t.id, title);
                      setEditingId(null);
                    }}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <button
                    onClick={() => onPick(t.id)}
                    className="flex-1 text-left min-w-0"
                  >
                    <div className="text-[13px] font-medium text-ink truncate">{t.title || 'Untitled'}</div>
                    <div className="text-[11px] text-ink-muted mt-0.5 flex items-center gap-2">
                      <span>{niceDate}</span>
                      {t.total_cost_eur > 0 && (
                        <>
                          <span className="text-ink-faint">·</span>
                          <span className="tabular-nums">€{t.total_cost_eur.toFixed(2)}</span>
                        </>
                      )}
                    </div>
                  </button>
                )}
                {!isEditing && (
                  <>
                    <button
                      onClick={() => setEditingId(t.id)}
                      className="opacity-0 group-hover:opacity-100 w-7 h-7 inline-flex items-center justify-center rounded-md hover:bg-surface-alt text-ink-muted hover:text-ink transition-opacity"
                      aria-label="Rename conversation"
                      title="Rename"
                    >
                      <PencilIcon size={13} />
                    </button>
                    <button
                      onClick={() => onArchive(t.id)}
                      className="opacity-0 group-hover:opacity-100 w-7 h-7 inline-flex items-center justify-center rounded-md hover:bg-surface-alt text-ink-muted hover:text-danger-600 transition-opacity"
                      aria-label="Archive conversation"
                      title="Archive"
                    >
                      <Trash2Icon size={13} />
                    </button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// Inline editor used inside a thread row. Enter saves, Escape cancels,
// blur saves (but save suppresses if the value is unchanged).
function InlineTitleEditor({
  initial, onSave, onCancel,
}: { initial: string; onSave: (title: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  function commit() {
    const trimmed = value.trim();
    if (!trimmed) {
      onCancel();
      return;
    }
    if (trimmed === initial.trim()) {
      onCancel();
      return;
    }
    onSave(trimmed);
  }

  return (
    <div className="flex-1 flex items-center gap-1">
      <input
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        onBlur={commit}
        maxLength={200}
        className="flex-1 bg-surface border border-brand-300 rounded px-2 py-1 text-[13px] text-ink focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
      />
      <button
        onClick={commit}
        onMouseDown={(e) => e.preventDefault()} // prevent blur → commit order race
        className="w-7 h-7 inline-flex items-center justify-center rounded-md text-brand-700 hover:bg-brand-50"
        aria-label="Save title"
      >
        <CheckIcon size={13} />
      </button>
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
          'max-w-[85%] rounded-lg px-3 py-2 text-[13px] leading-relaxed',
          isUser
            ? 'bg-brand-500 text-white whitespace-pre-wrap'
            : 'bg-surface-alt text-ink border border-border',
        ].join(' ')}
      >
        {isUser ? message.content : renderAssistantContent(message.content)}
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

// Render an assistant message. Parsing → AST → React. The parser
// lives in ./render-markdown.ts so it's unit-testable.
function renderAssistantContent(text: string): React.ReactNode {
  const blocks = parseBlocks(text);
  return <div className="leading-relaxed">{blocks.map(renderBlock)}</div>;
}

function renderBlock(b: BlockNode, i: number): React.ReactNode {
  switch (b.kind) {
    case 'paragraph':
      return (
        <p key={i} className="my-1 first:mt-0 last:mb-0">
          {b.children.map(renderInlineNode)}
        </p>
      );
    case 'ul':
      return (
        <ul key={i} className="list-disc pl-5 space-y-0.5 my-1">
          {b.items.map((children, j) => (
            <li key={j}>{children.map(renderInlineNode)}</li>
          ))}
        </ul>
      );
    case 'ol':
      return (
        <ol key={i} className="list-decimal pl-5 space-y-0.5 my-1">
          {b.items.map((children, j) => (
            <li key={j}>{children.map(renderInlineNode)}</li>
          ))}
        </ol>
      );
  }
}

function renderInlineNode(node: InlineNode, i: number): React.ReactNode {
  switch (node.kind) {
    case 'text':
      return <span key={i}>{node.text}</span>;
    case 'bold':
      return <strong key={i} className="font-semibold">{node.text}</strong>;
    case 'code':
      return (
        <code
          key={i}
          className="bg-surface-alt text-ink font-mono text-[11.5px] px-1 py-0.5 rounded"
        >
          {node.text}
        </code>
      );
    case 'legal':
      return (
        <span
          key={i}
          className="inline-block bg-brand-50 text-brand-700 rounded px-1.5 py-0.5 text-[11px] font-mono mx-0.5 align-baseline"
        >
          {node.text}
        </span>
      );
  }
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
