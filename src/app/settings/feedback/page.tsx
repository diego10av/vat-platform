'use client';

// ════════════════════════════════════════════════════════════════════════
// /settings/feedback — admin triage view for in-product feedback.
//
// Lists every submission grouped by status (new / triaged / resolved /
// wontfix). Lets you change status inline, add a resolution note, or
// hard-delete spam. Schema-missing → clean upgrade prompt.
// ════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  MessageCircleIcon, AlertTriangleIcon, BugIcon, LightbulbIcon,
  Wand2Icon, HelpCircleIcon, TrashIcon, ExternalLinkIcon,
} from 'lucide-react';
import { PageSkeleton } from '@/components/ui/Skeleton';

interface Feedback {
  id: string;
  user_id: string | null;
  url: string;
  entity_id: string | null;
  entity_name: string | null;
  declaration_id: string | null;
  user_agent: string | null;
  category: 'bug' | 'ux' | 'feature' | 'question' | 'other';
  severity: 'low' | 'medium' | 'high';
  message: string;
  contact: string | null;
  status: 'new' | 'triaged' | 'resolved' | 'wontfix';
  resolution_note: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

const CATEGORY_META: Record<Feedback['category'], { label: string; icon: React.ComponentType<{ size?: number }>; colour: string }> = {
  bug:      { label: 'Bug',      icon: BugIcon,        colour: 'bg-red-100 text-red-700 border-red-200' },
  ux:       { label: 'UX',       icon: LightbulbIcon,  colour: 'bg-amber-100 text-amber-700 border-amber-200' },
  feature:  { label: 'Idea',     icon: Wand2Icon,      colour: 'bg-purple-100 text-purple-700 border-purple-200' },
  question: { label: 'Question', icon: HelpCircleIcon, colour: 'bg-blue-100 text-blue-700 border-blue-200' },
  other:    { label: 'Other',    icon: MessageCircleIcon, colour: 'bg-surface-alt text-ink-soft border-border' },
};

const SEVERITY_COLOUR: Record<Feedback['severity'], string> = {
  low: 'text-ink-muted',
  medium: 'text-warning-700',
  high: 'text-danger-700 font-semibold',
};

export default function FeedbackAdminPage() {
  const [items, setItems] = useState<Feedback[] | null>(null);
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/feedback');
      const data = await res.json();
      if (data?.schema_missing) {
        setSchemaMissing(true);
        setItems([]);
        return;
      }
      if (!res.ok) {
        setError(data?.error?.message ?? 'Failed to load feedback.');
        setItems([]);
        return;
      }
      setItems(data.feedback as Feedback[]);
      setSchemaMissing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
      setItems([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function patchItem(id: string, patch: Partial<Feedback>) {
    try {
      const res = await fetch(`/api/feedback/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error?.message ?? 'Update failed.');
        return;
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    }
  }

  async function deleteItem(id: string) {
    if (!confirm('Hard-delete this feedback? Usually prefer "wontfix" for audit trail.')) return;
    try {
      const res = await fetch(`/api/feedback/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error?.message ?? 'Delete failed.');
        return;
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    }
  }

  if (items === null) return <PageSkeleton />;

  const counts = {
    new: items.filter(i => i.status === 'new').length,
    triaged: items.filter(i => i.status === 'triaged').length,
    resolved: items.filter(i => i.status === 'resolved').length,
    wontfix: items.filter(i => i.status === 'wontfix').length,
  };

  return (
    <div>
      <div className="mb-5">
        <div className="text-[11px] text-ink-faint mb-1">
          <Link href="/settings" className="hover:underline">Settings</Link> ›
        </div>
        <h1 className="text-[20px] font-semibold tracking-tight flex items-center gap-2">
          <MessageCircleIcon size={18} className="text-brand-500" /> Feedback triage
        </h1>
        <p className="text-[12.5px] text-ink-muted mt-1 max-w-xl">
          In-product reports from the floating button. Triage new → resolved.
        </p>
      </div>

      {schemaMissing && (
        <div className="mb-6 rounded-xl border border-warning-200 bg-gradient-to-br from-warning-50 to-surface p-5 flex items-start gap-4">
          <div className="w-9 h-9 rounded-lg bg-warning-500 text-white inline-flex items-center justify-center shrink-0">
            <AlertTriangleIcon size={16} />
          </div>
          <div>
            <h3 className="text-[14px] font-semibold text-ink">Migration not applied</h3>
            <p className="text-[12.5px] text-ink-soft mt-1 leading-relaxed">
              Apply <code className="text-[11.5px] bg-surface-alt px-1 py-0.5 rounded">migrations/002_feedback.sql</code> to
              enable feedback collection. Until then, user submissions are stashed in their browser localStorage
              and will be sent on the first post-migration retry.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 text-[12px] text-danger-700 bg-danger-50 border border-danger-200 rounded px-3 py-2">
          {error}
        </div>
      )}

      {/* Counter strip */}
      {!schemaMissing && (
        <div className="grid grid-cols-4 gap-2 mb-5">
          <CounterCard label="New"      count={counts.new}      tone="brand" />
          <CounterCard label="Triaged"  count={counts.triaged}  tone="amber" />
          <CounterCard label="Resolved" count={counts.resolved} tone="emerald" />
          <CounterCard label="Won't fix" count={counts.wontfix} tone="neutral" />
        </div>
      )}

      {/* List */}
      {!schemaMissing && items.length === 0 && (
        <div className="bg-surface border border-border rounded-lg p-8 text-center">
          <div className="w-10 h-10 mx-auto rounded-lg bg-surface-alt text-ink-muted inline-flex items-center justify-center mb-3">
            <MessageCircleIcon size={16} />
          </div>
          <div className="text-[13px] font-medium text-ink">No feedback yet</div>
          <div className="text-[11.5px] text-ink-muted mt-1.5 max-w-sm mx-auto">
            Ask your partner to tap the Feedback button bottom-right while testing.
          </div>
        </div>
      )}

      {!schemaMissing && items.length > 0 && (
        <div className="space-y-2">
          {items.map((item) => (
            <FeedbackCard
              key={item.id}
              item={item}
              onStatusChange={(status) => patchItem(item.id, { status })}
              onResolutionNote={(note) => patchItem(item.id, { resolution_note: note })}
              onDelete={() => deleteItem(item.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CounterCard({
  label, count, tone,
}: { label: string; count: number; tone: 'brand' | 'amber' | 'emerald' | 'neutral' }) {
  const colours = {
    brand:   'bg-brand-50 text-brand-700 border-brand-100',
    amber:   'bg-amber-50 text-amber-700 border-amber-100',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    neutral: 'bg-surface border-border text-ink-soft',
  };
  return (
    <div className={`rounded-lg border p-3 ${colours[tone]}`}>
      <div className="text-[10.5px] uppercase tracking-wide font-semibold opacity-80">{label}</div>
      <div className="text-[22px] font-bold tabular-nums mt-0.5">{count}</div>
    </div>
  );
}

function FeedbackCard({
  item, onStatusChange, onResolutionNote, onDelete,
}: {
  item: Feedback;
  onStatusChange: (status: Feedback['status']) => void;
  onResolutionNote: (note: string) => void;
  onDelete: () => void;
}) {
  const meta = CATEGORY_META[item.category];
  const Icon = meta.icon;
  const [notesOpen, setNotesOpen] = useState(false);
  const [noteInput, setNoteInput] = useState(item.resolution_note || '');
  const [saving, setSaving] = useState(false);

  async function saveNote() {
    setSaving(true);
    try {
      onResolutionNote(noteInput);
    } finally {
      setSaving(false);
    }
  }

  const created = new Date(item.created_at);

  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <div className="px-4 py-3 flex items-start gap-3">
        <div className={`w-8 h-8 rounded-md inline-flex items-center justify-center shrink-0 border ${meta.colour}`}>
          <Icon size={14} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide border ${meta.colour}`}>
              {meta.label}
            </span>
            <span className={`text-[11px] ${SEVERITY_COLOUR[item.severity]}`}>
              {item.severity}
            </span>
            <span className="text-[10.5px] text-ink-faint">
              {created.toLocaleString('en-GB', {
                day: '2-digit', month: 'short',
                hour: '2-digit', minute: '2-digit',
              })}
            </span>
            {item.user_id && (
              <span className="text-[10.5px] text-ink-muted font-mono">@{item.user_id}</span>
            )}
            {item.entity_name && (
              <span className="text-[10.5px] text-brand-700 bg-brand-50 px-1.5 py-0.5 rounded">
                {item.entity_name}
              </span>
            )}
          </div>
          <p className="text-[13px] text-ink mt-1.5 leading-relaxed whitespace-pre-wrap">{item.message}</p>
          <div className="mt-2 flex items-center gap-2 flex-wrap text-[11px]">
            <a href={item.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-ink-muted hover:text-brand-600">
              <ExternalLinkIcon size={11} /> open URL
            </a>
            {item.contact && (
              <span className="text-ink-muted">reply-to: <span className="font-mono">{item.contact}</span></span>
            )}
          </div>

          {item.resolution_note && !notesOpen && (
            <div className="mt-2 text-[11.5px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-3 py-2">
              <span className="font-semibold">Resolution:</span> {item.resolution_note}
            </div>
          )}

          {notesOpen && (
            <div className="mt-2">
              <textarea
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
                rows={2}
                placeholder="Resolution note (visible on triage list only)"
                className="w-full border border-border-strong rounded px-2 py-1.5 text-[12px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 resize-none"
              />
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => { saveNote(); setNotesOpen(false); }}
                  disabled={saving}
                  className="h-7 px-3 rounded bg-brand-500 text-white text-[11px] font-semibold hover:bg-brand-600 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save note'}
                </button>
                <button
                  onClick={() => setNotesOpen(false)}
                  className="h-7 px-3 rounded border border-border-strong text-[11px] font-medium text-ink-soft hover:bg-surface-alt"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <select
            value={item.status}
            onChange={(e) => onStatusChange(e.target.value as Feedback['status'])}
            className="h-7 px-2 rounded border border-border-strong text-[11px] bg-surface cursor-pointer focus:border-brand-500 focus:outline-none"
          >
            <option value="new">New</option>
            <option value="triaged">Triaged</option>
            <option value="resolved">Resolved</option>
            <option value="wontfix">Won&apos;t fix</option>
          </select>
          {!notesOpen && !item.resolution_note && (
            <button
              onClick={() => setNotesOpen(true)}
              className="text-[10.5px] text-brand-600 hover:text-brand-800 hover:underline"
            >
              add note
            </button>
          )}
          {item.resolution_note && !notesOpen && (
            <button
              onClick={() => setNotesOpen(true)}
              className="text-[10.5px] text-ink-muted hover:text-ink hover:underline"
            >
              edit note
            </button>
          )}
          <button
            onClick={onDelete}
            className="text-[10.5px] text-ink-muted hover:text-danger-600"
            title="Hard delete"
          >
            <TrashIcon size={11} />
          </button>
        </div>
      </div>
    </div>
  );
}
