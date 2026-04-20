'use client';

// ════════════════════════════════════════════════════════════════════════
// /clients — the new top-level view. One row per client; each row
// expands to show the entities that hang off it + their lifecycle.
//
// Stint 12: URL-synced filters + sort dropdown + pagination.
// ════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Building2Icon, PlusIcon, SearchIcon, ChevronRightIcon,
  AlertTriangleIcon, CircleIcon,
} from 'lucide-react';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { useListState, paginate } from '@/lib/use-list-state';
import { ListFooter } from '@/components/ui/ListFooter';

interface Entity {
  id: string;
  name: string;
  vat_number: string | null;
  matricule: string | null;
  regime: string;
  frequency: string;
  entity_type: string | null;
  legal_form: string | null;
  vat_status: string;
}

interface Client {
  id: string;
  name: string;
  kind: 'end_client' | 'csp' | 'other';
  vat_contact_name: string | null;
  vat_contact_email: string | null;
  vat_contact_phone: string | null;
  vat_contact_role: string | null;
  vat_contact_country: string | null;
  address: string | null;
  entity_count: number;
  pending_registration_count: number;
  created_at: string;
  updated_at: string;
}

const SORT_KEYS = ['name', 'entities', 'pending', 'updated'] as const;
type ClientSortKey = typeof SORT_KEYS[number];
const FILTERS = ['all', 'end_client', 'csp', 'other'] as const;
type ClientFilter = typeof FILTERS[number];
const PAGE_SIZES = [25, 50, 100, 250] as const;

export default function ClientsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ClientsContent />
    </Suspense>
  );
}

function ClientsContent() {
  const router = useRouter();
  const [clients, setClients] = useState<Client[] | null>(null);
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const list = useListState<ClientSortKey, ClientFilter>({
    basePath: '/clients',
    sortKeys: SORT_KEYS,
    defaultSort: 'name',
    defaultDir: 'asc',
    filterValues: FILTERS,
    defaultFilter: 'all',
    pageSizes: PAGE_SIZES,
    defaultPageSize: 50,
  });

  const load = useCallback(async () => {
    setError(null);
    try {
      // Server-side filters (q + kind) are still applied via the API
      // because the backend index helps at scale.
      const sp = new URLSearchParams();
      if (list.q.trim()) sp.set('q', list.q.trim());
      if (list.filter !== 'all') sp.set('kind', list.filter);
      const res = await fetch(`/api/clients${sp.toString() ? '?' + sp.toString() : ''}`);
      const data = await res.json();
      if (res.status === 501 && data?.error?.code === 'schema_missing') {
        setSchemaMissing(true);
        setClients([]);
        return;
      }
      if (!res.ok) {
        setError(data?.error?.message ?? 'Failed to load clients.');
        setClients([]);
        return;
      }
      setClients(data.clients as Client[]);
      setSchemaMissing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
      setClients([]);
    }
  }, [list.q, list.filter]);

  useEffect(() => {
    const t = setTimeout(load, 180);
    return () => clearTimeout(t);
  }, [load]);

  if (clients === null) return <PageSkeleton />;

  const totalClients = clients.length;
  const pendingVat = clients.reduce((s, c) => s + (c.pending_registration_count || 0), 0);

  const sorted = [...clients].sort((a, b) => {
    const mul = list.dir === 'asc' ? 1 : -1;
    switch (list.sort) {
      case 'entities': return mul * (a.entity_count - b.entity_count);
      case 'pending':  return mul * (a.pending_registration_count - b.pending_registration_count);
      case 'updated':  return mul * (new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime());
      case 'name':
      default:         return mul * a.name.localeCompare(b.name);
    }
  });
  const page = paginate(sorted, list.page, list.pageSize);

  return (
    <div>
      {/* Header */}
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight">Clients</h1>
          <p className="text-[12.5px] text-ink-muted mt-1 max-w-xl">
            Each client owns one or more Luxembourg entities. Add a client
            first, then hang entities off it.
          </p>
        </div>
        <button
          onClick={() => router.push('/clients/new')}
          className="h-9 px-3.5 rounded-md bg-brand-500 text-white text-[12.5px] font-semibold hover:bg-brand-600 transition-colors inline-flex items-center gap-1.5 shrink-0"
        >
          <PlusIcon size={14} /> New client
        </button>
      </div>

      {/* Schema-missing banner */}
      {schemaMissing && (
        <div className="mb-6 rounded-xl border border-warning-200 bg-gradient-to-br from-warning-50 to-surface p-5 flex items-start gap-4">
          <div className="w-9 h-9 rounded-lg bg-warning-500 text-white inline-flex items-center justify-center shrink-0">
            <AlertTriangleIcon size={16} />
          </div>
          <div>
            <h3 className="text-[14px] font-semibold text-ink">Migration not applied</h3>
            <p className="text-[12.5px] text-ink-soft mt-1 leading-relaxed">
              Apply <code className="text-[11.5px] bg-surface-alt px-1 py-0.5 rounded">migrations/005_clients_and_approvers.sql</code> in
              Supabase SQL Editor to enable the Clients model. Existing
              entities will be auto-grouped by their current client name.
            </p>
          </div>
        </div>
      )}

      {error && !schemaMissing && (
        <div className="mb-4 text-[12px] text-danger-700 bg-danger-50 border border-danger-200 rounded px-3 py-2">
          {error}
        </div>
      )}

      {/* KPIs — actionable only */}
      {!schemaMissing && (
        <div className="grid grid-cols-2 gap-3 mb-5 max-w-lg">
          <Kpi label="Total clients" value={totalClients.toString()} />
          {pendingVat > 0 ? (
            <Kpi
              label="Pending VAT registration"
              value={pendingVat.toString()}
              tone="warning"
              hint="Click to filter →"
              onClick={() => {
                // Scroll to the first row that has pending_registration > 0
                const el = document.querySelector('[data-has-pending="1"]');
                el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }}
            />
          ) : (
            <Kpi label="Pending VAT registration" value="0" tone="neutral" />
          )}
        </div>
      )}

      {/* Filters + sort */}
      {!schemaMissing && (
        <div className="mb-3 flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 max-w-xs">
            <SearchIcon size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted" />
            <input
              value={list.q}
              onChange={(e) => list.setQ(e.target.value)}
              placeholder="Search clients"
              className="w-full h-8 pl-8 pr-3 text-[12.5px] border border-border-strong rounded-md bg-surface focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <KindChip label="All"       active={list.filter === 'all'}        onClick={() => list.setFilter('all')} />
          <KindChip label="End client" active={list.filter === 'end_client'} onClick={() => list.setFilter('end_client')} />
          <KindChip label="CSP"       active={list.filter === 'csp'}        onClick={() => list.setFilter('csp')} />
          <KindChip label="Other"     active={list.filter === 'other'}      onClick={() => list.setFilter('other')} />

          {/* Sort dropdown — client page uses cards not tables, so no
              sortable headers. Dropdown is the equivalent. */}
          <div className="ml-auto flex items-center gap-1.5 text-[11.5px] text-ink-muted">
            Sort
            <select
              value={`${list.sort}:${list.dir}`}
              onChange={e => {
                const [s, d] = e.target.value.split(':') as [ClientSortKey, 'asc' | 'desc'];
                if (s !== list.sort) list.toggleSort(s);
                if (d !== list.dir) list.toggleSort(s);
              }}
              className="h-8 px-2 border border-border-strong rounded text-[11.5px] text-ink bg-surface"
            >
              <option value="name:asc">Name A→Z</option>
              <option value="name:desc">Name Z→A</option>
              <option value="entities:desc">Most entities first</option>
              <option value="entities:asc">Fewest entities first</option>
              <option value="pending:desc">Most pending registrations</option>
              <option value="updated:desc">Recently updated</option>
            </select>
          </div>
        </div>
      )}

      {/* List */}
      {!schemaMissing && clients.length === 0 && (list.q || list.filter !== 'all') && (
        <div className="bg-surface border border-border rounded-lg">
          <EmptyState
            illustration="empty_search"
            title="No clients match your filter"
            description="Try a different search or clear the filter to see the full list."
            action={
              <button
                onClick={() => { list.setQ(''); list.setFilter('all'); }}
                className="h-9 px-4 rounded-md border border-border-strong text-[12.5px] font-medium text-ink-soft hover:text-ink hover:bg-surface-alt"
              >
                Clear filters
              </button>
            }
          />
        </div>
      )}

      {!schemaMissing && clients.length === 0 && !list.q && list.filter === 'all' && (
        <div className="bg-surface border border-border rounded-lg">
          <EmptyState
            illustration="empty_clients"
            title="No clients yet"
            description="Start by creating your first client. After that, you can add the Luxembourg entities that belong to them."
            action={
              <button
                onClick={() => router.push('/clients/new')}
                className="h-9 px-4 rounded-md bg-brand-500 text-white text-[12.5px] font-semibold hover:bg-brand-600 inline-flex items-center gap-1.5"
              >
                <PlusIcon size={14} /> Create first client
              </button>
            }
          />
        </div>
      )}

      {!schemaMissing && clients.length > 0 && (
        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <div className="p-2 space-y-2">
            {page.visible.map((c) => (
              <ClientCard key={c.id} client={c} />
            ))}
          </div>
          <ListFooter
            start={page.start}
            end={page.end}
            total={page.total}
            allTotal={clients.length}
            page={page.page}
            totalPages={page.totalPages}
            pageSize={list.pageSize}
            pageSizes={PAGE_SIZES}
            onPage={list.setPage}
            onPageSize={list.setPageSize}
          />
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── subcomponents ─────────────────────────────

function ClientCard({ client }: { client: Client }) {
  const [expanded, setExpanded] = useState(false);
  const [entities, setEntities] = useState<Entity[] | null>(null);

  async function ensureLoaded() {
    if (entities !== null) return;
    try {
      const res = await fetch(`/api/clients/${client.id}`);
      const data = await res.json();
      if (res.ok) setEntities(data.entities ?? []);
    } catch { /* silent */ }
  }

  function toggle() {
    setExpanded((prev) => {
      const next = !prev;
      if (next) void ensureLoaded();
      return next;
    });
  }

  return (
    <div
      className="bg-surface border border-border rounded-lg overflow-hidden"
      data-has-pending={client.pending_registration_count > 0 ? '1' : '0'}
    >
      <button onClick={toggle} className="w-full text-left px-4 py-3 hover:bg-surface-alt/40 transition-colors">
        <div className="flex items-center gap-3">
          <ChevronRightIcon
            size={14}
            className={`text-ink-muted transition-transform ${expanded ? 'rotate-90' : ''}`}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[14px] font-semibold text-ink">{client.name}</span>
              <KindBadge kind={client.kind} />
              {client.vat_contact_country && (
                <span className="text-[10px] font-mono text-ink-muted bg-surface-alt px-1.5 py-0.5 rounded">
                  {client.vat_contact_country}
                </span>
              )}
              {client.pending_registration_count > 0 && (
                <span className="text-[10px] font-semibold text-warning-700 bg-warning-50 border border-warning-200 rounded px-1.5 py-0.5">
                  {client.pending_registration_count} pending reg.
                </span>
              )}
            </div>
            <div className="text-[11.5px] text-ink-muted mt-0.5">
              {client.entity_count} {client.entity_count === 1 ? 'entity' : 'entities'}
              {client.vat_contact_name && (
                <>
                  <span className="text-ink-faint mx-1.5">·</span>
                  <span>{client.vat_contact_name}</span>
                  {client.vat_contact_role && <span className="text-ink-faint"> ({client.vat_contact_role})</span>}
                </>
              )}
            </div>
          </div>
          <Link
            href={`/clients/${client.id}`}
            onClick={(e) => e.stopPropagation()}
            className="text-[11.5px] font-medium text-brand-600 hover:text-brand-800 hover:underline shrink-0"
          >
            Profile →
          </Link>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-divider">
          {entities === null ? (
            <div className="px-4 py-3 text-[11.5px] text-ink-muted">Loading entities…</div>
          ) : entities.length === 0 ? (
            <div className="px-4 py-4 text-center">
              <div className="text-[12px] text-ink-muted mb-2">No entities under this client yet</div>
              <Link
                href={`/clients/${client.id}`}
                className="text-[11.5px] font-medium text-brand-600 hover:underline"
              >
                Add an entity →
              </Link>
            </div>
          ) : (
            <ul className="divide-y divide-divider">
              {entities.map((e) => (
                <li key={e.id}>
                  <Link
                    href={`/entities/${e.id}`}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-alt/40 transition-colors"
                  >
                    <VatStatusDot status={e.vat_status} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium text-ink truncate">{e.name}</div>
                      <div className="text-[11px] text-ink-muted mt-0.5">
                        {e.vat_number || '(no VAT)'} · {e.regime} / {e.frequency}
                        {e.legal_form && <> · {e.legal_form}</>}
                      </div>
                    </div>
                    <ChevronRightIcon size={12} className="text-ink-faint shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function KindBadge({ kind }: { kind: Client['kind'] }) {
  const config = {
    end_client: { label: 'End client', colour: 'bg-brand-50 text-brand-700 border-brand-200' },
    csp:        { label: 'CSP',        colour: 'bg-purple-50 text-purple-700 border-purple-200' },
    other:      { label: 'Other',      colour: 'bg-surface-alt text-ink-soft border-border' },
  }[kind];
  return (
    <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border ${config.colour}`}>
      {config.label}
    </span>
  );
}

function VatStatusDot({ status }: { status: string }) {
  const colour =
    status === 'registered'            ? 'text-emerald-600' :
    status === 'pending_registration'  ? 'text-warning-600' :
    status === 'not_applicable'        ? 'text-ink-faint' :
                                         'text-ink-faint';
  const title = status.replace(/_/g, ' ');
  return <CircleIcon size={8} className={`fill-current ${colour}`} aria-label={title} />;
}

function KindChip({
  label, active, onClick,
}: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={[
        'h-8 px-3 rounded-md text-[11.5px] font-medium border transition-colors',
        active
          ? 'bg-brand-50 text-brand-700 border-brand-200'
          : 'bg-surface text-ink-soft border-border hover:bg-surface-alt',
      ].join(' ')}
    >
      {label}
    </button>
  );
}

function Kpi({
  label, value, tone = 'default', hint, onClick,
}: {
  label: string;
  value: string;
  tone?: 'default' | 'warning' | 'neutral';
  hint?: string;
  onClick?: () => void;
}) {
  const base = 'rounded-lg border p-3 text-left';
  const colours = {
    default: 'bg-surface border-border',
    warning: 'bg-warning-50 border-warning-200',
    neutral: 'bg-surface border-border',
  }[tone];
  const Wrapper = onClick ? 'button' : 'div';
  return (
    <Wrapper onClick={onClick} className={`${base} ${colours} ${onClick ? 'hover:border-border-strong cursor-pointer' : ''}`}>
      <div className="text-[10.5px] uppercase tracking-wide font-semibold text-ink-muted">{label}</div>
      <div className="text-[20px] font-bold tabular-nums text-ink mt-0.5">{value}</div>
      {hint && <div className="text-[10.5px] text-ink-muted mt-1">{hint}</div>}
    </Wrapper>
  );
}
