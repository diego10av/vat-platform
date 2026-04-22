'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { SearchIcon, PlusIcon } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { CrmFormModal } from '@/components/crm/CrmFormModal';
import { BulkActionBar } from '@/components/crm/BulkActionBar';
import { OPPORTUNITY_FIELDS } from '@/components/crm/schemas';
import { useToast } from '@/components/Toaster';
import {
  LABELS_STAGE, OPPORTUNITY_STAGES, formatEur, formatDate,
  type OpportunityStage,
} from '@/lib/crm-types';

interface Opportunity {
  id: string;
  name: string;
  stage: string;
  practice_areas: string[];
  estimated_value_eur: number | null;
  probability_pct: number | null;
  weighted_value_eur: number | null;
  first_contact_date: string | null;
  estimated_close_date: string | null;
  next_action: string | null;
  next_action_due: string | null;
  company_name: string | null;
  company_id: string | null;
  primary_contact_name: string | null;
}

export default function OpportunitiesPage() {
  const [rows, setRows] = useState<Opportunity[] | null>(null);
  const [q, setQ] = useState('');
  const [stage, setStage] = useState<string>('');
  const [newOpen, setNewOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toast = useToast();

  const toggleOne = (id: string) => setSelected(prev => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const toggleAll = (on: boolean) => setSelected(on ? new Set((rows ?? []).map(r => r.id)) : new Set());
  const clearSelection = () => setSelected(new Set());

  const load = useCallback(() => {
    const qs = new URLSearchParams();
    if (q) qs.set('q', q);
    if (stage) qs.set('stage', stage);
    fetch(`/api/crm/opportunities?${qs}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(setRows)
      .catch(() => setRows([]));
  }, [q, stage]);

  useEffect(() => { load(); }, [load]);

  async function handleCreate(values: Record<string, unknown>) {
    const res = await fetch('/api/crm/opportunities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message ?? `Create failed (${res.status})`);
    }
    toast.success('Opportunity created');
    await load();
  }

  const openRows = rows?.filter(r => r.stage !== 'won' && r.stage !== 'lost') ?? [];
  const totalPipeline = openRows.reduce((sum, r) => sum + (Number(r.weighted_value_eur) || 0), 0);

  if (rows === null) return <PageSkeleton />;

  return (
    <div>
      <PageHeader
        title="Opportunities"
        subtitle={`Sales pipeline · ${formatEur(totalPipeline)} weighted pipeline across ${openRows.length} open`}
        actions={
          <Button onClick={() => setNewOpen(true)} variant="primary" size="sm" icon={<PlusIcon size={13} />}>
            New opportunity
          </Button>
        }
      />
      <CrmFormModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        mode="create"
        title="New opportunity"
        subtitle="Pipeline entry — will move through stages from Lead Identified to Won/Lost."
        fields={OPPORTUNITY_FIELDS}
        initial={{ stage: 'lead_identified', probability_pct: 20 }}
        onSave={handleCreate}
      />
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[220px] max-w-xs">
          <SearchIcon size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-muted" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search opportunity name..."
            className="w-full pl-7 pr-3 py-1.5 text-[12.5px] border border-border rounded-md focus:outline-none focus:border-brand-500" />
        </div>
        <select value={stage} onChange={e => setStage(e.target.value)}
          className="px-2 py-1.5 text-[12.5px] border border-border rounded-md bg-white">
          <option value="">All stages</option>
          {OPPORTUNITY_STAGES.map(s => <option key={s} value={s}>{LABELS_STAGE[s]}</option>)}
        </select>
        <span className="ml-auto text-[11.5px] text-ink-muted">{rows.length} opportunities</span>
      </div>

      {rows.length === 0 ? (
        <EmptyState illustration="reports" title="No opportunities yet" description="Run the Notion import or create one from a company detail page." />
      ) : (
        <div className="border border-border rounded-lg overflow-hidden bg-white">
          <table className="w-full text-[12.5px]">
            <thead className="bg-surface-alt text-ink-muted">
              <tr>
                <th className="px-3 py-2 w-8">
                  <input
                    type="checkbox"
                    checked={selected.size > 0 && selected.size === rows.length}
                    ref={el => { if (el) el.indeterminate = selected.size > 0 && selected.size < rows.length; }}
                    onChange={e => toggleAll(e.target.checked)}
                    className="h-4 w-4 accent-brand-500 cursor-pointer"
                  />
                </th>
                <th className="text-left px-3 py-2 font-medium">Name</th>
                <th className="text-left px-3 py-2 font-medium">Company</th>
                <th className="text-left px-3 py-2 font-medium">Stage</th>
                <th className="text-right px-3 py-2 font-medium">Value</th>
                <th className="text-right px-3 py-2 font-medium">Prob.</th>
                <th className="text-right px-3 py-2 font-medium">Weighted</th>
                <th className="text-left px-3 py-2 font-medium">Est. close</th>
                <th className="text-left px-3 py-2 font-medium">Next action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className={`border-t border-border hover:bg-surface-alt/50 ${selected.has(r.id) ? 'bg-brand-50/40' : ''}`}>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={() => toggleOne(r.id)}
                      className="h-4 w-4 accent-brand-500 cursor-pointer"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Link href={`/crm/opportunities/${r.id}`} className="font-medium text-brand-700 hover:underline">{r.name}</Link>
                  </td>
                  <td className="px-3 py-2">
                    {r.company_id ? <Link href={`/crm/companies/${r.company_id}`} className="text-ink-muted hover:underline">{r.company_name}</Link> : <span className="text-ink-muted">—</span>}
                  </td>
                  <td className="px-3 py-2">{LABELS_STAGE[r.stage as OpportunityStage] ?? r.stage}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatEur(r.estimated_value_eur)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.probability_pct !== null ? `${r.probability_pct}%` : '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">{formatEur(r.weighted_value_eur)}</td>
                  <td className="px-3 py-2 text-ink-muted">{formatDate(r.estimated_close_date)}</td>
                  <td className="px-3 py-2 text-ink-muted truncate max-w-[200px]">
                    {r.next_action ? (
                      <span title={r.next_action}>
                        {r.next_action}
                        {r.next_action_due && <span className="ml-1 text-[10px]">({formatDate(r.next_action_due)})</span>}
                      </span>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <BulkActionBar
        targetType="crm_opportunity"
        selectedIds={Array.from(selected)}
        onClear={clearSelection}
        onDone={() => { clearSelection(); load(); }}
      />
    </div>
  );
}
