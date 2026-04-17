'use client';

// ════════════════════════════════════════════════════════════════════════
// /entities — flat cross-client list of every Luxembourg entity.
//
// 2026-04-18 rewrite (per Diego's feedback + PROTOCOLS §11):
// - Removed the four decorative KPI cards (Entities / Unique clients /
//   Simplified regime / Ordinary regime). None of them answered the
//   "if this changes, do I do something different?" test. Kept only
//   the pending-registration filter, which IS actionable.
// - Removed the inline create form. "New entity" now routes to
//   /entities/new, which demands a client first (the app's new source
//   of truth — entities can't exist without a client).
// - Added a Client column (links to /clients/[id]).
//
// This page stays useful as a flat search / audit view — "find me
// every entity in ordinary regime, quarterly, status pending" — which
// you can't easily do from the hierarchical /clients page.
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PlusIcon, Trash2Icon, ArrowRightIcon, BuildingIcon, SearchIcon } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { Card } from '@/components/ui/Card';

interface Entity {
  id: string;
  name: string;
  client_id: string | null;
  client_name: string | null; // legacy inline column (still populated pre-005)
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

type VatFilter = 'all' | 'registered' | 'pending';

export default function EntitiesPage() {
  const router = useRouter();
  const [entities, setEntities] = useState<Entity[] | null>(null);
  const [clients, setClients] = useState<Map<string, ClientRow>>(new Map());
  const [vatFilter, setVatFilter] = useState<VatFilter>('all');
  const [q, setQ] = useState('');

  useEffect(() => { void load(); }, []);

  async function load() {
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
  }

  async function handleDelete(entity: Entity) {
    if (!confirm(`Delete "${entity.name}"? This hides it from the list but keeps the data for audit.`)) return;
    await fetch(`/api/entities/${entity.id}`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'user_deleted' }),
    });
    await load();
  }

  if (!entities) return <PageSkeleton />;

  const pendingCount = entities.filter(e => e.vat_status === 'pending_registration').length;
  const registeredCount = entities.filter(e => e.vat_status !== 'pending_registration').length;

  const filtered = entities.filter(e => {
    if (vatFilter === 'registered' && e.vat_status === 'pending_registration') return false;
    if (vatFilter === 'pending' && e.vat_status !== 'pending_registration') return false;
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      const clientName = e.client_id ? clients.get(e.client_id)?.name : e.client_name;
      const blob = [e.name, clientName, e.vat_number, e.matricule].filter(Boolean).join(' ').toLowerCase();
      if (!blob.includes(needle)) return false;
    }
    return true;
  });

  return (
    <div>
      <PageHeader
        title="All entities"
        subtitle="Cross-client list of every Luxembourg entity. Use this when you need to search across clients — otherwise work from Clients → drill in."
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
            icon={<BuildingIcon size={22} />}
            title="No entities yet"
            description="Start by creating a client. Entities hang off clients — you can't create an entity without one."
            action={
              <div className="flex gap-2 justify-center">
                <Link
                  href="/clients/new"
                  className="h-9 px-4 rounded-md bg-brand-500 text-white text-[12.5px] font-semibold hover:bg-brand-600 inline-flex items-center gap-1.5"
                >
                  <PlusIcon size={13} /> Create first client
                </Link>
              </div>
            }
          />
        </Card>
      )}

      {/* Filter + search bar — only when there's data */}
      {entities.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="relative flex-1 min-w-[220px] max-w-xs">
            <SearchIcon size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, client, VAT, matricule"
              className="w-full h-8 pl-8 pr-3 text-[12.5px] border border-border-strong rounded-md bg-surface focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <FilterChip active={vatFilter === 'all'}        onClick={() => setVatFilter('all')}        label={`All (${entities.length})`} />
          <FilterChip active={vatFilter === 'registered'} onClick={() => setVatFilter('registered')} label={`Registered (${registeredCount})`} />
          <FilterChip
            active={vatFilter === 'pending'}
            onClick={() => setVatFilter('pending')}
            label={`Pending registration (${pendingCount})`}
            urgent={pendingCount > 0}
          />
        </div>
      )}

      {/* Empty filter results */}
      {entities.length > 0 && filtered.length === 0 && (
        <Card>
          <EmptyState
            icon={<BuildingIcon size={22} />}
            title={q ? 'No matches' : (vatFilter === 'pending' ? 'No pending registrations' : 'No matches')}
            description={
              vatFilter === 'pending' && !q
                ? 'All entities are already VAT-registered.'
                : 'Adjust the search or switch filter to see more.'
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
                <Th>Client</Th>
                <Th>Entity</Th>
                <Th>VAT status</Th>
                <Th>Regime</Th>
                <Th>Frequency</Th>
                <Th>VAT number</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {filtered.map(entity => {
                const client = entity.client_id ? clients.get(entity.client_id) : null;
                return (
                  <tr key={entity.id} className="border-b border-divider last:border-0 hover:bg-surface-alt/60 transition-colors duration-150">
                    <td className="px-4 py-3">
                      {client ? (
                        <Link
                          href={`/clients/${client.id}`}
                          className="text-ink-soft hover:text-brand-600 hover:underline transition-colors"
                        >
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
        </Card>
      )}
    </div>
  );
}

// ───────────────────────────── subcomponents ─────────────────────────────

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="px-4 py-2.5 text-left font-medium text-[10.5px] uppercase tracking-[0.06em]">{children}</th>;
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
