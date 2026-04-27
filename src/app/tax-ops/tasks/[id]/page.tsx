'use client';

// /tax-ops/tasks/[id] — rich task detail.
//
// Sections:
//   Header      title (inline edit) · status dropdown · priority · due · assignee
//   Description markdown-lite textarea (saved on blur)
//   Subtasks    children panel — inline add, toggle status
//   Dependency  "blocked by <title>" chip + "blocking: N other tasks"
//   Recurrence  toggle + editor (describes next occurrence)
//   Related     related_filing · related_entity chips
//   Comments    linear thread — add comment textarea
//   Meta        created_at, tags, auto_generated flag

import { useEffect, useState, useCallback, use } from 'react';
import Link from 'next/link';
import {
  ArrowLeftIcon, PlusIcon, Trash2Icon, CheckIcon, SendIcon,
  ChevronRightIcon, ChevronDownIcon, ArrowUpIcon,
} from 'lucide-react';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { CrmErrorBox } from '@/components/crm/CrmErrorBox';
import { DateBadge } from '@/components/crm/DateBadge';
import { useToast } from '@/components/Toaster';
import {
  RecurrenceEditor, describeRecurrence, type RecurrenceRule,
} from '@/components/tax-ops/RecurrenceEditor';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { TaskSignoffCard } from '@/components/tax-ops/TaskSignoffCard';
import { TaskTimeline } from '@/components/tax-ops/TaskTimeline';
import { TaskAttachmentsPanel } from '@/components/tax-ops/TaskAttachmentsPanel';

interface Task {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  due_date: string | null;
  assignee: string | null;
  tags: string[];
  recurrence_rule: RecurrenceRule | null;
  related_filing_id: string | null;
  related_entity_id: string | null;
  auto_generated: boolean;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  // Stint 53 — Hito 1 surfaces these fields in the detail editor.
  task_kind: string | null;
  waiting_on_kind: string | null;
  waiting_on_note: string | null;
  follow_up_date: string | null;
  entity_id: string | null;
  // Stint 56.A — sign-off cascade.
  preparer: string | null;
  preparer_at: string | null;
  reviewer: string | null;
  reviewer_at: string | null;
  partner_sign_off: string | null;
  partner_sign_off_at: string | null;
}

interface Subtask {
  id: string;
  title: string;
  status: string;
  priority: string;
  due_date: string | null;
  assignee: string | null;
  // Stint 55.A — only populated for the direct subtasks list.
  subtask_total?: number;
}

interface Comment {
  id: string;
  body: string;
  created_by: string | null;
  created_at: string;
}

interface DetailResponse {
  task: Task;
  subtasks: Subtask[];
  blocker: Subtask | null;
  blocked_by_us: Subtask[];
  related_entity_name: string | null;
  related_filing_label: string | null;
}

const STATUSES = [
  { value: 'queued',              label: 'Queued' },
  { value: 'in_progress',         label: 'In progress' },
  { value: 'waiting_on_external', label: 'Waiting (external)' },
  { value: 'waiting_on_internal', label: 'Waiting (internal)' },
  { value: 'done',                label: 'Done' },
  { value: 'cancelled',           label: 'Cancelled' },
];

const PRIORITIES = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high',   label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low',    label: 'Low' },
];

export default function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<DetailResponse | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [subtaskDraft, setSubtaskDraft] = useState('');
  const [commentDraft, setCommentDraft] = useState('');
  // Stint 58.T1.1 — guard against duplicate posts when the user
  // mashes Send (or ⌘+Enter) before the round-trip finishes.
  const [sendingComment, setSendingComment] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const [detailRes, commentsRes] = await Promise.all([
        fetch(`/api/tax-ops/tasks/${id}`),
        fetch(`/api/tax-ops/tasks/${id}/comments`),
      ]);
      if (!detailRes.ok) throw new Error(`HTTP ${detailRes.status}`);
      const detail = await detailRes.json() as DetailResponse;
      const commentsBody = await commentsRes.json() as { comments: Comment[] };
      setData(detail);
      setTitle(detail.task.title);
      setDescription(detail.task.description ?? '');
      setComments(commentsBody.comments ?? []);
      setError(null);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function patch(body: Record<string, unknown>, msg?: string) {
    try {
      const res = await fetch(`/api/tax-ops/tasks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (msg) toast.success(msg);
      await load();
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
    }
  }

  async function createSubtask() {
    const t = subtaskDraft.trim();
    if (!t) return;
    try {
      const res = await fetch('/api/tax-ops/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: t, parent_task_id: id, priority: 'medium' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSubtaskDraft('');
      load();
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
    }
  }

  async function toggleSubtaskDone(sub: Subtask) {
    const newStatus = sub.status === 'done' ? 'queued' : 'done';
    await fetch(`/api/tax-ops/tasks/${sub.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
    load();
  }

  async function deleteSubtask(subId: string) {
    if (!confirm('Delete this subtask?')) return;
    await fetch(`/api/tax-ops/tasks/${subId}`, { method: 'DELETE' });
    load();
  }

  async function addComment() {
    const t = commentDraft.trim();
    if (!t || sendingComment) return;
    setSendingComment(true);
    try {
      const res = await fetch(`/api/tax-ops/tasks/${id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: t }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setCommentDraft('');
      load();
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
    } finally {
      setSendingComment(false);
    }
  }

  if (error) return <CrmErrorBox message={error} onRetry={load} />;
  if (!data) return <PageSkeleton />;

  const t = data.task;
  const isDone = t.status === 'done';
  const visibleTags = t.tags.filter(tg => !tg.startsWith('recurring_from:'));

  return (
    <div className="space-y-4 max-w-5xl">
      <Link href="/tax-ops/tasks" className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
        <ArrowLeftIcon size={12} /> Back to tasks
      </Link>

      {/* Header */}
      <div className="rounded-md border border-border bg-surface px-4 py-3">
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          onBlur={() => {
            if (title.trim() && title !== t.title) patch({ title: title.trim() }, 'Title saved');
          }}
          className={`w-full text-base font-semibold bg-transparent border-0 p-0 focus:ring-0 focus:bg-surface-alt/60 px-1 rounded ${isDone ? 'line-through text-ink-muted' : 'text-ink'}`}
          disabled={isDone}
        />
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <select
            value={t.status}
            onChange={e => patch({ status: e.target.value }, 'Status updated')}
            className="px-2 py-1 border border-border rounded-md bg-surface"
          >
            {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select
            value={t.priority}
            onChange={e => patch({ priority: e.target.value }, 'Priority updated')}
            className="px-2 py-1 border border-border rounded-md bg-surface"
          >
            {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
          <label className="inline-flex items-center gap-1">
            <span className="text-ink-muted">Due:</span>
            <input
              type="date"
              value={t.due_date ?? ''}
              onChange={e => patch({ due_date: e.target.value || null })}
              className="px-2 py-1 border border-border rounded-md bg-surface"
            />
          </label>
          <label className="inline-flex items-center gap-1">
            <span className="text-ink-muted">Assignee:</span>
            <input
              defaultValue={t.assignee ?? ''}
              onBlur={e => patch({ assignee: e.target.value.trim() || null })}
              placeholder="short name"
              className="w-[120px] px-2 py-1 border border-border rounded-md bg-surface"
            />
          </label>
          {t.auto_generated && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-2xs bg-brand-100 text-brand-800">
              Auto-generated
            </span>
          )}
        </div>
        {/* Stint 53 — Hito 1: surface task_kind / waiting_on / follow_up
            so the detail page covers every column the list now exposes. */}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <label className="inline-flex items-center gap-1">
            <span className="text-ink-muted">Kind:</span>
            <select
              value={t.task_kind ?? 'action'}
              onChange={e => patch({ task_kind: e.target.value })}
              className="px-2 py-1 border border-border rounded-md bg-surface"
            >
              <option value="action">Action</option>
              <option value="follow_up">Follow-up</option>
              <option value="clarification">Clarification</option>
              <option value="approval_request">Approval request</option>
              <option value="review">Review</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="inline-flex items-center gap-1">
            <span className="text-ink-muted">Waiting on:</span>
            <select
              value={t.waiting_on_kind ?? ''}
              onChange={e => patch({ waiting_on_kind: e.target.value || null })}
              className="px-2 py-1 border border-border rounded-md bg-surface"
            >
              <option value="">— not waiting —</option>
              <option value="csp_contact">CSP contact</option>
              <option value="client">Client</option>
              <option value="internal_team">Internal team</option>
              <option value="aed">AED (tax authority)</option>
              <option value="other">Other</option>
            </select>
          </label>
          {t.waiting_on_kind && (
            <label className="inline-flex items-center gap-1 flex-1 min-w-[200px]">
              <span className="text-ink-muted shrink-0">Who:</span>
              <input
                defaultValue={t.waiting_on_note ?? ''}
                onBlur={e => patch({ waiting_on_note: e.target.value.trim() || null })}
                placeholder="e.g. Maria @ XYZ CSP"
                className="flex-1 px-2 py-1 border border-border rounded-md bg-surface"
              />
            </label>
          )}
          <label className="inline-flex items-center gap-1">
            <span className="text-ink-muted">Follow-up:</span>
            <input
              type="date"
              value={t.follow_up_date ?? ''}
              onChange={e => patch({ follow_up_date: e.target.value || null })}
              className="px-2 py-1 border border-border rounded-md bg-surface"
              title="Chase / re-check date — independent of due date"
            />
          </label>
        </div>
        {visibleTags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {visibleTags.map((tg, i) => (
              <span key={i} className="text-2xs px-1.5 py-0.5 rounded bg-surface-alt text-ink-muted">{tg}</span>
            ))}
          </div>
        )}
      </div>

      {/* Stint 56.A — sign-off cascade card right under the header so
          the formal approval path is impossible to miss. */}
      <TaskSignoffCard
        taskId={id}
        snapshot={{
          preparer: t.preparer,
          preparer_at: t.preparer_at,
          reviewer: t.reviewer,
          reviewer_at: t.reviewer_at,
          partner_sign_off: t.partner_sign_off,
          partner_sign_off_at: t.partner_sign_off_at,
        }}
        defaultSigner={t.assignee ?? 'Diego'}
        onChanged={load}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left column */}
        <div className="lg:col-span-2 space-y-4">
          {/* Description */}
          <div className="rounded-md border border-border bg-surface px-4 py-3">
            <h3 className="text-sm font-semibold text-ink mb-2">Description</h3>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              onBlur={() => {
                if (description !== (t.description ?? '')) {
                  patch({ description }, 'Description saved');
                }
              }}
              rows={6}
              placeholder="Markdown. Saved on blur."
              className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-surface font-mono"
            />
          </div>

          {/* Subtasks — Stint 55.A: recursive tree (3-4 levels realistic).
              Each node can be expanded to load its own children lazily; a
              "Promote" button moves a child up to root level. Drag-drop
              between siblings is out of scope here (kept for stint 56). */}
          <div className="rounded-md border border-border bg-surface px-4 py-3">
            <h3 className="text-sm font-semibold text-ink mb-2">
              Subtasks
              <span className="ml-2 text-xs font-normal text-ink-muted">
                ({data.subtasks.filter(s => s.status === 'done').length}/{data.subtasks.length})
              </span>
            </h3>
            {data.subtasks.length === 0 && (
              <div className="text-sm text-ink-muted italic mb-2">
                No subtasks yet. Break a big task into checklist items.
              </div>
            )}
            <div className="space-y-0">
              {data.subtasks.map(sub => (
                <SubtaskNode
                  key={sub.id}
                  task={sub}
                  depth={0}
                  onToggleDone={toggleSubtaskDone}
                  onDelete={deleteSubtask}
                  onPromote={async (subId) => {
                    await fetch(`/api/tax-ops/tasks/${subId}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ parent_task_id: null }),
                    });
                    toast.success('Promoted to root task');
                    load();
                  }}
                  onAddChild={async (parentId, title) => {
                    // Stint 58.T3.2 — quick-add sub-task under any node.
                    await fetch('/api/tax-ops/tasks', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ title, parent_task_id: parentId, priority: 'medium' }),
                    });
                    // Re-load task detail so subtask_total counts refresh.
                    load();
                  }}
                />
              ))}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <input
                value={subtaskDraft}
                onChange={e => setSubtaskDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') createSubtask(); }}
                placeholder="+ Add subtask"
                className="flex-1 px-2 py-1 text-sm border border-border rounded-md bg-surface"
              />
              <button
                onClick={createSubtask}
                disabled={!subtaskDraft.trim()}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-50"
              >
                <PlusIcon size={11} /> Add
              </button>
            </div>
          </div>

          {/* Comments */}
          <div className="rounded-md border border-border bg-surface px-4 py-3">
            <h3 className="text-sm font-semibold text-ink mb-2">
              Comments <span className="text-xs font-normal text-ink-muted">({comments.length})</span>
            </h3>
            <div className="space-y-2 mb-3">
              {comments.map(c => (
                <div key={c.id} className="rounded-md bg-surface-alt/40 px-3 py-2">
                  <div className="text-xs text-ink-muted mb-1">
                    {c.created_by ?? 'system'} · {new Date(c.created_at).toLocaleString()}
                  </div>
                  <div className="text-sm whitespace-pre-wrap">{c.body}</div>
                </div>
              ))}
              {comments.length === 0 && (
                <div className="text-sm text-ink-muted italic">No comments yet.</div>
              )}
            </div>
            <div className="flex items-start gap-2">
              <textarea
                value={commentDraft}
                onChange={e => setCommentDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addComment(); }}
                rows={2}
                placeholder="Add a comment. ⌘+Enter to send."
                className="flex-1 px-2 py-1.5 text-sm border border-border rounded-md bg-surface"
              />
              <button
                onClick={addComment}
                disabled={!commentDraft.trim() || sendingComment}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-sm rounded-md bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-50 self-start"
              >
                <SendIcon size={11} /> {sendingComment ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>

          {/* Attachments — Stint 56.C. Drag-drop + listing with signed
              download URLs. Max 25 MB / file. */}
          <TaskAttachmentsPanel taskId={id} />

          {/* Activity — Stint 56.B. Surfaces every audit_log row
              tagged tax_ops_task for this id (status changes,
              sign-offs, attachments, reassignments). */}
          <div className="rounded-md border border-border bg-surface px-4 py-3">
            <h3 className="text-sm font-semibold text-ink mb-2">Activity</h3>
            <TaskTimeline taskId={id} />
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* Dependencies — Stint 55.B: editor for depends_on_task_id +
              read-only blocker / blocking lists. The picker is loaded
              lazily when the user clicks "+ Set blocker" so we don't
              fetch the whole task list on every detail-page mount. */}
          <DependenciesPanel
            taskId={id}
            currentBlocker={data.blocker}
            blockedByUs={data.blocked_by_us}
            onChanged={load}
          />

          {/* Recurrence — Stint 58.T3.3: collapsed by default. Most
              tasks aren't recurring; surfacing the editor unconditionally
              wasted vertical space. Now a tiny <details> that expands
              if the user has set a rule (or wants to). */}
          <details className="rounded-md border border-border bg-surface px-4 py-2 group" open={!!t.recurrence_rule}>
            <summary className="cursor-pointer list-none flex items-center justify-between text-sm font-semibold text-ink">
              <span>Recurrence{t.recurrence_rule ? ' · active' : ''}</span>
              <span className="text-2xs text-ink-muted">
                {t.recurrence_rule ? describeRecurrence(t.recurrence_rule) : 'Make this task recurring'}
              </span>
            </summary>
            <div className="mt-2">
              <RecurrenceEditor
                value={t.recurrence_rule}
                onChange={rule => patch({ recurrence_rule: rule }, 'Recurrence saved')}
              />
              {t.recurrence_rule && (
                <p className="mt-2 text-xs text-ink-muted italic">
                  When marked done, a new instance will be created on the next occurrence.
                </p>
              )}
            </div>
          </details>

          {/* Related */}
          {(data.related_entity_name || data.related_filing_label) && (
            <div className="rounded-md border border-border bg-surface px-4 py-3 text-sm">
              <h3 className="text-sm font-semibold text-ink mb-2">Related</h3>
              {data.related_entity_name && t.related_entity_id && (
                <Link
                  href={`/tax-ops/entities/${t.related_entity_id}`}
                  className="block text-brand-700 hover:text-brand-800 mb-1"
                >
                  Entity: {data.related_entity_name}
                </Link>
              )}
              {data.related_filing_label && t.related_filing_id && (
                <Link
                  href={`/tax-ops/filings/${t.related_filing_id}`}
                  className="block text-brand-700 hover:text-brand-800"
                >
                  Filing: {data.related_filing_label}
                </Link>
              )}
            </div>
          )}

          {/* Meta */}
          <div className="text-xs text-ink-muted space-y-0.5">
            <div>Created: {new Date(t.created_at).toLocaleString()}</div>
            <div>Updated: {new Date(t.updated_at).toLocaleString()}</div>
            {t.completed_at && (
              <div>Completed: {new Date(t.completed_at).toLocaleString()}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Subtask tree node — stint 55.A ────────────────────────────────────
//
// Renders a single subtask row + its expansion children recursively. The
// children list is lazy-loaded the first time the user hits the chevron
// (cached locally afterwards). Indentation is `depth * 1rem` so 3-4
// levels of nesting still read cleanly. Diego asked for a "tree" so the
// tasks module starts feeling like a project-management surface; this
// is the cheapest possible shape that delivers the affordance without
// rebuilding the entire list as a virtualized tree component.

interface SubtaskNodeProps {
  task: Subtask;
  depth: number;
  onToggleDone: (sub: Subtask) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  onPromote: (id: string) => void | Promise<void>;
  /** Stint 58.T3.2 — per-node "+ Add sub" creator. Adds a child under
   *  this task with parent_task_id = task.id, then re-fetches. */
  onAddChild: (parentId: string, title: string) => Promise<void>;
}

function SubtaskNode({
  task, depth, onToggleDone, onDelete, onPromote, onAddChild,
}: SubtaskNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<Subtask[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [addingChild, setAddingChild] = useState(false);
  const [childDraft, setChildDraft] = useState('');
  const [refreshTick, setRefreshTick] = useState(0);
  const hasChildren = (task.subtask_total ?? 0) > 0 || (children !== null && children.length > 0);

  async function loadChildren() {
    setLoading(true);
    try {
      const r = await fetch(`/api/tax-ops/tasks?parent=${encodeURIComponent(task.id)}`);
      if (r.ok) {
        const body = await r.json() as { tasks: Subtask[] };
        setChildren(body.tasks ?? []);
      }
    } finally {
      setLoading(false);
    }
  }

  async function toggle() {
    if (!hasChildren) return;
    if (!expanded && children === null) {
      await loadChildren();
    }
    setExpanded(v => !v);
  }

  async function handleAddChild() {
    const t = childDraft.trim();
    if (!t) return;
    await onAddChild(task.id, t);
    setChildDraft('');
    setAddingChild(false);
    // Force re-fetch of children + auto-expand so the new node is visible.
    await loadChildren();
    setExpanded(true);
    setRefreshTick(x => x + 1);
  }

  return (
    <div
      className="group/node"
      // Stint 58.T3.4 — left rail for tree hierarchy. depth>0 nodes
      // get a subtle border-l on the wrapper so descendants visually
      // connect to their parent column.
      style={depth > 0 ? { borderLeft: '1px solid var(--color-border)', marginLeft: '0.5rem' } : undefined}
    >
      <div
        className="flex items-center gap-2 py-1 text-sm border-b border-border/40 last:border-b-0"
        style={{ paddingLeft: `${depth > 0 ? 0.75 : 0}rem` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => void toggle()}
            aria-label={expanded ? 'Collapse' : 'Expand'}
            className="shrink-0 text-ink-muted hover:text-ink"
            title={`${task.subtask_total ?? children?.length ?? 0} sub-task${(task.subtask_total ?? children?.length ?? 0) === 1 ? '' : 's'}`}
          >
            {expanded ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
          </button>
        ) : (
          <span className="shrink-0 w-3" aria-hidden="true" />
        )}
        <input
          type="checkbox"
          checked={task.status === 'done'}
          onChange={() => void onToggleDone(task)}
        />
        <Link
          href={`/tax-ops/tasks/${task.id}`}
          className={`flex-1 truncate ${task.status === 'done' ? 'line-through text-ink-muted' : 'text-ink hover:text-brand-700'}`}
        >
          {task.title}
        </Link>
        {task.due_date && (
          <span className="text-xs"><DateBadge value={task.due_date} mode="urgency" /></span>
        )}
        {task.assignee && (
          <span className="text-xs px-1 bg-surface-alt text-ink-soft rounded">{task.assignee}</span>
        )}
        {/* Stint 58.T3.2 — quick-add sub-task per node. Hover-only so
            it doesn't clutter the row at rest. */}
        <button
          type="button"
          onClick={() => setAddingChild(v => !v)}
          aria-label="Add sub-task under this node"
          title="Add sub-task here"
          className="opacity-0 group-hover/node:opacity-100 transition-opacity text-ink-muted hover:text-brand-700"
        >
          <PlusIcon size={11} />
        </button>
        {depth > 0 && (
          <button
            type="button"
            onClick={() => void onPromote(task.id)}
            aria-label="Promote to root task"
            title="Promote — make this a root-level task"
            className="opacity-0 group-hover/node:opacity-100 transition-opacity text-ink-muted hover:text-brand-700"
          >
            <ArrowUpIcon size={11} />
          </button>
        )}
        <button
          onClick={() => void onDelete(task.id)}
          aria-label="Delete subtask"
          className="opacity-0 group-hover/node:opacity-100 transition-opacity text-ink-muted hover:text-danger-600"
        >
          <Trash2Icon size={11} />
        </button>
      </div>
      {addingChild && (
        <div
          className="flex items-center gap-2 py-1"
          style={{ paddingLeft: `${depth > 0 ? 0.75 : 0}rem` }}
        >
          <span className="shrink-0 w-3" aria-hidden="true" />
          <input
            autoFocus
            value={childDraft}
            onChange={e => setChildDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); void handleAddChild(); }
              if (e.key === 'Escape') { e.preventDefault(); setChildDraft(''); setAddingChild(false); }
            }}
            placeholder="New sub-task title…"
            className="flex-1 px-2 py-1 text-sm border border-border rounded bg-surface"
          />
          <button
            type="button"
            onClick={() => void handleAddChild()}
            disabled={!childDraft.trim()}
            className="px-2 py-0.5 text-xs rounded bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-50"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => { setChildDraft(''); setAddingChild(false); }}
            className="px-2 py-0.5 text-xs rounded border border-border hover:bg-surface-alt"
          >
            Cancel
          </button>
        </div>
      )}
      {expanded && (
        <div key={refreshTick}>
          {loading && <div className="text-2xs text-ink-faint italic py-1" style={{ paddingLeft: `${(depth + 1) * 0.75}rem` }}>Loading…</div>}
          {!loading && children && children.length === 0 && (
            <div className="text-2xs text-ink-faint italic py-1" style={{ paddingLeft: `${(depth + 1) * 0.75}rem` }}>No deeper sub-tasks.</div>
          )}
          {!loading && children?.map(child => (
            <SubtaskNode
              key={child.id}
              task={child}
              depth={depth + 1}
              onToggleDone={onToggleDone}
              onDelete={onDelete}
              onPromote={onPromote}
              onAddChild={onAddChild}
            />
          ))}
        </div>
      )}
    </div>
  );
}


// ─── Dependencies panel — stint 55.B ──────────────────────────────────
//
// Renders the blocker (with edit + clear) and the list of tasks blocked
// by this one. The picker is lazy: the dropdown of candidates only
// fetches /api/tax-ops/tasks once it's opened.

interface DependenciesPanelProps {
  taskId: string;
  currentBlocker: Subtask | null;
  blockedByUs: Subtask[];
  onChanged: () => void;
}

function DependenciesPanel({ taskId, currentBlocker, blockedByUs, onChanged }: DependenciesPanelProps) {
  const [editing, setEditing] = useState(false);
  const [candidates, setCandidates] = useState<Subtask[] | null>(null);
  const [picked, setPicked] = useState<string>('');

  async function loadCandidates() {
    const r = await fetch('/api/tax-ops/tasks?status=queued&status=in_progress&status=waiting_on_external&status=waiting_on_internal');
    if (!r.ok) return;
    const body = await r.json() as { tasks: Subtask[] };
    // Exclude this task itself.
    setCandidates((body.tasks ?? []).filter(t => t.id !== taskId));
  }

  async function setBlocker(blockerId: string | null) {
    await fetch(`/api/tax-ops/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ depends_on_task_id: blockerId }),
    });
    setEditing(false);
    setPicked('');
    onChanged();
  }

  return (
    <div className="rounded-md border border-border bg-surface px-4 py-3 text-sm">
      <h3 className="text-sm font-semibold text-ink mb-2">Dependencies</h3>
      <div className="mb-2">
        <div className="text-ink-muted mb-0.5">Blocked by</div>
        {currentBlocker ? (
          <div className="flex items-center gap-1">
            <Link
              href={`/tax-ops/tasks/${currentBlocker.id}`}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs ${
                currentBlocker.status === 'done'
                  ? 'bg-success-50 text-success-800 hover:bg-success-100'
                  : 'bg-amber-100 text-amber-800 hover:bg-amber-200'
              }`}
            >
              {currentBlocker.title}
              {currentBlocker.status === 'done' && <CheckIcon size={10} />}
            </Link>
            <button
              type="button"
              onClick={() => void setBlocker(null)}
              className="text-2xs text-ink-muted hover:text-danger-700 px-1"
              title="Remove blocker"
            >
              clear
            </button>
          </div>
        ) : editing ? (
          <div className="flex items-center gap-1">
            <SearchableSelect
              options={(candidates ?? []).map(c => ({ value: c.id, label: c.title }))}
              value={picked}
              onChange={setPicked}
              placeholder={candidates === null ? 'Loading…' : 'Pick a task…'}
              ariaLabel="Pick blocker task"
              triggerClassName="min-w-[200px]"
            />
            <button
              type="button"
              onClick={() => picked && void setBlocker(picked)}
              disabled={!picked}
              className="px-2 py-0.5 text-xs rounded bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-50"
            >
              Set
            </button>
            <button
              type="button"
              onClick={() => { setEditing(false); setPicked(''); }}
              className="px-2 py-0.5 text-xs rounded border border-border hover:bg-surface-alt"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => { setEditing(true); if (candidates === null) void loadCandidates(); }}
            className="text-xs text-ink-muted hover:text-brand-700"
          >
            + Set blocker
          </button>
        )}
      </div>

      {blockedByUs.length > 0 && (
        <div>
          <div className="text-ink-muted mb-0.5">Blocking ({blockedByUs.length})</div>
          <div className="space-y-1">
            {blockedByUs.slice(0, 5).map(b => (
              <Link
                key={b.id}
                href={`/tax-ops/tasks/${b.id}`}
                className="block text-xs text-brand-700 hover:text-brand-800"
              >
                → {b.title}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
