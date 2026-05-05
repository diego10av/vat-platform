'use client';

// ════════════════════════════════════════════════════════════════════════
// FeedbackWidget — floating "Report issue" button bottom-right of every
// authed page. Click → modal with category + severity + message fields.
// Submits to /api/feedback, persisting to the feedback table.
//
// Features:
// - Auto-captures URL, user-agent, and whichever entity/declaration id
//   is in the URL (the server re-derives too, but we send it so the
//   reviewer sees "feedback attached to Horizon SCSp Q1" in the UI).
// - If submission fails (server down, migration 002 missing), the
//   message is stashed in localStorage so the user doesn't lose it;
//   next time they submit, we drain the queue first.
// - Kept tiny in layout: 40px pill bottom-right, doesn't obstruct.
// - Auto-hides on /login (public page).
// ════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import {
  MessageCircleIcon, XIcon, CheckIcon, AlertTriangleIcon, Loader2Icon,
  BugIcon, LightbulbIcon, HelpCircleIcon, Wand2Icon,
} from 'lucide-react';

const QUEUE_KEY = 'cifra_feedback_queue_v1';

const HIDDEN_PATH_PREFIXES = ['/login'];

type Category = 'bug' | 'ux' | 'feature' | 'question' | 'other';
type Severity = 'low' | 'medium' | 'high';

interface QueuedItem {
  category: Category;
  severity: Severity;
  message: string;
  contact: string | null;
  url: string;
  user_agent: string;
  queued_at: string;
}

export function FeedbackWidget() {
  const pathname = usePathname() || '/';
  const [open, setOpen] = useState(false);

  // Don't render on hidden paths. Cheap guard — the Widget always
  // mounts, but quickly short-circuits.
  const hidden = HIDDEN_PATH_PREFIXES.some((p) =>
    p.endsWith('/') ? pathname.startsWith(p) : pathname === p || pathname.startsWith(p + '/'),
  );

  // Global shortcut: "?" opens the modal from anywhere. Made for demo
  // mode — Diego is screensharing, something looks off, he hits "?"
  // and types a note without reaching for the mouse. Suppress the
  // shortcut when focus is in any input / textarea / contentEditable
  // so users who type "?" into the chat field don't get hijacked.
  useEffect(() => {
    if (hidden) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== '?') return;
      const el = document.activeElement as HTMLElement | null;
      if (!el) { setOpen(true); return; }
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (el.isContentEditable) return;
      e.preventDefault();
      setOpen(true);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [hidden]);

  if (hidden) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-drawer h-10 px-3 rounded-full bg-surface border border-border-strong shadow-md hover:shadow-lg hover:border-brand-400 transition-all inline-flex items-center gap-1.5 text-sm font-medium text-ink-soft hover:text-brand-700"
        aria-label="Report an issue or feedback (shortcut: ?)"
        title="Report an issue — press ? anywhere"
      >
        <MessageCircleIcon size={14} />
        <span className="hidden sm:inline">Feedback</span>
      </button>
      {open && <FeedbackModal onClose={() => setOpen(false)} />}
    </>
  );
}

function FeedbackModal({ onClose }: { onClose: () => void }) {
  const [category, setCategory] = useState<Category>('bug');
  const [severity, setSeverity] = useState<Severity>('medium');
  const [message, setMessage] = useState('');
  const [contact, setContact] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [queuedCount, setQueuedCount] = useState(0);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  // Check if we have a localStorage queue from previous failed sends.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(QUEUE_KEY);
      if (!raw) return;
      const queue = JSON.parse(raw) as QueuedItem[];
      if (Array.isArray(queue)) setQueuedCount(queue.length);
    } catch { /* noop */ }
  }, []);

  const drainQueue = useCallback(async () => {
    try {
      const raw = localStorage.getItem(QUEUE_KEY);
      if (!raw) return;
      const queue = JSON.parse(raw) as QueuedItem[];
      if (!Array.isArray(queue) || queue.length === 0) return;

      const remaining: QueuedItem[] = [];
      for (const item of queue) {
        const res = await fetch('/api/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item),
        });
        if (!res.ok) remaining.push(item);
      }
      if (remaining.length === 0) {
        localStorage.removeItem(QUEUE_KEY);
        setQueuedCount(0);
      } else {
        localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
        setQueuedCount(remaining.length);
      }
    } catch { /* noop */ }
  }, []);

  async function submit() {
    if (!message.trim()) {
      setError('Please describe what happened.');
      return;
    }
    setSubmitting(true);
    setError(null);
    setSchemaMissing(false);

    const payload = {
      category, severity,
      message: message.trim(),
      contact: contact.trim() || null,
      url: window.location.href,
      user_agent: navigator.userAgent,
    };

    try {
      // Opportunistically try to drain any queued reports first.
      await drainQueue();

      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (res.status === 501 && data?.error?.code === 'schema_missing') {
        // Stash locally — don't lose their words.
        queueLocally(payload);
        setSchemaMissing(true);
        setSubmitted(true);
        return;
      }
      if (!res.ok) {
        // Any other server error — also queue locally so we don't
        // lose the input; give user a clear error.
        queueLocally(payload);
        setError(data?.error?.message ?? 'Could not submit. Saved locally and will retry.');
        return;
      }
      setSubmitted(true);
    } catch (e) {
      queueLocally(payload);
      setError(e instanceof Error ? e.message : 'Network error. Saved locally and will retry.');
    } finally {
      setSubmitting(false);
    }
  }

  function queueLocally(payload: Omit<QueuedItem, 'queued_at'>) {
    try {
      const existing = localStorage.getItem(QUEUE_KEY);
      const queue: QueuedItem[] = existing ? JSON.parse(existing) : [];
      queue.push({ ...payload, queued_at: new Date().toISOString() });
      localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
      setQueuedCount(queue.length);
    } catch { /* noop */ }
  }

  return (
    <div
      className="fixed inset-0 z-modal bg-ink/75 backdrop-blur-[6px] flex items-center justify-center p-4 animate-fadeIn"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-lg w-full max-w-md shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="fb-modal-title"
      >
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-brand-50 text-brand-700 inline-flex items-center justify-center shrink-0">
              <MessageCircleIcon size={13} />
            </div>
            <div>
              <h3 id="fb-modal-title" className="text-base font-semibold text-ink leading-tight">Report an issue</h3>
              <div className="text-xs text-ink-muted leading-tight mt-0.5">
                Anything off? Tell me.
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 inline-flex items-center justify-center rounded-md hover:bg-surface-alt text-ink-soft"
            aria-label="Close"
          >
            <XIcon size={15} />
          </button>
        </div>

        <div className="p-5">
          {submitted ? (
            <SubmittedState schemaMissing={schemaMissing} onClose={onClose} />
          ) : (
            <>
              {queuedCount > 0 && (
                <div className="mb-3 text-xs text-warning-800 bg-warning-50 border border-warning-200 rounded px-3 py-2">
                  {queuedCount} earlier report{queuedCount === 1 ? '' : 's'} saved locally — will retry when this one sends.
                </div>
              )}

              {/* Category chips */}
              <label className="block mb-3">
                <span className="block text-xs uppercase tracking-wide font-semibold text-ink-muted mb-1.5">
                  Type
                </span>
                <div className="grid grid-cols-4 gap-1.5">
                  <CategoryChip icon={<BugIcon size={13} />}       label="Bug"      active={category === 'bug'}      onClick={() => setCategory('bug')} />
                  <CategoryChip icon={<LightbulbIcon size={13} />} label="UX"       active={category === 'ux'}       onClick={() => setCategory('ux')} />
                  <CategoryChip icon={<Wand2Icon size={13} />}     label="Idea"     active={category === 'feature'}  onClick={() => setCategory('feature')} />
                  <CategoryChip icon={<HelpCircleIcon size={13} />} label="Question" active={category === 'question'} onClick={() => setCategory('question')} />
                </div>
              </label>

              {/* Severity */}
              <label className="block mb-3">
                <span className="block text-xs uppercase tracking-wide font-semibold text-ink-muted mb-1.5">
                  Severity
                </span>
                <div className="grid grid-cols-3 gap-1.5">
                  <SevChip label="Low"    active={severity === 'low'}    onClick={() => setSeverity('low')} />
                  <SevChip label="Medium" active={severity === 'medium'} onClick={() => setSeverity('medium')} />
                  <SevChip label="High"   active={severity === 'high'}   onClick={() => setSeverity('high')} />
                </div>
              </label>

              {/* Message */}
              <label className="block mb-3">
                <span className="block text-xs uppercase tracking-wide font-semibold text-ink-muted mb-1">
                  What happened?
                </span>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={5}
                  placeholder="Describe what you did, what you expected, what actually happened. The URL and timestamp are captured automatically."
                  maxLength={5000}
                  className="w-full border border-border-strong rounded px-3 py-2 text-sm resize-none"
                  autoFocus
                />
                <div className="text-2xs text-ink-faint mt-1 text-right">
                  {message.length} / 5000
                </div>
              </label>

              {/* Contact (optional) */}
              <label className="block mb-3">
                <span className="block text-xs uppercase tracking-wide font-semibold text-ink-muted mb-1">
                  Reply-to (optional)
                </span>
                <input
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  placeholder="email or slack handle if you want a response"
                  className="w-full border border-border-strong rounded px-3 py-2 text-sm"
                />
              </label>

              {error && (
                <div className="mb-3 text-xs text-danger-700 bg-danger-50 border border-danger-200 rounded px-3 py-2 flex items-start gap-2">
                  <AlertTriangleIcon size={13} className="mt-0.5 shrink-0" />
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        {!submitted && (
          <div className="px-5 py-3 border-t border-border bg-surface-alt flex items-center justify-between gap-2">
            <div className="text-2xs text-ink-faint">
              captured: current URL + user-agent + page context
            </div>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="h-9 px-3 rounded border border-border-strong text-sm font-medium text-ink-soft hover:bg-surface-alt"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={submitting || !message.trim()}
                className="h-9 px-4 rounded bg-brand-500 text-white text-sm font-semibold hover:bg-brand-600 disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {submitting ? (
                  <><Loader2Icon size={13} className="animate-spin" /> Sending…</>
                ) : (
                  <><CheckIcon size={13} /> Send</>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SubmittedState({ schemaMissing, onClose }: { schemaMissing: boolean; onClose: () => void }) {
  return (
    <div className="text-center py-4">
      <div className="w-12 h-12 mx-auto rounded-full bg-emerald-50 text-emerald-600 inline-flex items-center justify-center mb-3">
        <CheckIcon size={20} />
      </div>
      <div className="text-base font-semibold text-ink">Thanks — got it.</div>
      <div className="text-sm text-ink-soft mt-2 max-w-sm mx-auto leading-relaxed">
        {schemaMissing ? (
          <>
            Your message is saved locally. Once the admin applies the
            feedback migration (<code className="text-xs bg-surface-alt px-1 rounded">002_feedback.sql</code>), it
            will be sent on your next submission.
          </>
        ) : (
          <>
            Your report is in the triage queue at{' '}
            <code className="text-xs bg-surface-alt px-1 rounded">/settings/feedback</code>.
            Thanks for making the product better.
          </>
        )}
      </div>
      <button
        onClick={onClose}
        className="mt-5 h-9 px-4 rounded bg-brand-500 text-white text-sm font-semibold hover:bg-brand-600"
      >
        Done
      </button>
    </div>
  );
}

function CategoryChip({
  icon, label, active, onClick,
}: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={[
        'h-9 inline-flex items-center justify-center gap-1 rounded border text-sm font-medium transition-colors cursor-pointer',
        active
          ? 'bg-brand-50 text-brand-700 border-brand-200'
          : 'bg-surface text-ink-soft border-border hover:bg-surface-alt',
      ].join(' ')}
    >
      {icon} {label}
    </button>
  );
}

function SevChip({
  label, active, onClick,
}: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={[
        'h-8 inline-flex items-center justify-center rounded border text-xs font-medium transition-colors cursor-pointer',
        active
          ? 'bg-brand-50 text-brand-700 border-brand-200'
          : 'bg-surface text-ink-soft border-border hover:bg-surface-alt',
      ].join(' ')}
    >
      {label}
    </button>
  );
}
