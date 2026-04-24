'use client';

// QuickCaptureModal — press `N` anywhere under /tax-ops to open.
// Stint 37.G rich form: title + entity searchable + task_kind + due +
// priority + assignee, collapsed; "Show more" reveals description,
// waiting_on_kind + note, follow_up_date, related_filing_id.
// Enter (when title focused) submits. ESC closes.

import { useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/Toaster';

const TASK_KINDS = [
  { value: 'action',           label: 'Action' },
  { value: 'follow_up',        label: 'Follow-up' },
  { value: 'clarification',    label: 'Clarification' },
  { value: 'approval_request', label: 'Approval request' },
  { value: 'review',           label: 'Review' },
  { value: 'other',            label: 'Other' },
];

const WAITING_ON_OPTIONS = [
  { value: '',              label: 'Not waiting' },
  { value: 'csp_contact',   label: 'CSP contact' },
  { value: 'client',        label: 'Client' },
  { value: 'internal_team', label: 'Internal team' },
  { value: 'aed',           label: 'AED (tax authority)' },
  { value: 'other',         label: 'Other' },
];

interface EntityOption {
  id: string;
  legal_name: string;
  group_name: string | null;
}

export function QuickCaptureModal() {
  const [open, setOpen] = useState(false);
  const [showMore, setShowMore] = useState(false);

  // Core
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium');
  const [entityId, setEntityId] = useState('');
  const [entitySearch, setEntitySearch] = useState('');
  const [taskKind, setTaskKind] = useState('action');
  const [assignee, setAssignee] = useState('');

  // Expanded
  const [description, setDescription] = useState('');
  const [waitingOnKind, setWaitingOnKind] = useState('');
  const [waitingOnNote, setWaitingOnNote] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');

  // Data
  const [entities, setEntities] = useState<EntityOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname.startsWith('/tax-ops')) return;
    function handler(e: KeyboardEvent) {
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return;
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [pathname]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      fetch('/api/tax-ops/entities')
        .then(r => r.ok ? r.json() : { entities: [] })
        .then((body: { entities: EntityOption[] }) => setEntities(body.entities ?? []))
        .catch(() => setEntities([]));
    } else {
      // Reset everything on close
      setTitle(''); setDue(''); setPriority('medium');
      setEntityId(''); setEntitySearch(''); setTaskKind('action');
      setAssignee(''); setDescription(''); setWaitingOnKind('');
      setWaitingOnNote(''); setFollowUpDate('');
      setShowMore(false); setBusy(false); setError(null);
    }
  }, [open]);

  const filteredEntities = entities.filter(e => {
    const q = entitySearch.toLowerCase();
    return !q
      || e.legal_name.toLowerCase().includes(q)
      || (e.group_name ?? '').toLowerCase().includes(q);
  }).slice(0, 15);

  async function submit() {
    if (!title.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/tax-ops/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          due_date: due || null,
          priority,
          entity_id: entityId || null,
          task_kind: taskKind,
          assignee: assignee.trim() || null,
          waiting_on_kind: waitingOnKind || null,
          waiting_on_note: waitingOnNote.trim() || null,
          follow_up_date: followUpDate || null,
        }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b?.error ?? `HTTP ${res.status}`);
      }
      const body = await res.json() as { id: string };
      toast.success('Task created');
      setOpen(false);
      router.push(`/tax-ops/tasks/${body.id}`);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title="New task"
      subtitle="Press N from any /tax-ops page. Enter to create, Esc to cancel. Expand for more fields."
      size="md"
    >
      <div className="space-y-3 text-[12.5px]">
        <input
          ref={inputRef}
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !busy) submit(); }}
          placeholder="What needs to happen?"
          className="w-full px-2.5 py-2 border border-border rounded-md bg-surface text-[13px]"
        />

        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className="text-ink-muted">Task kind</span>
            <select
              value={taskKind}
              onChange={e => setTaskKind(e.target.value)}
              className="mt-1 w-full px-2 py-1.5 border border-border rounded-md bg-surface"
            >
              {TASK_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </label>
          <label>
            <span className="text-ink-muted">Priority</span>
            <select
              value={priority}
              onChange={e => setPriority(e.target.value as typeof priority)}
              className="mt-1 w-full px-2 py-1.5 border border-border rounded-md bg-surface"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </label>
        </div>

        <div>
          <span className="text-ink-muted">Entity (optional)</span>
          <input
            value={entitySearch}
            onChange={e => setEntitySearch(e.target.value)}
            placeholder="Search by name or family…"
            className="mt-1 w-full px-2 py-1.5 border border-border rounded-md bg-surface"
          />
          {filteredEntities.length > 0 && (
            <select
              size={Math.min(5, filteredEntities.length + 1)}
              value={entityId}
              onChange={e => setEntityId(e.target.value)}
              className="mt-1 w-full px-2 py-1 border border-border rounded-md bg-surface font-mono text-[11.5px]"
            >
              <option value="">— no entity —</option>
              {filteredEntities.map(e => (
                <option key={e.id} value={e.id}>
                  {e.legal_name}{e.group_name ? ` · ${e.group_name}` : ''}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className="text-ink-muted">Due date</span>
            <input
              type="date"
              value={due}
              onChange={e => setDue(e.target.value)}
              className="mt-1 w-full px-2 py-1.5 border border-border rounded-md bg-surface"
            />
          </label>
          <label>
            <span className="text-ink-muted">Assignee</span>
            <input
              value={assignee}
              onChange={e => setAssignee(e.target.value)}
              placeholder="Gab, Andrew…"
              className="mt-1 w-full px-2 py-1.5 border border-border rounded-md bg-surface"
            />
          </label>
        </div>

        <button
          type="button"
          onClick={() => setShowMore(v => !v)}
          className="text-[11.5px] text-brand-700 hover:text-brand-800"
        >
          {showMore ? '− Hide extra fields' : '+ Show more (description, waiting on, follow-up)'}
        </button>

        {showMore && (
          <div className="space-y-3 pt-1 border-t border-border">
            <label className="block">
              <span className="text-ink-muted">Description</span>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={2}
                placeholder="Context, links, steps…"
                className="mt-1 w-full px-2 py-1.5 border border-border rounded-md bg-surface"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label>
                <span className="text-ink-muted">Waiting on</span>
                <select
                  value={waitingOnKind}
                  onChange={e => setWaitingOnKind(e.target.value)}
                  className="mt-1 w-full px-2 py-1.5 border border-border rounded-md bg-surface"
                >
                  {WAITING_ON_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <label>
                <span className="text-ink-muted">Follow-up date</span>
                <input
                  type="date"
                  value={followUpDate}
                  onChange={e => setFollowUpDate(e.target.value)}
                  className="mt-1 w-full px-2 py-1.5 border border-border rounded-md bg-surface"
                />
              </label>
            </div>
            {waitingOnKind && (
              <label className="block">
                <span className="text-ink-muted">Waiting on — specific person/email</span>
                <input
                  value={waitingOnNote}
                  onChange={e => setWaitingOnNote(e.target.value)}
                  placeholder="e.g. Maria at XYZ CSP"
                  className="mt-1 w-full px-2 py-1.5 border border-border rounded-md bg-surface"
                />
              </label>
            )}
          </div>
        )}

        {error && (
          <div className="rounded-md border border-danger-400 bg-danger-50/50 p-2 text-[12px] text-danger-800">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={() => setOpen(false)}
            className="px-3 py-1.5 text-[12.5px] rounded-md border border-border hover:bg-surface-alt"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy || !title.trim()}
            className="px-3 py-1.5 text-[12.5px] rounded-md bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {busy ? 'Creating…' : 'Create task'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
