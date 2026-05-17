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
  ChevronRightIcon, ChevronDownIcon, ArrowUpIcon, MessageSquareIcon,
  XIcon,
} from 'lucide-react';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { PageContainer } from '@/components/ui/PageContainer';
import { CrmErrorBox } from '@/components/crm/CrmErrorBox';
import { DateBadge } from '@/components/crm/DateBadge';
import { useToast } from '@/components/Toaster';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { TaskTimeline } from '@/components/tax-ops/TaskTimeline';
import { TaskAttachmentsPanel } from '@/components/tax-ops/TaskAttachmentsPanel';
import {
  CounterpartyChipPicker, CounterpartyChip,
} from '@/components/tax-ops/CounterpartyChipPicker';
import {
  TaskDeliverablesPanel, DeliverablesRollupChip, type Deliverable,
} from '@/components/tax-ops/TaskDeliverablesPanel';

interface Task {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  due_date: string | null;
  assignee: string | null;
  tags: string[];
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
  // Stint 84.C — deliverables JSONB list.
  deliverables: Deliverable[];
}

interface Subtask {
  id: string;
  title: string;
  status: string;
  priority: string;
  due_date: string | null;
  follow_up_date: string | null;
  assignee: string | null;
  // Stint 55.A — only populated for the direct subtasks list.
  subtask_total?: number;
  // Stint 84 — engagement view inline activity preview.
  comment_count?: number;
  last_comment_body?: string | null;
  last_comment_at?: string | null;
  last_comment_by?: string | null;
  // Stint 84 — counterparties responsible for / informed on this sub-task.
  counterparties?: TaskCounterparty[];
  // Stint 84.C — deliverables list (roll-up chip on collapsed row +
  // full panel inside the expanded SubtaskNode).
  deliverables?: Deliverable[];
}

interface TaskCounterparty {
  counterparty_id: string;
  display_name: string;
  side: string;
  role: string | null;
  jurisdiction: string | null;
  role_in_task: string | null;
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
  blocker: Subtask | null;        // legacy single blocker (back-compat)
  blockers?: Subtask[];           // Stint 84.F — multi-blocker list
  blocked_by_us: Subtask[];
  related_entity_name: string | null;
  related_filing_label: string | null;
  // Stint 84 — engagement-level stakeholders (counterparties on the
  // parent task itself).
  counterparties?: TaskCounterparty[];
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
  // Stint 84.C — engagement detection drives copy and behaviour at
  // multiple points (Workstreams section header, Engagement notes label,
  // consolidated timeline). Compute once.
  const isEngagementPage = data.subtasks.length > 0;

  return (
    <PageContainer width="medium">
      <div className="space-y-4">
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
          {/* Stint 84.G — engagement-aware assignee. For an engagement,
              "owner" is the counterparty marked responsible (Stakeholders
              section below). The free-text assignee field is hidden to
              stop the duplication, but the underlying column is preserved
              for the existing matrices that still surface it. */}
          {!isEngagementPage && (
            <label className="inline-flex items-center gap-1">
              <span className="text-ink-muted">Assignee:</span>
              <input
                defaultValue={t.assignee ?? ''}
                onBlur={e => patch({ assignee: e.target.value.trim() || null })}
                placeholder="short name"
                className="w-[120px] px-2 py-1 border border-border rounded-md bg-surface"
              />
            </label>
          )}
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

        {/* Stint 84 — Stakeholders / counterparties on this engagement.
            For atomic tasks (no sub-tasks) this is also useful: the task
            has a counterparty responsible for delivering it. */}
        <div className="mt-3 pt-2.5 border-t border-divider flex items-center gap-1.5 flex-wrap">
          <span className="text-2xs uppercase tracking-wide font-semibold text-ink-muted">
            Stakeholders
          </span>
          {(data.counterparties ?? []).map(cp => (
            <CounterpartyChip
              key={cp.counterparty_id}
              counterparty={cp}
              onRemove={async () => {
                await fetch(`/api/tax-ops/tasks/${id}/counterparties/${cp.counterparty_id}`, {
                  method: 'DELETE',
                });
                load();
              }}
            />
          ))}
          <CounterpartyChipPicker
            triggerLabel={(data.counterparties ?? []).length === 0 ? '+ Add stakeholder' : '+ Add'}
            excludeIds={(data.counterparties ?? []).map(c => c.counterparty_id)}
            onPick={async (cpid, role) => {
              await fetch(`/api/tax-ops/tasks/${id}/counterparties`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ counterparty_id: cpid, role_in_task: role }),
              });
              load();
            }}
          />
        </div>
      </div>

      {/* Stint 96 — TaskSignoffCard removed. 3-person sign-off
          cascade (preparer → reviewer → partner) was built for a
          firm with role separation; for Diego solo it was ceremony.
          The DB columns are kept (API still exposes them) so a
          simpler "sign-off done" flag can be reintroduced later
          without a migration. */}

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

          {/* Stint 84.C — Deliverables: structured list of the docs this
              task needs to produce. Manual status only (cifra is not the
              doc store; iManage etc. are linked via link_url). */}
          <TaskDeliverablesPanel
            taskId={id}
            deliverables={t.deliverables ?? []}
            onSaved={load}
          />

          {/* Subtasks — Stint 55.A recursive tree, stint 84 engagement-aware:
              when sub-tasks exist this is an "engagement" (a transaction
              with workstreams). The card grows a progress bar + last-activity
              chip and the section is labelled "Workstreams". When empty
              the card stays minimal so atomic tasks aren't bloated. */}
          {(() => {
            const isEngagement = data.subtasks.length > 0;
            const doneCount = data.subtasks.filter(s => s.status === 'done').length;
            const total = data.subtasks.length;
            const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;
            // Most-recent activity across any sub-task (stint 84).
            const lastActivity = data.subtasks
              .filter(s => s.last_comment_at)
              .sort((a, b) => (b.last_comment_at ?? '').localeCompare(a.last_comment_at ?? ''))[0];
            return (
              <div className="rounded-md border border-border bg-surface px-4 py-3">
                <div className="flex items-baseline justify-between gap-3 mb-2">
                  <h3 className="text-sm font-semibold text-ink">
                    {isEngagement ? 'Workstreams' : 'Subtasks'}
                    {total > 0 && (
                      <span className="ml-2 text-xs font-normal text-ink-muted">
                        ({doneCount}/{total} {doneCount === total ? 'all done' : 'done'})
                      </span>
                    )}
                  </h3>
                  {isEngagement && lastActivity && (
                    <span
                      className="text-2xs text-ink-muted truncate max-w-[280px]"
                      title={`Latest: "${lastActivity.title}" — ${lastActivity.last_comment_body}`}
                    >
                      Last update: <span className="text-ink-soft">{lastActivity.title}</span> · {relativeTime(lastActivity.last_comment_at)}
                    </span>
                  )}
                </div>
                {isEngagement && (
                  <div className="mb-3 h-1.5 rounded-full bg-surface-alt overflow-hidden">
                    <div
                      className="h-full bg-brand-500 transition-all"
                      style={{ width: `${pct}%` }}
                      aria-label={`${pct}% complete`}
                    />
                  </div>
                )}
                {total === 0 && (
                  <div className="text-sm text-ink-muted italic mb-2">
                    No sub-tasks yet. Break a big task into checklist items, or use this as the engagement that groups workstreams.
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
                  onCommentsChanged={load}
                />
              ))}
            </div>
                <div className="flex items-center gap-2 mt-2">
                  <input
                    value={subtaskDraft}
                    onChange={e => setSubtaskDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') createSubtask(); }}
                    placeholder={isEngagement ? '+ Add workstream' : '+ Add subtask'}
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
            );
          })()}

          {/* Comments / Engagement notes — Stint 84.C: when this task
              has sub-tasks (i.e. it's an engagement), the parent's
              comments are deal-wide notes, not feedback on a single
              atomic task. The label reflects that. */}
          <div className="rounded-md border border-border bg-surface px-4 py-3">
            <h3 className="text-sm font-semibold text-ink mb-2">
              {isEngagementPage ? 'Engagement notes' : 'Comments'}{' '}
              <span className="text-xs font-normal text-ink-muted">({comments.length})</span>
            </h3>
            {isEngagementPage && comments.length === 0 && (
              <p className="text-2xs text-ink-faint italic mb-2">
                Notes that apply to the whole engagement (vs the per-workstream comments
                threaded inside each sub-task).
              </p>
            )}
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

          {/* Activity — Stint 56.B; engagement-aware in 84.C: when the
              task has sub-tasks the timeline pulls audit + comments
              from the parent + every direct workstream into a single
              chronological feed (with per-row sub-task badges). */}
          <div className="rounded-md border border-border bg-surface px-4 py-3">
            <h3 className="text-sm font-semibold text-ink mb-2">
              {isEngagementPage ? 'Engagement timeline' : 'Activity'}
            </h3>
            <TaskTimeline taskId={id} includeChildren={isEngagementPage} />
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
            blockers={data.blockers ?? (data.blocker ? [data.blocker] : [])}
            blockedByUs={data.blocked_by_us}
            onChanged={load}
          />

          {/* Stint 97 — recurrence_rule UI removed. The editor promised
              that completing a task would spawn the next instance, but
              the recurrence-expand scheduled job never existed in this
              codebase (the cron infrastructure was deleted in the
              2026-05-05 reset). mig 094 drops the column. */}

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
    </PageContainer>
  );
}

// ─── Subtask tree node — stint 55.A → enriched in stint 84 ────────────
//
// Original (55.A): renders a single subtask row + recursive children
// expansion. Children list lazy-loads on first chevron click.
//
// Stint 84 — engagement-aware: the chevron now ALWAYS shows because
// expanding reveals an inline activity panel (status badge, comments
// thread, add-comment textarea) ON TOP OF children. Diego's pain was
// that to read "what did the Swiss counsel reply?" he had to navigate
// into the sub-task and lose the engagement context. Now the comments
// live next to the row.

const SUBTASK_STATUS_LABEL: Record<string, string> = {
  queued:                'Queued',
  in_progress:           'In progress',
  waiting_on_external:   'Waiting (external)',
  waiting_on_internal:   'Waiting (internal)',
  done:                  'Done',
  cancelled:             'Cancelled',
};

const SUBTASK_STATUS_TONE: Record<string, string> = {
  queued:                'bg-surface-alt text-ink-soft border-border',
  in_progress:           'bg-info-50 text-info-800 border-info-200',
  waiting_on_external:   'bg-amber-50 text-amber-800 border-amber-200',
  waiting_on_internal:   'bg-warning-50 text-warning-800 border-warning-200',
  done:                  'bg-success-50 text-success-800 border-success-200',
  cancelled:             'bg-surface-alt text-ink-faint border-border',
};

interface SubtaskNodeProps {
  task: Subtask;
  depth: number;
  onToggleDone: (sub: Subtask) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  onPromote: (id: string) => void | Promise<void>;
  /** Stint 58.T3.2 — per-node "+ Add sub" creator. Adds a child under
   *  this task with parent_task_id = task.id, then re-fetches. */
  onAddChild: (parentId: string, title: string) => Promise<void>;
  /** Stint 84 — re-fetches the parent detail so last_comment fields refresh
   *  after the user posts a comment from the inline panel. */
  onCommentsChanged?: () => void;
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return '';
  const m = Math.round(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function SubtaskNode({
  task, depth, onToggleDone, onDelete, onPromote, onAddChild, onCommentsChanged,
}: SubtaskNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<Subtask[] | null>(null);
  const [loadingChildren, setLoadingChildren] = useState(false);
  const [addingChild, setAddingChild] = useState(false);
  const [childDraft, setChildDraft] = useState('');
  const [refreshTick, setRefreshTick] = useState(0);
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentDraft, setCommentDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [statusDraft, setStatusDraft] = useState(task.status);

  // Stint 84.C — keep the local statusDraft in sync with prop changes.
  // Without this, after the parent re-fetches and `task.status` changes,
  // the chip selection drifted (showed the stale local pick).
  useEffect(() => { setStatusDraft(task.status); }, [task.status]);

  const hasChildren = (task.subtask_total ?? 0) > 0 || (children !== null && children.length > 0);
  const hasComments = (task.comment_count ?? 0) > 0;

  async function loadChildren() {
    setLoadingChildren(true);
    try {
      const r = await fetch(`/api/tax-ops/tasks?parent=${encodeURIComponent(task.id)}`);
      if (r.ok) {
        const body = await r.json() as { tasks: Subtask[] };
        setChildren(body.tasks ?? []);
      }
    } finally {
      setLoadingChildren(false);
    }
  }

  async function loadComments() {
    setLoadingComments(true);
    try {
      const r = await fetch(`/api/tax-ops/tasks/${task.id}/comments`);
      if (r.ok) {
        const body = await r.json() as { comments: Comment[] };
        setComments(body.comments ?? []);
      }
    } finally {
      setLoadingComments(false);
    }
  }

  async function toggle() {
    const willExpand = !expanded;
    if (willExpand) {
      // Lazy-load children + comments on first expand.
      const tasks: Promise<unknown>[] = [];
      if (hasChildren && children === null) tasks.push(loadChildren());
      if (comments === null) tasks.push(loadComments());
      await Promise.all(tasks);
    }
    setExpanded(willExpand);
  }

  async function changeStatus(next: string) {
    setStatusDraft(next);
    await fetch(`/api/tax-ops/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    });
    onCommentsChanged?.();
  }

  async function postComment() {
    const t = commentDraft.trim();
    if (!t || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/tax-ops/tasks/${task.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: t }),
      });
      if (res.ok) {
        setCommentDraft('');
        await loadComments();
        onCommentsChanged?.();
      }
    } finally {
      setSending(false);
    }
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
        {/* Stint 84: chevron always visible — expanding shows inline
            activity (comments + status edit) in addition to children. */}
        <button
          type="button"
          onClick={() => void toggle()}
          aria-label={expanded ? 'Collapse' : 'Expand'}
          className="shrink-0 text-ink-muted hover:text-ink"
          title={
            hasChildren
              ? `${task.subtask_total ?? children?.length ?? 0} sub-task(s)`
              : hasComments ? `${task.comment_count} comment(s)` : 'Open inline activity'
          }
        >
          {expanded ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
        </button>
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
        {/* Stint 84: status pill on the row so engagement reviewers
            can scan workstream states without expanding. */}
        <span
          className={`text-2xs px-1.5 py-0.5 rounded border font-medium uppercase tracking-wide whitespace-nowrap ${SUBTASK_STATUS_TONE[task.status] ?? SUBTASK_STATUS_TONE.queued}`}
        >
          {SUBTASK_STATUS_LABEL[task.status] ?? task.status}
        </span>
        {hasComments && (
          <span
            className="inline-flex items-center gap-0.5 text-2xs text-ink-muted"
            title={
              task.last_comment_at
                ? `Last update ${relativeTime(task.last_comment_at)} by ${task.last_comment_by ?? 'system'}`
                : `${task.comment_count} comment(s)`
            }
          >
            <MessageSquareIcon size={10} />
            {task.comment_count}
          </span>
        )}
        {/* Stint 84 — counterparty chips on the row. Only show the first
            so the row stays scannable; details and full management live
            in the expanded panel. Stint 84.G: when a responsible
            counterparty exists, it IS the row's owner indicator —
            assignee chip below is suppressed to avoid duplicating. */}
        {task.counterparties && task.counterparties.length > 0 && (
          <span className="flex items-center gap-1">
            <CounterpartyChip counterparty={task.counterparties[0]} size="xs" />
            {task.counterparties.length > 1 && (
              <span className="text-2xs text-ink-muted" title={
                task.counterparties.slice(1).map(c => c.display_name).join(', ')
              }>
                +{task.counterparties.length - 1}
              </span>
            )}
          </span>
        )}
        {/* Stint 84.C — deliverables roll-up chip ("📄 2/4"). */}
        {task.deliverables && task.deliverables.length > 0 && (
          <DeliverablesRollupChip items={task.deliverables} />
        )}
        {/* Follow-up reminder + due date — both render with urgency
            colours (red if past, amber if ≤7d) so Diego sees alerts at
            a glance without expanding. mode goes neutral once the
            sub-task is done/cancelled to stop "stale red" pollution. */}
        {task.follow_up_date && (
          <span
            className="text-xs"
            title={`Follow-up: ${task.follow_up_date}`}
          >
            <DateBadge
              value={task.follow_up_date}
              mode={task.status === 'done' || task.status === 'cancelled' ? 'neutral' : 'urgency'}
              label="Follow-up"
            />
          </span>
        )}
        {task.due_date && (
          <span className="text-xs">
            <DateBadge
              value={task.due_date}
              mode={task.status === 'done' || task.status === 'cancelled' ? 'neutral' : 'urgency'}
              label="Due"
            />
          </span>
        )}
        {/* Assignee shown ONLY when no counterparty is set — old matrices
            still rely on this field, but inside the engagement view the
            counterparty chip above replaces it. */}
        {task.assignee && (!task.counterparties || task.counterparties.length === 0) && (
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
      {/* Stint 84: collapsed-row last-comment preview. Two-line max,
          hidden once the panel is expanded so we don't duplicate. */}
      {!expanded && task.last_comment_body && (
        <div
          className="text-xs text-ink-muted italic line-clamp-1 pb-1.5"
          style={{ paddingLeft: `${(depth > 0 ? 0.75 : 0) + 1.25}rem` }}
          title={task.last_comment_body}
        >
          <span className="not-italic text-ink-faint mr-1">
            {task.last_comment_by ?? 'system'} · {relativeTime(task.last_comment_at)}:
          </span>
          {task.last_comment_body}
        </div>
      )}
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
        <div
          key={refreshTick}
          className="bg-surface-alt/30 rounded-md mb-1.5 px-3 py-2 space-y-3"
          style={{ marginLeft: `${(depth > 0 ? 0.75 : 0) + 1}rem` }}
        >
          {/* Stint 84: inline status quick-edit so a workstream's state
              can be advanced from the engagement view without navigating. */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-2xs uppercase tracking-wide font-semibold text-ink-muted mr-1">Status</span>
            {(['queued','in_progress','waiting_on_external','waiting_on_internal','done'] as const).map(s => (
              <button
                key={s}
                type="button"
                onClick={() => void changeStatus(s)}
                className={`text-2xs px-1.5 py-0.5 rounded border font-medium uppercase tracking-wide ${
                  statusDraft === s
                    ? SUBTASK_STATUS_TONE[s]
                    : 'bg-surface text-ink-muted border-border hover:bg-surface-alt'
                }`}
              >
                {SUBTASK_STATUS_LABEL[s]}
              </button>
            ))}
          </div>

          {/* Stint 84: counterparties for this workstream. Picker + chips. */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-2xs uppercase tracking-wide font-semibold text-ink-muted mr-1">Stakeholders</span>
            {(task.counterparties ?? []).map(cp => (
              <CounterpartyChip
                key={cp.counterparty_id}
                counterparty={cp}
                size="xs"
                onRemove={async () => {
                  await fetch(`/api/tax-ops/tasks/${task.id}/counterparties/${cp.counterparty_id}`, {
                    method: 'DELETE',
                  });
                  onCommentsChanged?.();
                }}
              />
            ))}
            <CounterpartyChipPicker
              triggerLabel="+ Add"
              excludeIds={(task.counterparties ?? []).map(c => c.counterparty_id)}
              onPick={async (cpid, role) => {
                await fetch(`/api/tax-ops/tasks/${task.id}/counterparties`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ counterparty_id: cpid, role_in_task: role }),
                });
                onCommentsChanged?.();
              }}
            />
          </div>

          {/* Stint 84.C — deliverables for this workstream (dense layout). */}
          <TaskDeliverablesPanel
            taskId={task.id}
            deliverables={task.deliverables ?? []}
            onSaved={() => onCommentsChanged?.()}
            dense
          />

          {/* Comments thread */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-2xs uppercase tracking-wide font-semibold text-ink-muted">
                Activity {comments && comments.length > 0 && `(${comments.length})`}
              </span>
            </div>
            {loadingComments && (
              <div className="text-2xs text-ink-faint italic">Loading comments…</div>
            )}
            {!loadingComments && comments && comments.length === 0 && (
              <div className="text-2xs text-ink-faint italic">No activity yet — drop the first update below.</div>
            )}
            {!loadingComments && comments && comments.length > 0 && (
              <div className="space-y-1.5 max-h-[260px] overflow-y-auto">
                {comments.map(c => (
                  <div key={c.id} className="rounded bg-surface px-2.5 py-1.5 border border-border">
                    <div className="text-2xs text-ink-muted mb-0.5">
                      {c.created_by ?? 'system'} · {new Date(c.created_at).toLocaleString()}
                    </div>
                    <div className="text-sm whitespace-pre-wrap text-ink">{c.body}</div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-start gap-1.5">
              <textarea
                value={commentDraft}
                onChange={e => setCommentDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void postComment();
                  }
                }}
                rows={2}
                placeholder="Update — what happened? ⌘+Enter to send."
                className="flex-1 px-2 py-1 text-sm border border-border rounded bg-surface"
              />
              <button
                type="button"
                onClick={() => void postComment()}
                disabled={!commentDraft.trim() || sending}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-50"
              >
                <SendIcon size={10} />
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>

          {/* Children sub-tasks (recursive) */}
          {hasChildren && (
            <div>
              <span className="text-2xs uppercase tracking-wide font-semibold text-ink-muted">
                Sub-tasks ({task.subtask_total ?? children?.length ?? 0})
              </span>
              <div className="mt-1">
                {loadingChildren && (
                  <div className="text-2xs text-ink-faint italic py-1">Loading…</div>
                )}
                {!loadingChildren && children?.map(child => (
                  <SubtaskNode
                    key={child.id}
                    task={child}
                    depth={depth + 1}
                    onToggleDone={onToggleDone}
                    onDelete={onDelete}
                    onPromote={onPromote}
                    onAddChild={onAddChild}
                    onCommentsChanged={onCommentsChanged}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


// ─── Dependencies panel — stint 55.B → 84.F multi-blocker ───────────────
//
// Renders the list of blockers (every task this one is waiting on) plus
// the list of tasks blocked by this one. Each blocker is its own chip
// with an unlink button. "+ Add blocker" lazy-loads the candidates
// dropdown.

interface DependenciesPanelProps {
  taskId: string;
  blockers: Subtask[];
  blockedByUs: Subtask[];
  onChanged: () => void;
}

function DependenciesPanel({ taskId, blockers, blockedByUs, onChanged }: DependenciesPanelProps) {
  const [editing, setEditing] = useState(false);
  const [candidates, setCandidates] = useState<Subtask[] | null>(null);
  const [picked, setPicked] = useState<string>('');

  async function loadCandidates() {
    const r = await fetch('/api/tax-ops/tasks?status=queued&status=in_progress&status=waiting_on_external&status=waiting_on_internal');
    if (!r.ok) return;
    const body = await r.json() as { tasks: Subtask[] };
    // Exclude this task + already-linked blockers.
    const linked = new Set([taskId, ...blockers.map(b => b.id)]);
    setCandidates((body.tasks ?? []).filter(t => !linked.has(t.id)));
  }

  async function addBlocker(blockerId: string) {
    await fetch(`/api/tax-ops/tasks/${taskId}/blockers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocker_id: blockerId }),
    });
    setEditing(false);
    setPicked('');
    setCandidates(null);  // force refetch next open so the just-added one disappears from the list
    onChanged();
  }

  async function unlinkBlocker(blockerId: string) {
    await fetch(`/api/tax-ops/tasks/${taskId}/blockers/${blockerId}`, {
      method: 'DELETE',
    });
    onChanged();
  }

  return (
    <div className="rounded-md border border-border bg-surface px-4 py-3 text-sm">
      <h3 className="text-sm font-semibold text-ink mb-2">Dependencies</h3>
      <div className="mb-2">
        <div className="text-ink-muted mb-1">
          Blocked by {blockers.length > 0 && <span className="text-ink-faint">({blockers.length})</span>}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {blockers.map(b => (
            <span key={b.id} className="inline-flex items-center gap-1">
              <Link
                href={`/tax-ops/tasks/${b.id}`}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs ${
                  b.status === 'done'
                    ? 'bg-success-50 text-success-800 hover:bg-success-100'
                    : 'bg-amber-100 text-amber-800 hover:bg-amber-200'
                }`}
              >
                {b.title}
                {b.status === 'done' && <CheckIcon size={10} />}
              </Link>
              <button
                type="button"
                onClick={() => void unlinkBlocker(b.id)}
                className="p-0.5 text-ink-muted hover:text-danger-700"
                title="Remove this blocker"
                aria-label="Remove blocker"
              >
                <XIcon size={10} />
              </button>
            </span>
          ))}
          {editing ? (
            <span className="inline-flex items-center gap-1">
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
                onClick={() => picked && void addBlocker(picked)}
                disabled={!picked}
                className="px-2 py-0.5 text-xs rounded bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-50"
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => { setEditing(false); setPicked(''); }}
                className="px-2 py-0.5 text-xs rounded border border-border hover:bg-surface-alt"
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => { setEditing(true); if (candidates === null) void loadCandidates(); }}
              className="text-xs text-ink-muted hover:text-brand-700 px-1"
            >
              + Add blocker
            </button>
          )}
        </div>
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
