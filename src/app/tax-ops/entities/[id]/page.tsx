'use client';

// /tax-ops/entities/[id] — entity detail with identity, CSP defaults,
// obligations, and a multi-year filings matrix.

import { useEffect, useState, useCallback, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeftIcon } from 'lucide-react';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { CrmErrorBox } from '@/components/crm/CrmErrorBox';
import { useToast } from '@/components/Toaster';
import { CspContactsEditor, type CspContact } from '@/components/tax-ops/CspContactsEditor';
import { EntityFilingsMatrix } from '@/components/tax-ops/EntityFilingsMatrix';
import { EntityTaxStatusPills } from '@/components/tax-ops/EntityTaxStatusPills';
import { EntityTimeline } from '@/components/tax-ops/EntityTimeline';

interface EntityDetail {
  id: string;
  legal_name: string;
  vat_number: string | null;
  matricule: string | null;
  rcs_number: string | null;
  is_active: boolean;
  liquidation_date: string | null;
  group_id: string | null;
  group_name: string | null;
  csp_contacts: CspContact[];
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface Obligation {
  id: string;
  tax_type: string;
  period_pattern: string;
  is_active: boolean;
  default_assignee: string | null;
  notes: string | null;
}

interface Filing {
  id: string;
  tax_type: string;
  period_year: number;
  period_label: string;
  deadline_date: string | null;
  status: string;
  assigned_to: string | null;
  filed_at: string | null;
  tax_assessment_received_at: string | null;
}

interface Response {
  entity: EntityDetail;
  obligations: Obligation[];
  filings: Filing[];
}

function humanTaxType(t: string): string {
  return t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export default function EntityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [data, setData] = useState<Response | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editName, setEditName] = useState<string>('');
  const [cspContacts, setCspContacts] = useState<CspContact[]>([]);
  const [notes, setNotes] = useState<string>('');
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/tax-ops/entities/${id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as Response;
      setData(body);
      setEditName(body.entity.legal_name);
      setCspContacts(body.entity.csp_contacts ?? []);
      setNotes(body.entity.notes ?? '');
      setError(null);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function save(
    patch: Record<string, unknown>,
    msg: string,
    undoAction?: { label: string; onClick: () => void | Promise<void> },
  ) {
    try {
      const res = await fetch(`/api/tax-ops/entities/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (undoAction) {
        toast.withAction('success', msg, undefined, undoAction);
      } else {
        toast.success(msg);
      }
      await load();
    } catch (e) {
      toast.error(`Save failed: ${String(e instanceof Error ? e.message : e)}`);
    }
  }

  if (error) return <CrmErrorBox message={error} onRetry={load} />;
  if (!data) return <PageSkeleton />;

  // Compute the year range for the matrix header: span from the oldest
  // filing year (min) to the current work year (max of present + CURRENT).
  // If the entity has no filings, fall back to the trailing 4 years.
  const years = (() => {
    if (data.filings.length === 0) {
      const y = new Date().getFullYear();
      return [y - 3, y - 2, y - 1, y];
    }
    const present = data.filings.map(f => f.period_year);
    const min = Math.min(...present);
    const max = Math.max(...present, new Date().getFullYear());
    const out: number[] = [];
    for (let y = min; y <= max; y += 1) out.push(y);
    return out;
  })();

  return (
    <div className="space-y-4 max-w-5xl">
      {/* Stint 40.H — back button uses router.back() so Diego returns
          to the page he came from (VAT quarterly, CIT, Tasks, etc.),
          not always /tax-ops/entities. Fallback link if there's no
          history (direct URL open). */}
      <button
        type="button"
        onClick={() => {
          if (window.history.length > 1) router.back();
          else router.push('/tax-ops/entities');
        }}
        className="inline-flex items-center gap-1 text-[12px] text-ink-muted hover:text-ink"
      >
        <ArrowLeftIcon size={12} /> Back
      </button>

      {/* Identity header */}
      <div className="rounded-md border border-border bg-surface px-4 py-3">
        <input
          value={editName}
          onChange={e => setEditName(e.target.value)}
          onBlur={() => {
            if (editName.trim() && editName !== data.entity.legal_name) {
              save({ legal_name: editName.trim() }, 'Legal name saved');
            }
          }}
          className="w-full text-[15px] font-semibold text-ink bg-transparent border-0 p-0 focus:ring-0 focus:outline-none focus:bg-surface-alt/60 px-1 rounded"
        />
        <div className="text-[12px] text-ink-muted mt-0.5 flex items-center gap-2 flex-wrap">
          {data.entity.group_name && data.entity.group_id && (
            <Link
              href={`/tax-ops/families/${data.entity.group_id}`}
              className="hover:text-brand-700 hover:underline"
              title={`Open ${data.entity.group_name} family overview`}
            >
              {data.entity.group_name}
            </Link>
          )}
          {data.entity.group_name && !data.entity.group_id && <span>{data.entity.group_name}</span>}
          {data.entity.is_active ? (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10.5px] bg-green-100 text-green-800">Active</span>
          ) : (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10.5px] bg-surface-alt text-ink-muted">
              Inactive{data.entity.liquidation_date ? ` · liquidated ${data.entity.liquidation_date}` : ''}
            </span>
          )}
          {/* Lifecycle actions (stint 39.C) — archive or reactivate.
              Archived entities are skipped by year-rollover + hidden by
              default from matrix pages. */}
          {/* Stint 40.H — archive emits a toast with Undo. Reactivating
              a just-archived entity via the toast reverses both
              is_active and liquidation_date atomically. */}
          {data.entity.is_active ? (
            <>
              <button
                type="button"
                onClick={async () => {
                  const date = window.prompt(
                    'Liquidation / de-registration date (YYYY-MM-DD, leave empty to just mark inactive):',
                    new Date().toISOString().slice(0, 10),
                  );
                  if (date === null) return;
                  const priorActive = data.entity.is_active;
                  const priorLiq = data.entity.liquidation_date;
                  await save(
                    { is_active: false, liquidation_date: date || null },
                    'Entity archived',
                    {
                      label: 'Undo',
                      onClick: () => save(
                        { is_active: priorActive, liquidation_date: priorLiq },
                        'Archive undone',
                      ),
                    },
                  );
                }}
                className="ml-2 text-[10.5px] text-ink-muted hover:text-danger-600 underline"
              >
                Archive (liquidated / VAT deregistered)
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={async () => {
                const priorActive = data.entity.is_active;
                const priorLiq = data.entity.liquidation_date;
                await save(
                  { is_active: true, liquidation_date: null },
                  'Entity reactivated',
                  {
                    label: 'Undo',
                    onClick: () => save(
                      { is_active: priorActive, liquidation_date: priorLiq },
                      'Reactivate undone',
                    ),
                  },
                );
              }}
              className="ml-2 text-[10.5px] text-ink-muted hover:text-brand-700 underline"
            >
              Reactivate
            </button>
          )}
        </div>
        <div className="grid grid-cols-3 gap-3 mt-3 text-[12px]">
          <div>
            <div className="text-ink-muted">VAT number</div>
            <div className="font-mono">{data.entity.vat_number ?? '—'}</div>
          </div>
          <div>
            <div className="text-ink-muted">Matricule</div>
            <div className="font-mono">{data.entity.matricule ?? '—'}</div>
          </div>
          <div>
            <div className="text-ink-muted">RCS</div>
            <div className="font-mono">{data.entity.rcs_number ?? '—'}</div>
          </div>
        </div>
      </div>

      {/* Tax status summary (stint 37.I) */}
      <div className="rounded-md border border-border bg-surface px-4 py-3">
        <h3 className="text-[13px] font-semibold text-ink mb-2">Tax status summary</h3>
        <p className="text-[11.5px] text-ink-muted mb-2">
          Latest filing status per tax type. Click any chip to open that filing.
        </p>
        <EntityTaxStatusPills filings={data.filings} />
      </div>

      {/* CSP defaults */}
      <div className="rounded-md border border-border bg-surface px-4 py-3">
        <h3 className="text-[13px] font-semibold text-ink mb-2">CSP contacts (defaults)</h3>
        <p className="text-[11.5px] text-ink-muted mb-2">
          Default Corporate Service Provider contacts to chase for this entity&apos;s
          filings. Each filing can override with its own contacts.
        </p>
        <CspContactsEditor
          value={cspContacts}
          onChange={setCspContacts}
          fallbackLabel="No CSP contacts set for this entity"
        />
        <div className="mt-2">
          <button
            onClick={() => save({ csp_contacts: cspContacts }, 'CSP contacts saved')}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-[12px] rounded-md border border-border hover:bg-surface-alt"
          >
            Save contacts
          </button>
        </div>
      </div>

      {/* Notes */}
      <div className="rounded-md border border-border bg-surface px-4 py-3">
        <h3 className="text-[13px] font-semibold text-ink mb-2">Notes</h3>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          onBlur={() => {
            if (notes !== (data.entity.notes ?? '')) {
              save({ notes }, 'Notes saved');
            }
          }}
          rows={4}
          placeholder="Internal notes about this entity."
          className="w-full px-2 py-1.5 text-[12.5px] border border-border rounded-md bg-surface font-mono"
        />
      </div>

      {/* Obligations */}
      <div className="rounded-md border border-border bg-surface px-4 py-3">
        <h3 className="text-[13px] font-semibold text-ink mb-2">
          Obligations <span className="text-[11.5px] font-normal text-ink-muted">({data.obligations.length})</span>
        </h3>
        {data.obligations.length === 0 ? (
          <div className="text-[12px] text-ink-muted italic">No obligations recorded.</div>
        ) : (
          <table className="w-full text-[12.5px]">
            <thead className="text-ink-muted">
              <tr className="text-left">
                <th className="py-1 font-medium">Tax type</th>
                <th className="py-1 font-medium">Period pattern</th>
                <th className="py-1 font-medium">Default assignee</th>
                <th className="py-1 font-medium">Active</th>
              </tr>
            </thead>
            <tbody>
              {data.obligations.map(o => (
                <tr key={o.id} className="border-t border-border">
                  <td className="py-1.5">{humanTaxType(o.tax_type)}</td>
                  <td className="py-1.5 capitalize">{o.period_pattern}</td>
                  <td className="py-1.5 text-ink-soft">{o.default_assignee ?? '—'}</td>
                  <td className="py-1.5">{o.is_active ? '✓' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Filings history — compact matrix (tax_type × years × periods) */}
      <div className="rounded-md border border-border bg-surface px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[13px] font-semibold text-ink">
            Filings history <span className="text-[11.5px] font-normal text-ink-muted">({data.filings.length})</span>
          </h3>
          <span className="text-[11px] text-ink-muted">Click a status badge to open that filing.</span>
        </div>
        <EntityFilingsMatrix filings={data.filings} years={years} />
      </div>

      {/* Activity timeline (stint 42.A) — chronological audit-log view */}
      <div className="rounded-md border border-border bg-surface px-4 py-3">
        <h3 className="text-[13px] font-semibold text-ink mb-2">
          Activity
        </h3>
        <p className="text-[11.5px] text-ink-muted mb-3">
          Status changes, family moves, contact edits, merges, archives — everything
          that happened to this entity, newest first.
        </p>
        <EntityTimeline entityId={id} />
      </div>
    </div>
  );
}
