'use client';

// Stint 67.B.b: per-page force-dynamic — see /clients/page.tsx.
export const dynamic = 'force-dynamic';
// /tax-ops/tasks — rediseño 37.G para gestión de proyectos real.
// Columnas: Family | Entity | Title | Kind | Status | Waiting on |
//           Follow-up | Assignee | Due | Priority | Actions
// Filtros: Mine · Overdue · Waiting · This week + search.
// Inline edit en status, priority, assignee, due_date, follow_up_date.

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import {
  SearchIcon, LayoutListIcon, LayoutGridIcon, PlusIcon, FilterXIcon,
  CalendarIcon, MessagesSquareIcon, ListIcon, Trash2Icon,
  ChevronRightIcon, ChevronDownIcon, LockIcon, UnlockIcon,
  StarIcon, XIcon, SlidersHorizontalIcon,
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
import { TaskHoverPreview } from '@/components/tax-ops/TaskHoverPreview';
import { TaskCalendar } from '@/components/tax-ops/TaskCalendar';
import { TaskContextMenu, type ContextTask } from '@/components/tax-ops/TaskContextMenu';
import { ChipSelect } from '@/components/tax-ops/ChipSelect';
import { DeliverablesRollupChip } from '@/components/tax-ops/TaskDeliverablesPanel';

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
  // Stint 84.B — list view shows effective_status (rolled up from open
  // sub-tasks when the parent is closed but workstreams remain open).
  effective_status?: string;
  is_status_rolled_up?: boolean;
  subtask_open?: number;
  // Stint 84.C — deliverables roll-up chip on each row.
  deliverables?: Array<{
    id: string;
    label: string;
    status: 'pending' | 'drafted' | 'reviewed' | 'signed' | 'filed' | 'na';
    due_date: string | null;
    link_url: string | null;
    notes: string | null;
    sort_order: number;
  }>;
  // Stint 84.E — stale chip data.
  is_stale?: boolean;
  stale_days?: number | null;
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

// Stint 58.T2.3 — status tones for ChipSelect.
const STATUS_TONES: Record<string, string> = {
  queued:              'bg-surface-alt text-ink',
  in_progress:         'bg-info-50 text-info-800',
  waiting_on_external: 'bg-amber-50 text-amber-800',
  waiting_on_internal: 'bg-amber-50 text-amber-800',
  done:                'bg-success-50 text-success-800',
  cancelled:           'bg-surface-alt text-ink-faint',
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

type ViewMode = 'list' | 'board' | 'calendar';

interface FamilyOption { id: string; name: string }

// Stint 67.C: Suspense wrapper removed (see /clients/page.tsx). The
// 57.D rationale ("Suspense required for useSearchParams") only
// applies to static-rendered pages; force-dynamic resolves params at
// request time, no boundary needed.
export default function TasksListPage() {
  return <TasksListContent />;
}

function TasksListContent() {
  // Stint 57.D.1 — URL-persistent filters. State seeded from
  // searchParams; every mutation calls router.replace so refresh +
  // shareable deep links survive.
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [view, setView] = useState<ViewMode>(() => {
    const v = searchParams.get('view');
    return v === 'board' || v === 'calendar' ? v : 'list';
  });
  const [rows, setRows] = useState<TaskFull[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState(searchParams.get('q') ?? '');
  const [status, setStatus] = useState<string>(searchParams.get('status') ?? '');
  const [assignee, setAssignee] = useState<string>(searchParams.get('assignee') ?? '');
  const [preset, setPreset] = useState<string>(searchParams.get('preset') ?? '');
  // Stint 51.A — family filter.
  const [familyId, setFamilyId] = useState<string>(searchParams.get('family_id') ?? '');
  const [families, setFamilies] = useState<FamilyOption[]>([]);
  // Stint 100 — "Show completed" toggle. Off by default; flips the
  // API into showing done/cancelled tasks. Mirrors /crm/tasks.
  const [showCompleted, setShowCompleted] = useState(false);
  // Stint 55.A — sub-tasks tree expansion (not URL-persisted; ephemeral).
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [childrenByParent, setChildrenByParent] = useState<Record<string, TaskFull[]>>({});
  // Stint 56.D — bulk select (ephemeral).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Stint 57.D.7 — context menu state.
  const [contextMenu, setContextMenu] = useState<{ task: ContextTask; x: number; y: number } | null>(null);
  // Stint 58.T2.2 — column visibility. Default surfaces only the
  // high-signal columns; Diego can opt in to the noisier ones via
  // the gear button. Stored in localStorage so the choice survives
  // refresh — independent of saved views.
  const [extraColsVisible, setExtraColsVisible] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const raw = window.localStorage.getItem('cifra.tasks.cols.v1');
      if (raw) return new Set(JSON.parse(raw) as string[]);
    } catch { /* ignore */ }
    return new Set();
  });
  const [colsMenuOpen, setColsMenuOpen] = useState(false);
  function toggleCol(key: string) {
    setExtraColsVisible(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      try {
        window.localStorage.setItem('cifra.tasks.cols.v1', JSON.stringify(Array.from(next)));
      } catch { /* ignore */ }
      return next;
    });
  }
  const showKind     = extraColsVisible.has('kind');
  const showWaiting  = extraColsVisible.has('waiting');
  // Stint 58.fix — Follow-up promoted out of the gear menu and made
  // always-visible. Diego: "no crees que puede ser util que aparezca
  // tambien aqui follow up antes de la columna de due. […] sino veo
  // la fecha tengo que confiar 100x100 en que me va a saltar la
  // notificacion." The top tools (Linear, Asana, Things, Height)
  // never hide action-triggering dates behind a toggle. Kind +
  // Waiting on stay opt-in; they're metadata, not action triggers.
  const toast = useToast();

  // Stint 57.D.1 — sync state → URL. Skip the very first render
  // (otherwise we'd overwrite the URL the user came in with).
  //
  // Stint 59.D — segregate push vs replace per Linear/Asana/Height
  // best practice. Diego: "cuando doy atrás (Google Chrome) no me va
  // a la página anterior, me va a otra distinta."
  // Root cause was using router.replace() for *every* state change
  // including view toggles — replace() removes the previous history
  // entry, so Back skipped two steps. Now:
  //   • Filter changes (q/status/assignee/family_id/preset) → replace.
  //     Filters are not navigation; Back should exit the page.
  //   • View change (list / board / calendar) → push. Three sub-pages
  //     conceptually; Back should return to the previous view.
  const firstSync = useRef(true);
  const prevView = useRef<ViewMode>(view);
  useEffect(() => {
    if (firstSync.current) {
      firstSync.current = false;
      prevView.current = view;
      return;
    }
    const qs = new URLSearchParams();
    if (q) qs.set('q', q);
    if (status) qs.set('status', status);
    if (assignee) qs.set('assignee', assignee);
    if (familyId) qs.set('family_id', familyId);
    if (preset) qs.set('preset', preset);
    if (view !== 'list') qs.set('view', view);
    const url = qs.toString() ? `${pathname}?${qs}` : pathname;
    if (view !== prevView.current) {
      router.push(url, { scroll: false });
      prevView.current = view;
    } else {
      router.replace(url, { scroll: false });
    }
  }, [q, status, assignee, familyId, preset, view, router, pathname]);

  const load = useCallback(() => {
    const qs = new URLSearchParams();
    if (q) qs.set('q', q);
    if (status) qs.set('status', status);
    if (assignee) qs.set('assignee', assignee);
    if (familyId) qs.set('family_id', familyId);
    if (showCompleted) qs.set('show_completed', '1');
    if (preset) {
      const p = QUICK_FILTERS.find(f => f.key === preset);
      p?.apply(qs);
    }
    qs.set('only_root', '1');
    crmLoadShape<TaskFull[]>(`/api/tax-ops/tasks?${qs}`, b => (b as { tasks: TaskFull[] }).tasks)
      .then(rows => { setRows(rows); setError(null); })
      .catch(e => { setError(String(e instanceof Error ? e.message : e)); setRows([]); });
  }, [q, status, assignee, familyId, preset, showCompleted]);

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
  // Stint 84.B — also emits a synthetic `addRow` entry after the last
  // child of every expanded parent so the user can add a sub-task
  // without leaving the table.
  type FlatRow =
    | { kind: 'task'; task: TaskFull; depth: number }
    | { kind: 'add';  parentId: string; parentTitle: string; depth: number };

  function flattenTree(roots: TaskFull[]): FlatRow[] {
    const out: FlatRow[] = [];
    function walk(t: TaskFull, depth: number) {
      out.push({ kind: 'task', task: t, depth });
      if (expanded.has(t.id)) {
        for (const child of childrenByParent[t.id] ?? []) {
          walk(child, depth + 1);
        }
        out.push({ kind: 'add', parentId: t.id, parentTitle: t.title, depth: depth + 1 });
      }
    }
    for (const r of roots) walk(r, 0);
    return out;
  }

  // Stint 84.B — quick-add input state per parent (one input shown at a
  // time; `subtaskDraftFor` is the parent_task_id whose row is open).
  const [subtaskDraftFor, setSubtaskDraftFor] = useState<string | null>(null);
  const [subtaskDraft, setSubtaskDraft] = useState('');

  async function createInlineSubtask(parentId: string, title: string) {
    const t = title.trim();
    if (!t) return;
    try {
      const res = await fetch('/api/tax-ops/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: t, parent_task_id: parentId, priority: 'medium' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Refresh just this parent's children + the parent counts.
      try {
        const kids = await loadChildren(parentId);
        setChildrenByParent(prev => ({ ...prev, [parentId]: kids }));
      } catch (e) {
        // Stint 94 — log for dev visibility. Falling through is OK:
        // load() below refetches the parent counts anyway.
        console.error('[tax-ops/tasks] child refresh failed', e);
      }
      load();
      setSubtaskDraft('');
      setSubtaskDraftFor(parentId); // keep the input open so user can add another
    } catch (e) {
      toast.error(`Could not add sub-task: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function patchTask(taskId: string, patch: Record<string, unknown>): Promise<void> {
    const res = await fetch(`/api/tax-ops/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      // Stint 84.B — surface the API's friendly message (e.g. the
      // "X workstreams still open" 409 for parent-done attempts).
      const body = await res.json().catch(() => ({}));
      const msg = (body as { message?: string; error?: string }).message
        ?? (body as { message?: string; error?: string }).error
        ?? `HTTP ${res.status}`;
      throw new Error(msg);
    }
    // Stint 84.C — bug Diego flagged: editing a sub-task didn't reflect
    // until reload because `load()` only refetches root tasks. Sub-tasks
    // live in `childrenByParent[parentId]`, which we now refresh in
    // parallel for every expanded parent so the UI stays in sync.
    //
    // Stint 94 — `load()` was fire-and-forget previously, so the
    // parent's `effective_status` badge could lag the children update
    // by however long the parent refetch took. Run parent reload +
    // expanded-children refresh in parallel and await both before
    // returning, so the caller's optimistic UI is consistent.
    const parentReload = load();
    const childrenReload = expanded.size > 0
      ? Promise.allSettled(
          [...expanded].map(async (pid) => ({ pid, kids: await loadChildren(pid) })),
        ).then(refreshes => {
          const next: Record<string, TaskFull[]> = { ...childrenByParent };
          for (const r of refreshes) {
            if (r.status === 'fulfilled') next[r.value.pid] = r.value.kids;
          }
          setChildrenByParent(next);
        })
      : Promise.resolve();
    await Promise.all([parentReload, childrenReload]);
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
            <button
              onClick={() => setView('calendar')}
              className={`inline-flex items-center gap-1 px-2 py-1 text-sm rounded ${view === 'calendar' ? 'bg-surface-alt text-ink' : 'text-ink-muted hover:text-ink'}`}
            >
              <CalendarIcon size={11} /> Calendar
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
        {/* Stint 100 — Show completed toggle. Off by default; surface
            done/cancelled tasks on demand. */}
        <label className="inline-flex items-center gap-1.5 text-xs text-ink-soft cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showCompleted}
            onChange={e => setShowCompleted(e.target.checked)}
            className="h-3.5 w-3.5 accent-brand-500 cursor-pointer"
          />
          Show completed
        </label>
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
        {/* Stint 58.T2.2 — column visibility toggle. Default columns
            (Client, Title, Status, Assignee, Due, Priority) cover ~90%
            of cases; the noisier ones (Kind, Waiting on, Follow-up)
            opt in via this menu. Choice persisted in localStorage. */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setColsMenuOpen(o => !o)}
            className="inline-flex items-center gap-1 px-2 py-1.5 text-sm rounded-md border border-border hover:bg-surface-alt"
            aria-haspopup="menu"
            aria-expanded={colsMenuOpen}
            title="Show or hide columns"
          >
            <SlidersHorizontalIcon size={11} /> Columns
          </button>
          {colsMenuOpen && (
            <div
              className="absolute z-popover top-full left-0 mt-1 w-[220px] bg-surface border border-border rounded-md shadow-lg p-2 text-sm"
              onMouseLeave={() => setColsMenuOpen(false)}
            >
              <div className="text-2xs text-ink-muted mb-1.5">Optional columns</div>
              {[
                { key: 'kind', label: 'Kind' },
                { key: 'waiting', label: 'Waiting on' },
              ].map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2 px-1 py-0.5 cursor-pointer hover:bg-surface-alt rounded">
                  <input
                    type="checkbox"
                    checked={extraColsVisible.has(key)}
                    onChange={() => toggleCol(key)}
                  />
                  <span>{label}</span>
                </label>
              ))}
              <div className="mt-2 text-2xs text-ink-faint italic leading-snug">
                Default columns (Client, Title, Status, Assignee,
                Follow-up, Due, Priority) are always shown.
              </div>
            </div>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
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
                {/* Stint 58.T2.1 — Family + Entity merged into one
                    "Client" column with a Family › Entity breadcrumb. */}
                <th className="px-2 py-1.5 font-medium w-[200px]">Client</th>
                <th className="px-2 py-1.5 font-medium">Title</th>
                {showKind     && <th className="px-2 py-1.5 font-medium w-[120px]">Kind</th>}
                <th className="px-2 py-1.5 font-medium w-[120px]">Status</th>
                {showWaiting  && <th className="px-2 py-1.5 font-medium w-[150px]">Waiting on</th>}
                <th className="px-2 py-1.5 font-medium w-[100px]">Assignee</th>
                {/* Stint 58.fix — Follow-up always visible, sits right
                    before Due so the two action-triggering dates read
                    side-by-side. */}
                <th className="px-2 py-1.5 font-medium w-[110px]">Follow-up</th>
                <th className="px-2 py-1.5 font-medium w-[110px]">Due</th>
                <th className="px-2 py-1.5 font-medium w-[90px]">Priority</th>
                <th className="px-2 py-1.5 w-[30px]"></th>
              </tr>
            </thead>
            <tbody>
              {flattenTree(rows).map(row => {
                if (row.kind === 'add') {
                  const isOpen = subtaskDraftFor === row.parentId;
                  // Total visible columns: checkbox + star + client + title +
                  // (kind?) + status + (waiting?) + assignee + follow-up +
                  // due + priority + delete = 10 base + 0..2 conditional.
                  const totalCols = 10 + (showKind ? 1 : 0) + (showWaiting ? 1 : 0);
                  return (
                    <tr
                      key={`add-${row.parentId}`}
                      className="border-t border-border/40 bg-surface-alt/20"
                    >
                      <td colSpan={totalCols} className="px-2 py-1" style={{ paddingLeft: `${4.5 + row.depth * 1.25}rem` }}>
                        {isOpen ? (
                          <div className="flex items-center gap-1.5">
                            <input
                              autoFocus
                              value={subtaskDraft}
                              onChange={(e) => setSubtaskDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  void createInlineSubtask(row.parentId, subtaskDraft);
                                } else if (e.key === 'Escape') {
                                  e.preventDefault();
                                  setSubtaskDraftFor(null);
                                  setSubtaskDraft('');
                                }
                              }}
                              placeholder={`Sub-task under "${row.parentTitle.slice(0, 40)}${row.parentTitle.length > 40 ? '…' : ''}". Enter to add, Esc to cancel.`}
                              className="flex-1 px-2 py-1 text-xs border border-border rounded bg-surface"
                            />
                            <button
                              type="button"
                              onClick={() => void createInlineSubtask(row.parentId, subtaskDraft)}
                              disabled={!subtaskDraft.trim()}
                              className="px-2 py-0.5 text-2xs rounded bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-50"
                            >
                              Add
                            </button>
                            <button
                              type="button"
                              onClick={() => { setSubtaskDraftFor(null); setSubtaskDraft(''); }}
                              className="px-2 py-0.5 text-2xs rounded border border-border hover:bg-surface-alt"
                            >
                              Done
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => { setSubtaskDraftFor(row.parentId); setSubtaskDraft(''); }}
                            className="inline-flex items-center gap-1 text-2xs text-ink-muted hover:text-brand-700"
                          >
                            <PlusIcon size={11} /> Add sub-task
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                }
                const { task: t, depth } = row;
                return (
                <tr
                  key={t.id}
                  onContextMenu={(e) => {
                    // Stint 58.T1.4 — let the browser handle right-click
                    // when the target is an editable field so paste /
                    // select-all / spell-check stay accessible.
                    const tgt = e.target as HTMLElement;
                    const tag = tgt.tagName?.toLowerCase();
                    if (tag === 'input' || tag === 'textarea' || tgt.isContentEditable) {
                      return;
                    }
                    e.preventDefault();
                    setContextMenu({
                      task: { id: t.id, title: t.title, status: t.status, is_starred: t.is_starred },
                      x: e.clientX,
                      y: e.clientY,
                    });
                  }}
                  className={[
                    'border-t border-border/70 align-top',
                    selected.has(t.id) ? 'bg-brand-50/40' : 'hover:bg-surface-alt/50',
                    // Stint 100 — gray-out done / cancelled rows when
                    // showCompleted is on (they're hidden by default).
                    t.status === 'done' || t.status === 'cancelled' ? 'opacity-60' : '',
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
                  {/* Stint 58.T2.1 — Client column = Family › Entity
                      breadcrumb. Both segments are independent links
                      (family chip → /families/[id], entity → entity detail). */}
                  <td className="px-2 py-1.5 max-w-[220px]">
                    {t.family_id || t.entity_id ? (
                      <div className="flex items-center gap-1 min-w-0 text-xs">
                        {t.family_id && t.family_name ? (
                          <Link
                            href={`/tax-ops/families/${t.family_id}`}
                            className={`inline-flex items-center px-1.5 py-0.5 rounded font-medium truncate max-w-[110px] hover:opacity-80 ${familyChipClasses(t.family_name)}`}
                            title={`Open ${t.family_name} family`}
                          >
                            {t.family_name}
                          </Link>
                        ) : (
                          <span className="text-ink-faint italic">—</span>
                        )}
                        {t.entity_id && (
                          <>
                            <span className="text-ink-faint shrink-0" aria-hidden>›</span>
                            <Link
                              href={`/tax-ops/entities/${t.entity_id}`}
                              className="text-ink hover:text-brand-700 hover:underline truncate"
                              title={t.entity_name ?? undefined}
                            >
                              {t.entity_name ?? '(unknown)'}
                            </Link>
                          </>
                        )}
                      </div>
                    ) : (
                      <span className="text-ink-faint italic text-xs">—</span>
                    )}
                  </td>
                  {/* Title — inline-editable. Click on the link icon to open
                      the detail page, but the text itself stays editable.
                      Stint 55.A — depth-indented + ▸/▾ chevron when the task
                      has subtasks. Stint 55.B — 🔒 / 🔓 chip for blocker. */}
                  <td className="px-2 py-1.5" style={{ paddingLeft: `${0.5 + depth * 1.25}rem` }}>
                    <div className="flex items-center gap-1">
                      {/* Stint 84.B — chevron always shown so the user can
                          expand any row to add a sub-task inline, even
                          when the task has no children yet. */}
                      <button
                        type="button"
                        onClick={() => void toggleExpand(t.id)}
                        aria-label={expanded.has(t.id) ? 'Collapse sub-tasks' : 'Expand sub-tasks'}
                        className={`shrink-0 ${
                          t.subtask_total > 0
                            ? 'text-brand-600 hover:text-brand-700'
                            : 'text-ink-muted hover:text-ink'
                        }`}
                        title={
                          t.subtask_total > 0
                            ? `${t.subtask_done}/${t.subtask_total} sub-tasks done`
                            : 'Expand to add a sub-task here'
                        }
                      >
                        {expanded.has(t.id)
                          ? <ChevronDownIcon size={12} />
                          : <ChevronRightIcon size={12} />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <TaskHoverPreview taskId={t.id}>
                          <InlineTextCell
                            value={t.title}
                            onSave={async v => {
                              await patchTask(t.id, { title: v ?? '' });
                            }}
                            placeholder="(empty)"
                          />
                        </TaskHoverPreview>
                      </div>
                      {/* Engagement marker — only when this row actually has
                          sub-tasks. Reads "this is a workstream parent" at a
                          glance and shows the done/total roll-up so Diego can
                          scan progress without expanding. */}
                      {t.subtask_total > 0 && (
                        <span
                          className="shrink-0 px-1 py-0.5 text-2xs font-medium rounded bg-brand-50 text-brand-700 tabular-nums"
                          title={`${t.subtask_done}/${t.subtask_total} workstreams done`}
                        >
                          {t.subtask_done}/{t.subtask_total}
                        </span>
                      )}
                      {/* Stint 58.T2.4 — sign-off progress + blocker chips
                          moved out of the title cell into the hover
                          preview. Title cell now has just chevron + text
                          + ↗ link for clarity. The hover popover surfaces
                          richer status (description, counts, blocker,
                          last comment, sign-off names). Compact 🔒/🔓
                          icon-only kept inline so blocked rows stay
                          glanceable; full title goes in the popover. */}
                      {t.depends_on_task_id && t.blocker_status && (
                        <span
                          className="shrink-0"
                          title={
                            t.blocker_status === 'done'
                              ? `Ready: blocker "${t.blocker_title ?? ''}" is done`
                              : `Blocked by "${t.blocker_title ?? ''}"`
                          }
                          aria-label={t.blocker_status === 'done' ? 'Ready' : 'Blocked'}
                        >
                          {t.blocker_status === 'done'
                            ? <UnlockIcon size={11} className="text-success-700" />
                            : <LockIcon size={11} className="text-warning-700" />}
                        </span>
                      )}
                      {/* Stint 84.C — deliverables roll-up. */}
                      {t.deliverables && t.deliverables.length > 0 && (
                        <span className="shrink-0">
                          <DeliverablesRollupChip items={t.deliverables} />
                        </span>
                      )}
                      {/* Stint 84.E — stale chase reminder. */}
                      {t.is_stale && (
                        <span
                          className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-2xs font-semibold bg-danger-50 text-danger-700 border border-danger-200"
                          title={`Waiting ${t.stale_days ?? 5}d without an update — chase the counterparty.`}
                        >
                          🔴 {t.stale_days ?? 5}d stale
                        </span>
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
                  {/* Kind — Stint 58.T2.3: ChipSelect for design parity.
                      Hidden by default (gear menu), shows when toggled. */}
                  {showKind && (
                    <td className="px-2 py-1.5">
                      <ChipSelect
                        value={t.task_kind}
                        options={Object.entries(TASK_KIND_LABELS).map(([v, l]) => ({ value: v, label: l }))}
                        onChange={(next) => patchTask(t.id, { task_kind: next }).catch(err => toast.error(String(err)))}
                        ariaLabel="Task kind"
                      />
                    </td>
                  )}
                  {/* Status — ChipSelect with status-toned chips.
                      Stint 84.B: when a closed parent has open sub-tasks
                      we show the rolled-up effective status as a
                      read-only chip + warning so the row doesn't lie
                      ("Done while 3 workstreams still in flight"). */}
                  <td className="px-2 py-1.5">
                    {t.is_status_rolled_up && t.effective_status ? (
                      <div className="flex items-center gap-1">
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-medium ${STATUS_TONES[t.effective_status] ?? 'bg-surface-alt text-ink'}`}
                          title={`Parent marked ${t.status === 'done' ? 'Done' : t.status} but ${t.subtask_open} workstream${t.subtask_open === 1 ? '' : 's'} still open. Status reflects the open workstream. Open detail to reset.`}
                        >
                          {STATUSES.find(s => s.value === t.effective_status)?.label ?? t.effective_status}
                        </span>
                        <Link
                          href={`/tax-ops/tasks/${t.id}`}
                          className="text-2xs text-warning-700 hover:text-warning-800"
                          title="Rolled up — open detail to fix"
                        >
                          ⚠
                        </Link>
                      </div>
                    ) : (
                      <ChipSelect
                        value={t.status}
                        options={STATUSES.map(s => ({
                          value: s.value,
                          label: s.label,
                          tone: STATUS_TONES[s.value],
                        }))}
                        onChange={(next) => patchTask(t.id, { status: next }).catch(err => toast.error(String(err)))}
                        ariaLabel="Task status"
                      />
                    )}
                  </td>
                  {/* Waiting on — kept as gear-toggle column. ChipSelect for
                      kind + InlineTextCell for the optional note. */}
                  {showWaiting && (
                    <td className="px-2 py-1.5">
                      <ChipSelect
                        value={t.waiting_on_kind ?? ''}
                        options={[
                          { value: '', label: '— not waiting —' },
                          ...Object.entries(WAITING_ON_LABELS).map(([v, l]) => ({
                            value: v, label: l,
                            tone: 'bg-amber-50 text-amber-800',
                          })),
                        ]}
                        onChange={(next) => patchTask(t.id, { waiting_on_kind: next || null }).catch(err => toast.error(String(err)))}
                        ariaLabel="Waiting on"
                        placeholder="—"
                      />
                      {t.waiting_on_kind && (
                        <div className="mt-0.5">
                          <InlineTextCell
                            value={t.waiting_on_note}
                            onSave={async v => { await patchTask(t.id, { waiting_on_note: v }); }}
                            placeholder="who? (optional)"
                          />
                        </div>
                      )}
                    </td>
                  )}
                  {/* Assignee — inline editable text. */}
                  <td className="px-2 py-1.5 text-xs">
                    <InlineTextCell
                      value={t.assignee}
                      onSave={async v => { await patchTask(t.id, { assignee: v }); }}
                      placeholder="—"
                    />
                  </td>
                  {/* Follow-up — Stint 58.fix: always visible, immediately
                      before Due. Same overdue/today highlighting that
                      InlineDateCell already provides.
                      Stint 64.X.3 — neutral mode for done/cancelled
                      tasks so the dates don't read as "overdue" once
                      the work is closed. */}
                  <td className="px-2 py-1.5">
                    <InlineDateCell
                      value={t.follow_up_date}
                      onSave={async v => { await patchTask(t.id, { follow_up_date: v }); }}
                      mode={t.status === 'done' || t.status === 'cancelled' ? 'neutral' : 'urgency'}
                    />
                  </td>
                  {/* Due — inline editable date. */}
                  <td className="px-2 py-1.5">
                    <InlineDateCell
                      value={t.due_date}
                      onSave={async v => { await patchTask(t.id, { due_date: v }); }}
                      mode={t.status === 'done' || t.status === 'cancelled' ? 'neutral' : 'urgency'}
                    />
                  </td>
                  {/* Priority — Stint 58.T2.3: ChipSelect with priority tone. */}
                  <td className="px-2 py-1.5">
                    <ChipSelect
                      value={t.priority}
                      options={[
                        { value: 'urgent', label: 'Urgent', tone: PRIORITY_COLORS.urgent },
                        { value: 'high',   label: 'High',   tone: PRIORITY_COLORS.high },
                        { value: 'medium', label: 'Medium', tone: PRIORITY_COLORS.medium },
                        { value: 'low',    label: 'Low',    tone: PRIORITY_COLORS.low },
                      ]}
                      onChange={(next) => patchTask(t.id, { priority: next }).catch(err => toast.error(String(err)))}
                      ariaLabel="Priority"
                    />
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
                );
              })}
            </tbody>
          </table>
        </div>
      ) : view === 'board' ? (
        <TaskBoard tasks={rows} onMove={moveTaskStatus} />
      ) : (
        <TaskCalendar
          tasks={rows.map(t => ({
            id: t.id,
            title: t.title,
            due_date: t.due_date,
            status: t.status,
            priority: t.priority,
            is_starred: t.is_starred,
          }))}
        />
      )}

      {contextMenu && (
        <TaskContextMenu
          task={contextMenu.task}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onMarkDone={(id) => patchTask(id, { status: 'done' }).catch(e => toast.error(String(e)))}
          onToggleStar={(id, next) => patchTask(id, { is_starred: next }).catch(e => toast.error(String(e)))}
          onSetPriority={(id, priority) => patchTask(id, { priority }).catch(e => toast.error(String(e)))}
          onReassign={(id) => {
            const v = window.prompt('New assignee (blank to clear):');
            if (v === null) return;
            patchTask(id, { assignee: v.trim() || null }).catch(e => toast.error(String(e)));
          }}
          onDelete={deleteTask}
        />
      )}
    </div>
  );
}
