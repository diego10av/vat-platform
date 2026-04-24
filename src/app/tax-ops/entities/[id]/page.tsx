'use client';

// /tax-ops/entities/[id] — entity detail with identity, CSP defaults,
// obligations, and a multi-year filings matrix.

import { useEffect, useState, useCallback, use } from 'react';
import Link from 'next/link';
import { ArrowLeftIcon } from 'lucide-react';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { CrmErrorBox } from '@/components/crm/CrmErrorBox';
import { DateBadge } from '@/components/crm/DateBadge';
import { useToast } from '@/components/Toaster';
import { FilingStatusBadge } from '@/components/tax-ops/FilingStatusBadge';
import { CspContactsEditor, type CspContact } from '@/components/tax-ops/CspContactsEditor';

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

  async function save(patch: Record<string, unknown>, msg: string) {
    try {
      const res = await fetch(`/api/tax-ops/entities/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success(msg);
      await load();
    } catch (e) {
      toast.error(`Save failed: ${String(e instanceof Error ? e.message : e)}`);
    }
  }

  if (error) return <CrmErrorBox message={error} onRetry={load} />;
  if (!data) return <PageSkeleton />;

  // Group filings by year for the history grid
  const byYear = new Map<number, Filing[]>();
  for (const f of data.filings) {
    if (!byYear.has(f.period_year)) byYear.set(f.period_year, []);
    byYear.get(f.period_year)!.push(f);
  }
  const years = Array.from(byYear.keys()).sort((a, b) => b - a);

  return (
    <div className="space-y-4 max-w-5xl">
      <Link href="/tax-ops/entities" className="inline-flex items-center gap-1 text-[12px] text-ink-muted hover:text-ink">
        <ArrowLeftIcon size={12} /> Back to entities
      </Link>

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
        <div className="text-[12px] text-ink-muted mt-0.5">
          {data.entity.group_name && <span className="mr-2">{data.entity.group_name}</span>}
          {data.entity.is_active ? (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10.5px] bg-green-100 text-green-800">Active</span>
          ) : (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10.5px] bg-surface-alt text-ink-muted">Inactive</span>
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

      {/* Filings history */}
      <div className="rounded-md border border-border bg-surface px-4 py-3">
        <h3 className="text-[13px] font-semibold text-ink mb-2">
          Filings history <span className="text-[11.5px] font-normal text-ink-muted">({data.filings.length})</span>
        </h3>
        {years.length === 0 ? (
          <div className="text-[12px] text-ink-muted italic">No filings for this entity yet.</div>
        ) : (
          <div className="space-y-3">
            {years.map(y => (
              <div key={y}>
                <div className="text-[12px] font-semibold text-ink mb-1">{y}</div>
                <table className="w-full text-[12px]">
                  <thead className="text-ink-muted">
                    <tr className="text-left">
                      <th className="py-0.5 font-medium">Tax type</th>
                      <th className="py-0.5 font-medium">Period</th>
                      <th className="py-0.5 font-medium">Deadline</th>
                      <th className="py-0.5 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byYear.get(y)!.map(f => (
                      <tr key={f.id} className="border-t border-border/50 hover:bg-surface-alt/40">
                        <td className="py-1">
                          <Link href={`/tax-ops/filings/${f.id}`} className="text-ink hover:text-brand-700">
                            {humanTaxType(f.tax_type)}
                          </Link>
                        </td>
                        <td className="py-1 tabular-nums text-ink-soft">{f.period_label}</td>
                        <td className="py-1"><DateBadge value={f.deadline_date} mode="urgency" /></td>
                        <td className="py-1"><FilingStatusBadge status={f.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
