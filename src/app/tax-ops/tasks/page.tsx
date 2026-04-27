'use client';

// /tax-ops/tasks — rediseño 37.G para gestión de proyectos real.
// Columnas: Family | Entity | Title | Kind | Status | Waiting on |
//           Follow-up | Assignee | Due | Priority | Actions
// Filtros: Mine · Overdue · Waiting · This week + search.
// Inline edit en status, priority, assignee, due_date, follow_up_date.

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  SearchIcon, LayoutListIcon, LayoutGridIcon, PlusIcon, FilterXIcon,
  CalendarIcon, MessagesSquareIcon, ListIcon, Trash2Icon,
  ChevronRightIcon, ChevronDownIcon, LockIcon, UnlockIcon,
  StarIcon, XIcon,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { CrmErrorBox } from '@/components/crm/CrmErrorBox';
import { DateBadge } from '@/components/crm/DateBadge';
import { crmLoadShape } from '@/lib/useCrmFetch';
import { TaskBoard, type TaskRow } from '@/components/tax-ops/TaskBoard';
import { useToast } from '@/components/Toaster';
// Stint 53 — Hito 1 of the Tasks redesign: every cell is editable in
// place, family chips are coloured + clickeable to /families/[id], and
// the row order respects the next pending action.
import { InlineTextCell, InlineDateCell } from '@/components/tax-ops/inline-editors';
import { familyChipClasses } from '@/components/tax-ops/familyColors';

interface TaskFull extends TaskRow {
  description: string | null;
  parent_task_id: string | null;
  depends_on_task_id: string | null;
  tags: string[];
  related_filing_label: string | null;
  entity_id: string | null;
  entity_name: string | null;
  family_name: string | null;
  family_id: string | null;
  task_kind: string;
  waiting_on_kind: string | null;
  waiting_on_note: string | null;
  follow_up_date: string | null;
  // Stint 55.B — blocker info for the 🔒/🔓 badge.
  blocker_title: string | null;
  blocker_status: string | null;
  // Stint 56.A — sign-off snapshot for the N/3 chip.
  preparer: string | null;
  reviewer: string | null;
  partner_sign_off: string | null;
  // Stint 56.D — favourite.
  is_starred: boolean;
}

const STATUSES = [
  { value: 'queued',              label: 'Queued' },
  { value: 'in_progress',         label: 'In progress' },
  { value: 'waiting_on_external', label: 'Waiting (external)' },
  { value: 'waiting_on_internal', label: 'Waiting (internal)' },
  { value: 'done',                label: 'Done' },
  { value: 'cancelled',           label: 'Cancelled' },
];

const TASK_KIND_LABELS: Record<string, string> = {
  action:           'Action',
  follow_up:        'Follow-up',
  clarification:    'Clarification',
  approval_request: 'Approval request',
  review:           'Review',
  other:            'Other',
};

const WAITING_ON_LABELS: Record<string, string> = {
  csp_contact:   'CSP contact',
  client:        'Client',
  internal_team: 'Internal team',
  aed:           'AED',
  other:         'Other',
};

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'bg-danger-100 text-danger-800',
  high:   'bg-amber-100 text-amber-800',
  medium: 'bg-brand-100 text-brand-800',
  low:    'bg-surface-alt text-ink-soft',
};

// Stint 40.I — filter labels clarified per Diego's feedback ("no entiendo
// esto que pones aquí de mine overdue waiting on this week"). Each pill
// gets a title (tooltip) spelling out what it filters on.
const QUICK_FILTERS: Array<{
  key: string; label: string; tooltip: string;
  apply: (p: URLSearchParams) => void;
}> = [
  {
    key: 'mine',
    label: 'My tasks',
    tooltip: 'Tasks assigned to Diego (matches assignee = "Diego").',
    apply: (p) => p.set('assignee', 'Diego'),
  },
  {
    key: 'overdue',
    label: 'Overdue',
    tooltip: 'Open tasks whose due_date is in the past.',
    apply: (p) => {
      p.set('due_in_days', '0');
      p.set('status', 'queued');
      p.append('status', 'in_progress');
    },
  },
  {
    key: 'waiting',
    label: 'Blocked on others',
    tooltip: 'Tasks waiting for someone else — CSP, client, internal teammate, or AED.',
    apply: (p) => {
      p.set('status', 'waiting_on_external');
      p.append('status', 'waiting_on_internal');
    },
  },
  {
    key: 'ready',
    label: 'Ready to work',
    tooltip: 'Tasks not blocked by an unfinished dependency. Stint 55.B.',
    apply: (p) => p.set('ready', '1'),
  },
  {
    key: 'starred',
    label: 'Starred',
    tooltip: 'Tasks you marked with a star.',
    apply: (p) => p.set('starred', '1'),
  },
  {
    key: 'thisweek',
    label: 'Due this week',
    tooltip: 'Open tasks with due_date in the next 7 days.',
    apply: (p) => p.set('due_in_days', '7'),
  },
];

type ViewMode = 'list' | 'board';

interface FamilyOption { id: string; name: string }

export default function TasksListPage() {
  const [view, setView] = useState<ViewMode>('list');
  const [rows, setRows] = useState<TaskFull[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<string>('');
  const [assignee, setAssignee] = useState<string>('');
  const [preset, setPreset] = useState<string>('');
  // Stint 51.A — family filter (Diego: "que se pudiese organizar también
  //               igualmente por familias para ver bien todos los
  //               distintos proyectos que están pendientes").
  const [familyId, setFamilyId] = useState<string>('');
  const [families, setFamilies] = useState<FamilyOption[]>([]);
  // Stint 55.A — sub-tasks tree expansion state. Map of parent task id
  // → array of children, lazy-loaded the first time the user clicks a
  // chevron. Cached so re-expand is instant.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [childrenByParent, setChildrenByParent] = useState<Record<string, TaskFull[]>>({});
  // Stint 56.D — bulk select state for the multi-select toolbar.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toast = useToast();

  const load = useCallback(() => {
    const qs = new URLSearchParams();
    if (q) qs.set('q', q);
    if (status) qs.set('status', status);
    if (assignee) qs.set('assignee', assignee);
    if (familyId) qs.set('family_id', familyId);
    if (preset) {
      const p = QUICK_FILTERS.find(f => f.key === preset);
      p?.apply(qs);
    }
    qs.set('only_root', '1');
    crmLoadShape<TaskFull[]>(`/api/tax-ops/tasks?${qs}`, b => (b as { tasks: TaskFull[] }).tasks)
      .then(rows => { setRows(rows); setError(null); })
      .catch(e => { setError(String(e instanceof Error ? e.message : e)); setRows([]); });
  }, [q, status, assignee, familyId, preset]);

  // Load families once for the filter dropdown — reuse the same list
  // the matrices use (groups returned by /api/tax-ops/entities).
  useEffect(() => {
    fetch('/api/tax-ops/entities')
      .then(r => r.ok ? r.json() : { groups: [] })
      .then((body: { groups: FamilyOption[] }) => setFamilies(body.groups ?? []))
      .catch(() => setFamilies([]));
  }, []);

  useEffect(() => { load(); }, [load]);

  const hasFilters = useMemo(
    () => q !== '' || status !== '' || assignee !== '' || familyId !== '' || preset !== '',
    [q, status, assignee, familyId, preset],
  );

  function clearFilters() {
    setQ(''); setStatus(''); setAssignee(''); setFamilyId(''); setPreset('');
  }

  // Stint 55.A — fetch + cache children of a parent task on demand.
  // Re-fetches on toggle so newly-added subtasks appear without a full
  // page refresh.
  async function loadChildren(parentId: string): Promise<TaskFull[]> {
    const res = await fetch(`/api/tax-ops/tasks?parent=${encodeURIComponent(parentId)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json() as { tasks: TaskFull[] };
    return body.tasks;
  }

  async function toggleExpand(taskId: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId); else next.add(taskId);
      return next;
    });
    // Lazy-load on first expand; cache forever (until full reload).
    if (!childrenByParent[taskId] && !expanded.has(taskId)) {
      try {
        const kids = await loadChildren(taskId);
        setChildrenByParent(prev => ({ ...prev, [taskId]: kids }));
      } catch (e) {
        toast.error(`Could not load sub-tasks: ${String(e instanceof Error ? e.message : e)}`);
      }
    }
  }

  // Recursive flattener: takes the root rows + cached children and
  // produces a flat list with `depth` so the table can render nested
  // rows with indentation. Skips children that aren't loaded yet.
  function flattenTree(roots: TaskFull[]): Array<{ task: TaskFull; depth: number }> {
    const out: Array<{ task: TaskFull; depth: number }> = [];
    function walk(t: TaskFull, depth: number) {
      out.push({ task: t, depth });
      if (expanded.has(t.id)) {
        for (const child of childrenByParent[t.id] ?? []) {
          walk(child, depth + 1);
        }
      }
    }
    for (const r of roots) walk(r, 0);
    return out;
  }

  async function patchTask(taskId: string, patch: Record<string, unknown>): Promise<void> {
    const res = await fetch(`/api/tax-ops/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    load();
  }

  async function moveTaskStatus(taskId: string, newStatus: string) {
    try {
      await patchTask(taskId, { status: newStatus });
      toast.success('Task moved');
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
    }
  }

  // Stint 56.D — toggle one row in the bulk-select set.
  function toggleSelected(taskId: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId); else next.add(taskId);
      return next;
    });
  }

  function clearSelection() { setSelected(new Set()); }

  async function bulkPatch(patch: Record<string, unknown>) {
    if (selected.size === 0) return;
    try {
      const res = await fetch('/api/tax-ops/tasks/bulk-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_ids: Array.from(selected), patch }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success(`${selected.size} task(s) updated`);
      clearSelection();
      load();
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
    }
  }

  async function deleteTask(taskId: string) {
    if (!confirm('Delete this task? Cascade-deletes subtasks + comments.')) return;
    const res = await fetch(`/api/tax-ops/tasks/${taskId}`, { method: 'DELETE' });
    if (!res.ok) { toast.error('Delete failed'); return; }
    toast.success('Task deleted');
    load();
  }

  if (rows === null) return <PageSkeleton />;

  return (
    <div>
      <PageHeader
        title="Tasks"
        subtitle="Family · Entity · Title · Status · Waiting on · Follow-up · Assignee · Due · Priority. Inline edit everywhere. Press N for quick-capture."
        actions={
          <div className="flex items-center gap-1.5 rounded-md border border-border bg-surface p-0.5">
            <button
              onClick={() => setView('list')}
              className={`inline-flex items-center gap-1 px-2 py-1 text-sm rounded ${view === 'list' ? 'bg-surface-alt text-ink' : 'text-ink-muted hover:text-ink'}`}
            >
              <LayoutListIcon size={11} /> List
            </button>
            <button
              onClick={() => setView('board')}
              className={`inline-flex items-center gap-1 px-2 py-1 text-sm rounded ${view === 'board' ? 'bg-surface-alt text-ink' : 'text-ink-muted hover:text-ink'}`}
            >
              <LayoutGridIcon size={11} /> Board
            </button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative">
          <SearchIcon size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-muted" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search title, description, tags…"
            className="pl-7 pr-2 py-1.5 text-sm border border-border rounded-md bg-surface w-[260px]"
          />
        </div>
        <select
          value={status}
          onChange={e => setStatus(e.target.value)}
          className="px-2 py-1.5 text-sm border border-border rounded-md bg-surface"
        >
          <option value="">All statuses</option>
          {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select
          value={familyId}
          onChange={e => setFamilyId(e.target.value)}
          className="px-2 py-1.5 text-sm border border-border rounded-md bg-surface"
          title="Filter by family — shows tasks linked to entities in this family"
        >
          <option value="">All families</option>
          {families.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <input
          value={assignee}
          onChange={e => setAssignee(e.target.value)}
          placeholder="Assignee short name"
          className="px-2 py-1.5 text-sm border border-border rounded-md bg-surface w-[160px]"
        />
        <div className="flex gap-1 ml-2">
          {QUICK_FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setPreset(preset === f.key ? '' : f.key)}
              title={f.tooltip}
              className={`px-2 py-1 text-xs rounded-md border ${preset === f.key ? 'bg-brand-500 text-white border-brand-500' : 'border-border hover:bg-surface-alt'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        {hasFilters && (
          <button
            onClick={clearFilters}
            className="inline-flex items-center gap-1 px-2 py-1.5 text-sm text-ink-muted hover:text-ink border border-border rounded-md"
          >
            <FilterXIcon size={12} /> Clear
          </button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/tax-ops/tasks/templates"
            className="inline-flex items-center gap-1 px-2 py-1.5 text-sm rounded-md border border-border hover:bg-surface-alt"
            title="Browse task templates / playbooks"
          >
            Templates
          </Link>
          <button
            onClick={() => {
              window.dispatchEvent(new KeyboardEvent('keydown', { key: 'N' }));
            }}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md bg-brand-500 hover:bg-brand-600 text-white"
          >
            <PlusIcon size={12} /> New <kbd className="text-2xs px-1 py-0.5 rounded bg-brand-600">N</kbd>
          </button>
        </div>
      </div>

      {error && <CrmErrorBox message={error} onRetry={load} />}

      {rows.length === 0 ? (
        <EmptyState
          title="No tasks match these filters"
          description={hasFilters ? 'Loosen the filters or press N to add a new task.' : 'Press N anywhere in /tax-ops to capture your first task.'}
        />
      ) : view === 'list' ? (
        <div className="rounded-md border border-border bg-surface overflow-auto relative">
          {/* Stint 56.D — bulk action toolbar slides in when ≥1 row
              is selected. Sticks to the top so it never scrolls out
              of reach with long lists. */}
          {selected.size > 0 && (
            <div className="sticky top-0 z-popover bg-brand-50 border-b border-brand-200 px-3 py-2 flex items-center gap-2 text-sm">
              <span className="font-medium text-brand-800">{selected.size} selected</span>
              <button
                type="button"
                onClick={() => void bulkPatch({ status: 'done' })}
                className="px-2 py-0.5 text-xs rounded border border-border bg-surface hover:bg-surface-alt"
              >
                Mark done
              </button>
              <button
                type="button"
                onClick={() => {
                  const v = window.prompt('New assignee (blank to clear):');
                  if (v === null) return;
                  void bulkPatch({ assignee: v.trim() || null });
                }}
                className="px-2 py-0.5 text-xs rounded border border-border bg-surface hover:bg-surface-alt"
              >
                Reassign…
              </button>
              <select
                onChange={(e) => {
                  const v = e.target.value;
                  if (v) void bulkPatch({ priority: v });
                  e.target.value = '';
                }}
                defaultValue=""
                className="px-2 py-0.5 text-xs rounded border border-border bg-surface"
              >
                <option value="">Set priority…</option>
                <option value="urgent">Urgent</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
              <button
                type="button"
                onClick={() => void bulkPatch({ is_starred: true })}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded border border-border bg-surface hover:bg-surface-alt"
              >
                <StarIcon size={11} /> Star
              </button>
              <button
                type="button"
                onClick={clearSelection}
                aria-label="Clear selection"
                className="ml-auto p-1 text-ink-muted hover:text-ink"
                title="Clear selection"
              >
                <XIcon size={12} />
              </button>
            </div>
          )}
          <table className="w-full text-sm">
            <thead className="bg-surface-alt text-ink-muted sticky top-0 z-sticky">
              <tr className="text-left">
                <th className="px-2 py-1.5 font-medium w-[28px]">
                  <input
                    type="checkbox"
                    aria-label="Select all visible"
                    checked={rows.length > 0 && rows.every(t => selected.has(t.id))}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelected(new Set(rows.map(t => t.id)));
                      } else {
                        clearSelection();
                      }
                    }}
                  />
                </th>
                <th className="px-2 py-1.5 font-medium w-[28px]" aria-label="Star"></th>
                <th className="px-2 py-1.5 font-medium w-[120px]">Family</th>
                <th className="px-2 py-1.5 font-medium w-[150px]">Entity</th>
                <th className="px-2 py-1.5 font-medium">Title</th>
                <th className="px-2 py-1.5 font-medium w-[110px]">Kind</th>
                <th className="px-2 py-1.5 font-medium w-[130px]">Status</th>
                <th className="px-2 py-1.5 font-medium w-[150px]">Waiting on</th>
                <th className="px-2 py-1.5 font-medium w-[110px]">Follow-up</th>
                <th className="px-2 py-1.5 font-medium w-[100px]">Assignee</th>
                <th className="px-2 py-1.5 font-medium w-[110px]">Due</th>
                <th className="px-2 py-1.5 font-medium w-[80px]">Priority</th>
                <th className="px-2 py-1.5 w-[30px]"></th>
              </tr>
            </thead>
            <tbody>
              {flattenTree(rows).map(({ task: t, depth }) => (
                <tr
                  key={t.id}
                  className={[
                    'border-t border-border/70 align-top',
                    selected.has(t.id) ? 'bg-brand-50/40' : 'hover:bg-surface-alt/50',
                  ].join(' ')}
                >
                  <td className="px-2 py-1.5">
                    <input
                      type="checkbox"
                      checked={selected.has(t.id)}
                      onChange={() => toggleSelected(t.id)}
                      aria-label={`Select task ${t.title}`}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <button
                      type="button"
                      onClick={() => void patchTask(t.id, { is_starred: !t.is_starred })}
                      aria-label={t.is_starred ? 'Unstar' : 'Star'}
                      title={t.is_starred ? 'Unstar' : 'Star this task'}
                      className={t.is_starred ? 'text-amber-500 hover:text-amber-600' : 'text-ink-faint hover:text-amber-500'}
                    >
                      <StarIcon size={14} fill={t.is_starred ? 'currentColor' : 'none'} />
                    </button>
                  </td>
                  {/* Family — coloured chip linked to the family detail page.
                      No family / unattached → faint dash. Stint 53. */}
                  <td className="px-2 py-1.5">
                    {t.family_name && t.family_id ? (
                      <Link
                        href={`/tax-ops/families/${t.family_id}`}
                        className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium truncate max-w-[110px] hover:opacity-80 ${familyChipClasses(t.family_name)}`}
                        title={`Open ${t.family_name} family`}
                      >
                        {t.family_name}
                      </Link>
                    ) : (
                      <span className="text-ink-faint italic text-xs">—</span>
                    )}
                  </td>
                  {/* Entity — kept link, only rendered when there's one. */}
                  <td className="px-2 py-1.5 text-xs truncate max-w-[150px]" title={t.entity_name ?? undefined}>
                    {t.entity_id ? (
                      <Link
                        href={`/tax-ops/entities/${t.entity_id}`}
                        className="text-ink hover:text-brand-700 hover:underline"
                      >
                        {t.entity_name ?? '(unknown)'}
                      </Link>
                    ) : <span className="text-ink-faint">—</span>}
                  </td>
                  {/* Title — inline-editable. Click on the link icon to open
                      the detail page, but the text itself stays editable.
                      Stint 55.A — depth-indented + ▸/▾ chevron when the task
                      has subtasks. Stint 55.B — 🔒 / 🔓 chip for blocker. */}
                  <td className="px-2 py-1.5" style={{ paddingLeft: `${0.5 + depth * 1.25}rem` }}>
                    <div className="flex items-center gap-1">
                      {t.subtask_total > 0 ? (
                        <button
                          type="button"
                          onClick={() => void toggleExpand(t.id)}
                          aria-label={expanded.has(t.id) ? 'Collapse sub-tasks' : 'Expand sub-tasks'}
                          className="shrink-0 text-ink-muted hover:text-ink"
                          title={`${t.subtask_done}/${t.subtask_total} sub-tasks done`}
                        >
                          {expanded.has(t.id)
                            ? <ChevronDownIcon size={12} />
                            : <ChevronRightIcon size={12} />}
                        </button>
                      ) : (
                        <span className="shrink-0 w-3" aria-hidden="true" />
                      )}
                      <div className="flex-1 min-w-0">
                        <InlineTextCell
                          value={t.title}
                          onSave={async v => {
                            await patchTask(t.id, { title: v ?? '' });
                          }}
                          placeholder="(empty)"
                        />
                      </div>
                      {/* Stint 56.A — sign-off progress chip. Hidden when 0/3
                          (no sign-offs yet) to avoid clutter. */}
                      {(() => {
                        const done = (t.preparer ? 1 : 0) + (t.reviewer ? 1 : 0) + (t.partner_sign_off ? 1 : 0);
                        if (done === 0) return null;
                        const tone = done === 3 ? 'bg-success-100 text-success-800' : 'bg-amber-50 text-amber-800';
                        const tip = `Sign-off: preparer=${t.preparer ?? '—'} · reviewer=${t.reviewer ?? '—'} · partner=${t.partner_sign_off ?? '—'}`;
                        return (
                          <span
                            className={`shrink-0 inline-flex items-center px-1 rounded text-2xs font-medium ${tone}`}
                            title={tip}
                          >
                            {done}/3
                          </span>
                        );
                      })()}
                      {t.depends_on_task_id && t.blocker_status && (
                        t.blocker_status === 'done' ? (
                          <span
                            className="shrink-0 inline-flex items-center gap-0.5 text-2xs text-success-700"
                            title={`Blocker "${t.blocker_title ?? ''}" is done — ready to work on`}
                          >
                            <UnlockIcon size={10} /> ready
                          </span>
                        ) : (
                          <span
                            className="shrink-0 inline-flex items-center gap-0.5 text-2xs text-warning-700 truncate max-w-[120px]"
                            title={`Blocked by "${t.blocker_title ?? ''}" (${t.blocker_status})`}
                          >
                            <LockIcon size={10} /> {t.blocker_title ?? 'blocker'}
                          </span>
                        )
                      )}
                      <Link
                        href={`/tax-ops/tasks/${t.id}`}
                        className="shrink-0 text-ink-faint hover:text-brand-700 text-xs"
                        title="Open task detail"
                        aria-label="Open task"
                      >
                        ↗
                      </Link>
                    </div>
                    {t.tags.length > 0 && (
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {t.tags.filter(tg => !tg.startsWith('recurring_from:')).slice(0, 3).map((tg, i) => (
                          <span key={i} className="text-2xs px-1 py-0 rounded bg-surface-alt text-ink-muted">{tg}</span>
                        ))}
                      </div>
                    )}
                  </td>
                  {/* Kind — inline editable dropdown. */}
                  <td className="px-2 py-1.5">
                    <select
                      value={t.task_kind}
                      onChange={e => patchTask(t.id, { task_kind: e.target.value }).catch(err => toast.error(String(err)))}
                      className="w-full px-1 py-0.5 text-xs border border-border rounded bg-surface"
                    >
                      {Object.entries(TASK_KIND_LABELS).map(([v, l]) => (
                        <option key={v} value={v}>{l}</option>
                      ))}
                    </select>
                  </td>
                  {/* Status — already inline editable. */}
                  <td className="px-2 py-1.5">
                    <select
                      value={t.status}
                      onChange={e => patchTask(t.id, { status: e.target.value }).catch(err => toast.error(String(err)))}
                      className="w-full px-1 py-0.5 text-xs border border-border rounded bg-surface"
                    >
                      {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </td>
                  {/* Waiting on — inline editable: dropdown for kind + note. */}
                  <td className="px-2 py-1.5">
                    <select
                      value={t.waiting_on_kind ?? ''}
                      onChange={e => patchTask(t.id, { waiting_on_kind: e.target.value || null }).catch(err => toast.error(String(err)))}
                      className="w-full px-1 py-0.5 text-xs border border-border rounded bg-surface mb-0.5"
                    >
                      <option value="">— not waiting —</option>
                      {Object.entries(WAITING_ON_LABELS).map(([v, l]) => (
                        <option key={v} value={v}>{l}</option>
                      ))}
                    </select>
                    {t.waiting_on_kind && (
                      <InlineTextCell
                        value={t.waiting_on_note}
                        onSave={async v => { await patchTask(t.id, { waiting_on_note: v }); }}
                        placeholder="who? (optional)"
                      />
                    )}
                  </td>
                  {/* Follow-up — inline editable date. */}
                  <td className="px-2 py-1.5">
                    <InlineDateCell
                      value={t.follow_up_date}
                      onSave={async v => { await patchTask(t.id, { follow_up_date: v }); }}
                    />
                  </td>
                  {/* Assignee — inline editable text. */}
                  <td className="px-2 py-1.5 text-xs">
                    <InlineTextCell
                      value={t.assignee}
                      onSave={async v => { await patchTask(t.id, { assignee: v }); }}
                      placeholder="—"
                    />
                  </td>
                  {/* Due — inline editable date. */}
                  <td className="px-2 py-1.5">
                    <InlineDateCell
                      value={t.due_date}
                      onSave={async v => { await patchTask(t.id, { due_date: v }); }}
                    />
                  </td>
                  {/* Priority — inline editable dropdown. */}
                  <td className="px-2 py-1.5">
                    <select
                      value={t.priority}
                      onChange={e => patchTask(t.id, { priority: e.target.value }).catch(err => toast.error(String(err)))}
                      className={`w-full px-1 py-0.5 text-2xs border border-border rounded font-medium ${PRIORITY_COLORS[t.priority] ?? 'bg-surface'}`}
                    >
                      <option value="urgent">Urgent</option>
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                    </select>
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <button
                      onClick={() => deleteTask(t.id)}
                      aria-label="Delete task"
                      className="p-1 text-ink-muted hover:text-danger-600"
                    >
                      <Trash2Icon size={11} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <TaskBoard tasks={rows} onMove={moveTaskStatus} />
      )}
    </div>
  );
}
