'use client';

// ════════════════════════════════════════════════════════════════════════
// /entities — flat cross-client list of every Luxembourg entity.
//
// Stint 12: URL-synced filters + column sort + pagination (via
// useListState + ListFooter). Matches the declarations-list UX.
// ════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  PlusIcon, Trash2Icon, ArrowRightIcon, SearchIcon,
  ChevronUpIcon, ChevronDownIcon,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { Card } from '@/components/ui/Card';
import { useListState, paginate, type SortDir } from '@/lib/use-list-state';
import { ListFooter } from '@/components/ui/ListFooter';
import { useToast } from '@/components/Toaster';
import { describeApiError, formatUiError } from '@/lib/ui-errors';

interface Entity {
  id: string;
  name: string;
  client_id: string | null;
  client_name: string | null;
  vat_number: string | null;
  matricule: string | null;
  rcs_number: string | null;
  legal_form: string | null;
  entity_type: string | null;
  regime: string;
  frequency: string;
  vat_status: 'registered' | 'pending_registration' | 'not_applicable';
}

interface ClientRow {
  id: string;
  name: string;
}

type SortKey = 'entity' | 'client' | 'vat_status' | 'regime' | 'frequency' | 'vat_number';
type VatFilter = 'all' | 'registered' | 'pending';

const SORT_KEYS = ['entity', 'client', 'vat_status', 'regime', 'frequency', 'vat_number'] as const;
const FILTERS = ['all', 'registered', 'pending'] as const;
const PAGE_SIZES = [25, 50, 100, 250] as const;

export default function EntitiesPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <EntitiesContent />
    </Suspense>
  );
}

function EntitiesContent() {
  const router = useRouter();
  const toast = useToast();
  const [entities, setEntities] = useState<Entity[] | null>(null);
  const [clients, setClients] = useState<Map<string, ClientRow>>(new Map());

  const list = useListState<SortKey, VatFilter>({
    basePath: '/entities',
    sortKeys: SORT_KEYS,
    defaultSort: 'entity',
    defaultDir: 'asc',
    filterValues: FILTERS,
    defaultFilter: 'all',
    pageSizes: PAGE_SIZES,
    defaultPageSize: 50,
  });

  const load = useCallback(async () => {
    try {
      const [entRes, clRes] = await Promise.all([
        fetch('/api/entities').then(r => r.ok ? r.json() : []),
        fetch('/api/clients').then(r => r.ok ? r.json() : { clients: [] }),
      ]);
      setEntities(entRes as Entity[]);
      const m = new Map<string, ClientRow>();
      for (const c of (clRes?.clients ?? []) as ClientRow[]) m.set(c.id, c);
      setClients(m);
    } catch {
      setEntities([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleDelete(entity: Entity) {
    if (!confirm(`Delete "${entity.name}"? This hides it from the list but keeps the data for audit.`)) return;
    try {
      const res = await fetch(`/api/entities/${entity.id}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'user_deleted' }),
      });
      if (!res.ok) {
        const e = await describeApiError(res, 'Could not delete this entity.');
        toast.error(e.message, e.hint);
        return;
      }
      toast.success(`${entity.name} deleted.`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Network error.');
    }
  }

  if (!entities) return <PageSkeleton />;

  const pendingCount = entities.filter(e => e.vat_status === 'pending_registration').length;
  const registeredCount = entities.filter(e => e.vat_status !== 'pending_registration').length;

  const filtered = entities.filter(e => {
    if (list.filter === 'registered' && e.vat_status === 'pending_registration') return false;
    if (list.filter === 'pending' && e.vat_status !== 'pending_registration') return false;
    if (list.q.trim()) {
      const needle = list.q.trim().toLowerCase();
      const clientName = e.client_id ? clients.get(e.client_id)?.name : e.client_name;
      const blob = [e.name, clientName, e.vat_number, e.matricule, e.legal_form, e.entity_type].filter(Boolean).join(' ').toLowerCase();
      if (!blob.includes(needle)) return false;
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    const mul = list.dir === 'asc' ? 1 : -1;
    const clientA = a.client_id ? clients.get(a.client_id)?.name ?? a.client_name ?? '' : a.client_name ?? '';
    const clientB = b.client_id ? clients.get(b.client_id)?.name ?? b.client_name ?? '' : b.client_name ?? '';
    switch (list.sort) {
      case 'client':      return mul * clientA.localeCompare(clientB);
      case 'vat_status':  return mul * a.vat_status.localeCompare(b.vat_status);
      case 'regime':      return mul * a.regime.localeCompare(b.regime);
      case 'frequency':   return mul * a.frequency.localeCompare(b.frequency);
      case 'vat_number':  return mul * (a.vat_number ?? '').localeCompare(b.vat_number ?? '');
      case 'entity':
      default:            return mul * a.name.localeCompare(b.name);
    }
  });

  const page = paginate(sorted, list.page, list.pageSize);

  return (
    <div>
      <PageHeader
        title="All entities"
        subtitle="Cross-client list. Use this when you need to search across clients — otherwise work from Clients → drill in."
        actions={
          <Button
            variant="primary"
            icon={<PlusIcon size={14} />}
            onClick={() => router.push('/entities/new')}
          >
            New entity
          </Button>
        }
      />

      {/* Empty state */}
      {entities.length === 0 && (
        <Card>
          <EmptyState
            illustration="empty_clients"
            title="No entities yet"
            description="Entities (SOPARFIs, AIFMs, SCSps, holdings) hang off clients. Create a client and its first entity to start preparing returns."
            action={
              <Link
                href="/clients/new"
                className="h-9 px-4 rounded-md bg-brand-500 text-white text-[12.5px] font-semibold hover:bg-brand-600 inline-flex items-center gap-1.5"
              >
                <PlusIcon size={13} /> Create first client
              </Link>
            }
          />
        </Card>
      )}

      {/* Filter + search */}
      {entities.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="relative flex-1 min-w-[220px] max-w-xs">
            <SearchIcon size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted" />
            <input
              value={list.q}
              onChange={(e) => list.setQ(e.target.value)}
              placeholder="Search name, client, VAT, matricule"
              className="w-full h-8 pl-8 pr-3 text-[12.5px] border border-border-strong rounded-md bg-surface focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <FilterChip active={list.filter === 'all'}        onClick={() => list.setFilter('all')}        label={`All (${entities.length})`} />
          <FilterChip active={list.filter === 'registered'} onClick={() => list.setFilter('registered')} label={`Registered (${registeredCount})`} />
          <FilterChip
            active={list.filter === 'pending'}
            onClick={() => list.setFilter('pending')}
            label={`Pending registration (${pendingCount})`}
            urgent={pendingCount > 0}
          />
        </div>
      )}

      {/* Empty filter results */}
      {entities.length > 0 && filtered.length === 0 && (
        <Card>
          <EmptyState
            illustration={list.filter === 'pending' && !list.q ? 'empty_approved' : 'empty_search'}
            title={list.q ? 'No matches' : (list.filter === 'pending' ? 'No pending registrations' : 'No matches')}
            description={
              list.filter === 'pending' && !list.q
                ? 'All entities are already VAT-registered — nothing waiting for AED paperwork.'
                : 'Adjust the search or switch filter to see more.'
            }
            action={
              list.q || list.filter !== 'all'
                ? <Button variant="secondary" onClick={() => { list.setQ(''); list.setFilter('all'); }}>Clear filters</Button>
                : undefined
            }
          />
        </Card>
      )}

      {/* List */}
      {filtered.length > 0 && (
        <Card className="overflow-hidden">
          <table className="w-full text-[12.5px]">
            <thead className="bg-surface-alt border-b border-divider text-ink-muted">
              <tr>
                <SortableTh active={list.sort === 'client'} dir={list.dir} onClick={() => list.toggleSort('client')}>Client</SortableTh>
                <SortableTh active={list.sort === 'entity'} dir={list.dir} onClick={() => list.toggleSort('entity')}>Entity</SortableTh>
                <SortableTh active={list.sort === 'vat_status'} dir={list.dir} onClick={() => list.toggleSort('vat_status')}>VAT status</SortableTh>
                <SortableTh active={list.sort === 'regime'} dir={list.dir} onClick={() => list.toggleSort('regime')}>Regime</SortableTh>
                <SortableTh active={list.sort === 'frequency'} dir={list.dir} onClick={() => list.toggleSort('frequency')}>Frequency</SortableTh>
                <SortableTh active={list.sort === 'vat_number'} dir={list.dir} onClick={() => list.toggleSort('vat_number')}>VAT number</SortableTh>
                <Th />
              </tr>
            </thead>
            <tbody>
              {page.visible.map(entity => {
                const client = entity.client_id ? clients.get(entity.client_id) : null;
                return (
                  <tr key={entity.id} className="border-b border-divider last:border-0 hover:bg-surface-alt/60 transition-colors duration-150">
                    <td className="px-4 py-3">
                      {client ? (
                        <Link href={`/clients/${client.id}`} className="text-ink-soft hover:text-brand-600 hover:underline transition-colors">
                          {client.name}
                        </Link>
                      ) : entity.client_name ? (
                        <span className="text-ink-soft">{entity.client_name}</span>
                      ) : (
                        <span className="text-ink-faint italic">no client</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/entities/${entity.id}`} className="font-medium text-ink hover:text-brand-600 transition-colors">
                        {entity.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <VatStatusBadge status={entity.vat_status} />
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={entity.regime === 'simplified' ? 'info' : 'violet'}>{entity.regime}</Badge>
                    </td>
                    <td className="px-4 py-3 text-ink-soft capitalize">{entity.frequency}</td>
                    <td className="px-4 py-3 text-ink-soft font-mono text-[11.5px]">
                      {entity.vat_number || <span className="text-ink-faint">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          href={`/entities/${entity.id}`}
                          className="p-1.5 rounded-md text-ink-muted hover:text-brand-600 hover:bg-surface-alt transition-colors"
                          title="Open"
                          aria-label={`Open ${entity.name}`}
                        >
                          <ArrowRightIcon size={14} />
                        </Link>
                        <button
                          onClick={() => handleDelete(entity)}
                          className="p-1.5 rounded-md text-ink-muted hover:text-danger-700 hover:bg-danger-50 transition-colors"
                          title="Delete"
                          aria-label={`Delete ${entity.name}`}
                        >
                          <Trash2Icon size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <ListFooter
            start={page.start}
            end={page.end}
            total={page.total}
            allTotal={entities.length}
            page={page.page}
            totalPages={page.totalPages}
            pageSize={list.pageSize}
            pageSizes={PAGE_SIZES}
            onPage={list.setPage}
            onPageSize={list.setPageSize}
          />
        </Card>
      )}
    </div>
  );
}

// ───────────────────────────── subcomponents ─────────────────────────────

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="px-4 py-2.5 text-left font-medium text-[10.5px] uppercase tracking-[0.06em]">{children}</th>;
}

function SortableTh({
  children, active, dir, onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
}) {
  return (
    <th className="px-4 py-2.5 text-left font-medium text-[10.5px] uppercase tracking-[0.06em]">
      <button
        onClick={onClick}
        className={`inline-flex items-center gap-1 ${active ? 'text-ink' : 'text-ink-muted hover:text-ink'}`}
      >
        {children}
        {active ? (
          dir === 'asc' ? <ChevronUpIcon size={11} /> : <ChevronDownIcon size={11} />
        ) : (
          <ChevronDownIcon size={11} className="opacity-30" />
        )}
      </button>
    </th>
  );
}

function VatStatusBadge({ status }: { status: Entity['vat_status'] }) {
  if (status === 'pending_registration') return <Badge tone="warning">Pending</Badge>;
  if (status === 'not_applicable')       return <Badge tone="neutral">N/A</Badge>;
  return <Badge tone="success">Registered</Badge>;
}

function FilterChip({
  label, active, onClick, urgent,
}: { label: string; active: boolean; onClick: () => void; urgent?: boolean }) {
  const cls = active
    ? 'bg-brand-500 text-white shadow-xs'
    : urgent
      ? 'bg-brand-50 text-brand-700 border border-brand-200 hover:bg-brand-100'
      : 'bg-surface text-ink-soft border border-border hover:bg-surface-alt';
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[12.5px] font-medium transition-all ${cls}`}
    >
      {label}
    </button>
  );
}
