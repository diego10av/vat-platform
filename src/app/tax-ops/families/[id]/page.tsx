'use client';

// /tax-ops/families/[id] — Family overview (stint 40.P).
//
// Diego: "estaría bien tener una overview de la familia. Pinchas la
// familia Peninsula y te salen todas las entidades de la familia.
// Cuando incluyes un contacto, fácil copiar y pegar porque Peninsula
// son 30 entidades y para 10 o 15 los contactos son los mismos."
//
// Features:
//   - Header with family name (editable) + stats
//   - Entities table: checkbox select + name + tax types + contacts
//   - Bulk-copy flow: pick one entity as source → check targets →
//     Apply → POSTs to /api/tax-ops/entities/bulk-set-contacts

import { useEffect, useState, useCallback, use } from 'react';
import Link from 'next/link';
import { ArrowLeftIcon, UsersIcon, CopyIcon, XIcon } from 'lucide-react';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { CrmErrorBox } from '@/components/crm/CrmErrorBox';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/Toaster';
import { familyChipClasses } from '@/components/tax-ops/familyColors';

interface Entity {
  id: string;
  legal_name: string;
  vat_number: string | null;
  matricule: string | null;
  is_active: boolean;
  liquidation_date: string | null;
  csp_contacts: Array<{ name: string; email?: string; role?: string }>;
  obligations_count: number;
  tax_types: string[];
  filings_total: number;
  filings_filed: number;
  latest_activity: string | null;
}

interface FamilyDetail {
  family: {
    id: string;
    name: string;
    is_active: boolean;
    notes: string | null;
    created_at: string;
    updated_at: string;
  };
  entities: Entity[];
  stats: {
    entities_count: number;
    active_entities: number;
    obligations_count: number;
    filings_total: number;
    filings_filed: number;
    filed_pct: number;
  };
}

function humanTaxType(t: string): string {
  return t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export default function FamilyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<FamilyDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copySourceId, setCopySourceId] = useState<string | null>(null);
  const [selectedTargets, setSelectedTargets] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/tax-ops/families/${id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as FamilyDetail;
      setData(body);
      setError(null);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  async function renameFamily(newName: string) {
    if (!data || !newName.trim() || newName === data.family.name) return;
    const res = await fetch(`/api/tax-ops/client-groups/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() }),
    });
    if (res.ok) {
      toast.success('Family renamed');
      void load();
    } else {
      const b = await res.json().catch(() => ({}));
      toast.error(`Rename failed: ${b?.error ?? res.status}`);
    }
  }

  function toggleTarget(entityId: string) {
    setSelectedTargets(prev => {
      const next = new Set(prev);
      if (next.has(entityId)) next.delete(entityId);
      else next.add(entityId);
      return next;
    });
  }

  async function applyBulkCopy() {
    if (!data || !copySourceId || selectedTargets.size === 0 || applying) return;
    const source = data.entities.find(e => e.id === copySourceId);
    if (!source) return;
    const targets = Array.from(selectedTargets);
    if (!confirm(
      `Copy ${source.csp_contacts.length} contact${source.csp_contacts.length === 1 ? '' : 's'} from ` +
      `"${source.legal_name}" to ${targets.length} selected ${targets.length === 1 ? 'entity' : 'entities'}?\n\n` +
      'Existing contacts on those entities will be REPLACED (not merged).',
    )) return;
    setApplying(true);
    try {
      const res = await fetch('/api/tax-ops/entities/bulk-set-contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_entity_id: source.id,
          contact_set: source.csp_contacts,
          entity_ids: targets,
        }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b?.error ?? `HTTP ${res.status}`);
      }
      toast.success(
        `Contacts propagated · ${targets.length} ${targets.length === 1 ? 'entity' : 'entities'} updated`,
      );
      setCopySourceId(null);
      setSelectedTargets(new Set());
      await load();
    } catch (e) {
      toast.error(`Copy failed: ${String(e instanceof Error ? e.message : e)}`);
    } finally {
      setApplying(false);
    }
  }

  if (error) return <CrmErrorBox message={error} onRetry={load} />;
  if (!data) return <PageSkeleton />;

  const { family, entities, stats } = data;
  const source = copySourceId ? entities.find(e => e.id === copySourceId) ?? null : null;

  return (
    <div className="space-y-4">
      <Link href="/tax-ops/entities" className="inline-flex items-center gap-1 text-[12px] text-ink-muted hover:text-ink">
        <ArrowLeftIcon size={12} /> Back to entities
      </Link>

      {/* Header */}
      <div className="rounded-md border border-border bg-surface px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className={[
              'inline-flex items-center px-2 py-0.5 rounded text-[12px] font-medium',
              familyChipClasses(family.name),
            ].join(' ')}
          >
            {family.name}
          </span>
          <input
            key={family.name}
            defaultValue={family.name}
            onBlur={(e) => void renameFamily(e.target.value)}
            className="flex-1 text-[15px] font-semibold text-ink bg-transparent border-0 focus:bg-surface-alt/60 px-1 rounded"
          />
        </div>
        <div className="mt-2 grid grid-cols-2 sm:grid-cols-5 gap-3 text-[12px]">
          <div>
            <div className="text-ink-muted">Entities</div>
            <div className="font-mono tabular-nums text-ink">
              {stats.active_entities}<span className="text-ink-muted"> / {stats.entities_count}</span>
            </div>
          </div>
          <div>
            <div className="text-ink-muted">Active obligations</div>
            <div className="font-mono tabular-nums text-ink">{stats.obligations_count}</div>
          </div>
          <div>
            <div className="text-ink-muted">Filings</div>
            <div className="font-mono tabular-nums text-ink">{stats.filings_total}</div>
          </div>
          <div>
            <div className="text-ink-muted">Filed</div>
            <div className="font-mono tabular-nums text-ink">{stats.filings_filed}</div>
          </div>
          <div>
            <div className="text-ink-muted">% filed</div>
            <div className="font-mono tabular-nums text-ink">{stats.filed_pct}%</div>
          </div>
        </div>
      </div>

      {/* Bulk-copy toolbar (sticky when a source is picked) */}
      {source && (
        <div className="sticky top-0 z-10 rounded-md border border-brand-300 bg-brand-50 px-4 py-2 flex items-center gap-3 flex-wrap">
          <CopyIcon size={14} className="text-brand-700" />
          <div className="text-[12.5px] text-ink">
            Copy {source.csp_contacts.length} contact{source.csp_contacts.length === 1 ? '' : 's'} from <strong>{source.legal_name}</strong> to:
          </div>
          <div className="text-[12px] text-ink-muted">
            {selectedTargets.size} {selectedTargets.size === 1 ? 'entity' : 'entities'} selected
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setCopySourceId(null);
                setSelectedTargets(new Set());
              }}
              className="inline-flex items-center gap-1 px-2 py-1 text-[11.5px] rounded border border-border hover:bg-surface"
            >
              <XIcon size={11} /> Cancel
            </button>
            <button
              type="button"
              onClick={() => void applyBulkCopy()}
              disabled={selectedTargets.size === 0 || applying}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-[12px] rounded-md bg-brand-500 hover:bg-brand-600 text-white disabled:opacity-50"
            >
              {applying ? 'Applying…' : 'Apply'}
            </button>
          </div>
        </div>
      )}

      {/* Entities table */}
      {entities.length === 0 ? (
        <EmptyState
          title="No entities in this family"
          description="Assign entities from any /tax-ops matrix page's family dropdown."
        />
      ) : (
        <div className="rounded-md border border-border bg-surface overflow-hidden">
          <table className="w-full text-[12.5px]">
            <thead className="bg-surface-alt text-ink-muted">
              <tr className="text-left">
                <th className="px-2 py-1.5 font-medium w-[28px]"></th>
                <th className="px-3 py-1.5 font-medium">Entity</th>
                <th className="px-3 py-1.5 font-medium">Active tax types</th>
                <th className="px-3 py-1.5 font-medium">Contacts</th>
                <th className="px-3 py-1.5 font-medium text-right">Filings</th>
                <th className="px-3 py-1.5 font-medium">Last activity</th>
                <th className="px-3 py-1.5 font-medium w-[110px]"></th>
              </tr>
            </thead>
            <tbody>
              {entities.map(e => {
                const isSource = copySourceId === e.id;
                const canBeTarget = !!copySourceId && copySourceId !== e.id;
                return (
                  <tr
                    key={e.id}
                    className={[
                      'border-t border-border/70',
                      isSource ? 'bg-brand-50/70' : '',
                      !e.is_active ? 'opacity-60' : '',
                    ].join(' ')}
                  >
                    <td className="px-2 py-1.5 text-center">
                      {canBeTarget && (
                        <input
                          type="checkbox"
                          checked={selectedTargets.has(e.id)}
                          onChange={() => toggleTarget(e.id)}
                          aria-label={`Select ${e.legal_name} as copy target`}
                        />
                      )}
                      {isSource && (
                        <span className="inline-flex items-center px-1 py-0 rounded bg-brand-100 text-brand-700 text-[9px] font-medium">
                          source
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      <Link
                        href={`/tax-ops/entities/${e.id}`}
                        className="font-medium text-ink hover:text-brand-700"
                      >
                        {e.legal_name}
                      </Link>
                      {!e.is_active && (
                        <span className="ml-2 inline-flex items-center px-1 py-0 rounded-full text-[9.5px] bg-surface-alt text-ink-muted">
                          {e.liquidation_date ? `Liquidated ${e.liquidation_date}` : 'Inactive'}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex flex-wrap gap-1">
                        {e.tax_types.length === 0 ? (
                          <span className="text-ink-muted italic">—</span>
                        ) : (
                          e.tax_types.slice(0, 4).map(t => (
                            <span
                              key={t}
                              className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] bg-surface-alt text-ink-soft"
                              title={humanTaxType(t)}
                            >
                              {humanTaxType(t).replace(/^(CIT|VAT|WHT|BCL|Subscription|NWT) /, '$1·')}
                            </span>
                          ))
                        )}
                        {e.tax_types.length > 4 && (
                          <span className="text-[10.5px] text-ink-muted">+{e.tax_types.length - 4}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex flex-wrap gap-1 items-center">
                        {e.csp_contacts.length === 0 ? (
                          <span className="text-ink-muted italic text-[11px]">none</span>
                        ) : (
                          e.csp_contacts.slice(0, 3).map((c, i) => (
                            <span
                              key={i}
                              className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10.5px] bg-brand-50 text-brand-700"
                              title={`${c.name}${c.email ? ` (${c.email})` : ''}${c.role ? ` · ${c.role}` : ''}`}
                            >
                              {c.name}
                            </span>
                          ))
                        )}
                        {e.csp_contacts.length > 3 && (
                          <span className="text-[10.5px] text-ink-muted">+{e.csp_contacts.length - 3}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {e.filings_filed}<span className="text-ink-muted"> / {e.filings_total}</span>
                    </td>
                    <td className="px-3 py-1.5 text-ink-muted tabular-nums">
                      {e.latest_activity ? e.latest_activity.slice(0, 10) : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {!copySourceId && e.csp_contacts.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setCopySourceId(e.id);
                            setSelectedTargets(new Set());
                          }}
                          className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded border border-border hover:border-brand-500 hover:text-brand-700"
                          title={`Use this entity's ${e.csp_contacts.length} contacts as the source for a bulk copy`}
                        >
                          <UsersIcon size={11} /> Use contacts
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="rounded-md border border-border bg-surface-alt/40 px-4 py-2 text-[11.5px] text-ink-muted">
        Tip: click &quot;Use contacts&quot; on the entity whose contact list is most complete,
        then tick the entities that share the same contacts, and Apply. It replaces the
        target entities&apos; csp_contacts in one atomic update (audit-logged).
      </div>
    </div>
  );
}
