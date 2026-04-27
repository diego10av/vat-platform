'use client';

// /tax-ops/tasks — rediseño 37.G para gestión de proyectos real.
// Columnas: Family | Entity | Title | Kind | Status | Waiting on |
//           Follow-up | Assignee | Due | Priority | Actions
// Filtros: Mine · Overdue · Waiting · This week + search.
// Inline edit en status, priority, assignee, due_date, follow_up_date.

import { useEffect, useState, useCallback, useMemo, useRef, Suspense } from 'react';
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
import { TaskSavedViews } from '@/components/tax-ops/TaskSavedViews';
import { TaskHoverPreview } from '@/components/tax-ops/TaskHoverPreview';
import { TaskCalendar } from '@/components/tax-ops/TaskCalendar';
import { TaskContextMenu, type ContextTask } from '@/components/tax-ops/TaskContextMenu';
import { ChipSelect } from '@/components/tax-ops/ChipSelect';

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

export default function TasksListPage() {
  // Suspense boundary required by Next 16 useSearchParams under
  // /app router when the consumer renders during SSR.
  return (
    <Suspense fallback={null}>
      <TasksListContent />
    </Suspense>
  );
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
  const showFollowUp = extraColsVisible.has('followup');
  const toast = useToast();

  // Stint 57.D.1 — sync state → URL. Skip the very first render
  // (otherwise we'd overwrite the URL the user came in with).
  const firstSync = useRef(true);
  useEffect(() => {
    if (firstSync.current) { firstSync.current = false; return; }
    const qs = new URLSearchParams();
    if (q) qs.set('q', q);
    if (status) qs.set('status', status);
    if (assignee) qs.set('assignee', assignee);
    if (familyId) qs.set('family_id', familyId);
    if (preset) qs.set('preset', preset);
    if (view !== 'list') qs.set('view', view);
    const s = qs.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }, [q, status, assignee, familyId, preset, view, router, pathname]);

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

  // Stint 57.D.2 — query string for saved-views capture (excludes
  // ephemeral things like view/expand state).
  const currentQuery = useMemo(() => {
    const qs = new URLSearchParams();
    if (q) qs.set('q', q);
    if (status) qs.set('status', status);
    if (assignee) qs.set('assignee', assignee);
    if (familyId) qs.set('family_id', familyId);
    if (preset) qs.set('preset', preset);
    return qs.toString();
  }, [q, status, assignee, familyId, preset]);

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
        <TaskSavedViews currentQuery={currentQuery} />
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
                { key: 'followup', label: 'Follow-up date' },
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
                Default columns (Client, Title, Status, Assignee, Due,
                Priority) are always shown.
              </div>
            </div>
          )}
        </div>
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
                {/* Stint 58.T2.1 — Family + Entity merged into one
                    "Client" column with a Family › Entity breadcrumb. */}
                <th className="px-2 py-1.5 font-medium w-[200px]">Client</th>
                <th className="px-2 py-1.5 font-medium">Title</th>
                {showKind     && <th className="px-2 py-1.5 font-medium w-[120px]">Kind</th>}
                <th className="px-2 py-1.5 font-medium w-[120px]">Status</th>
                {showWaiting  && <th className="px-2 py-1.5 font-medium w-[150px]">Waiting on</th>}
                {showFollowUp && <th className="px-2 py-1.5 font-medium w-[110px]">Follow-up</th>}
                <th className="px-2 py-1.5 font-medium w-[100px]">Assignee</th>
                <th className="px-2 py-1.5 font-medium w-[110px]">Due</th>
                <th className="px-2 py-1.5 font-medium w-[90px]">Priority</th>
                <th className="px-2 py-1.5 w-[30px]"></th>
              </tr>
            </thead>
            <tbody>
              {flattenTree(rows).map(({ task: t, depth }) => (
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
                  {/* Status — ChipSelect with status-toned chips. */}
                  <td className="px-2 py-1.5">
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
                  {/* Follow-up — gear-toggle column. */}
                  {showFollowUp && (
                    <td className="px-2 py-1.5">
                      <InlineDateCell
                        value={t.follow_up_date}
                        onSave={async v => { await patchTask(t.id, { follow_up_date: v }); }}
                      />
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
                  {/* Due — inline editable date. */}
                  <td className="px-2 py-1.5">
                    <InlineDateCell
                      value={t.due_date}
                      onSave={async v => { await patchTask(t.id, { due_date: v }); }}
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
              ))}
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
