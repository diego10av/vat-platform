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
import { ExportButton } from '@/components/crm/ExportButton';
import { MATTER_FIELDS } from '@/components/crm/schemas';
import { useToast } from '@/components/Toaster';
import {
  LABELS_MATTER_STATUS, MATTER_STATUSES, formatEur, formatDate,
  type MatterStatus,
} from '@/lib/crm-types';

interface Matter {
  id: string;
  matter_reference: string;
  title: string;
  status: string;
  practice_areas: string[];
  fee_type: string | null;
  hourly_rate_eur: number | null;
  opening_date: string | null;
  closing_date: string | null;
  conflict_check_done: boolean;
  client_name: string | null;
  client_id: string | null;
  total_billed: number | string;
  total_hours: number | string;
}

export default function MattersPage() {
  const [rows, setRows] = useState<Matter[] | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<string>('');
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
    if (status) qs.set('status', status);
    fetch(`/api/crm/matters?${qs}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(setRows)
      .catch(() => setRows([]));
  }, [q, status]);

  useEffect(() => { load(); }, [load]);

  async function handleCreate(values: Record<string, unknown>) {
    const res = await fetch('/api/crm/matters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message ?? `Create failed (${res.status})`);
    }
    toast.success('Matter created');
    await load();
  }

  if (rows === null) return <PageSkeleton />;

  return (
    <div>
      <PageHeader
        title="Matters"
        subtitle="Client engagements — active and historical."
        actions={
          <Button onClick={() => setNewOpen(true)} variant="primary" size="sm" icon={<PlusIcon size={13} />}>
            New matter
          </Button>
        }
      />
      <CrmFormModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        mode="create"
        title="New matter"
        subtitle="Opening a matter — reference will auto-generate as MP-YYYY-NNNN if blank."
        fields={MATTER_FIELDS}
        initial={{ status: 'active', conflict_check_done: false }}
        onSave={handleCreate}
      />
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[220px] max-w-xs">
          <SearchIcon size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-muted" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search reference or title..."
            className="w-full pl-7 pr-3 py-1.5 text-[12.5px] border border-border rounded-md focus:outline-none focus:border-brand-500" />
        </div>
        <select value={status} onChange={e => setStatus(e.target.value)}
          className="px-2 py-1.5 text-[12.5px] border border-border rounded-md bg-white">
          <option value="">All statuses</option>
          {MATTER_STATUSES.map(s => <option key={s} value={s}>{LABELS_MATTER_STATUS[s]}</option>)}
        </select>
        <div className="ml-auto flex items-center gap-2">
          <ExportButton entity="matters" />
          <span className="text-[11.5px] text-ink-muted">{rows.length} matters</span>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState illustration="folder" title="No matters yet" description="Matters typically arrive from won opportunities, or direct from Notion import." />
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
                <th className="text-left px-3 py-2 font-medium">Reference</th>
                <th className="text-left px-3 py-2 font-medium">Client</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-left px-3 py-2 font-medium">Practice</th>
                <th className="text-left px-3 py-2 font-medium">Fee</th>
                <th className="text-right px-3 py-2 font-medium">Total billed</th>
                <th className="text-right px-3 py-2 font-medium">Hours</th>
                <th className="text-left px-3 py-2 font-medium">Opened</th>
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
                    <Link href={`/crm/matters/${r.id}`} className="font-medium text-brand-700 hover:underline font-mono">{r.matter_reference}</Link>
                    {!r.conflict_check_done && r.status === 'active' && (
                      <span className="ml-2 text-[9.5px] uppercase tracking-wide text-danger-700 bg-danger-50 border border-danger-200 rounded px-1 py-0.5" title="Conflict check pending">No conflict check</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {r.client_id ? <Link href={`/crm/companies/${r.client_id}`} className="text-ink-muted hover:underline">{r.client_name}</Link> : <span className="text-ink-muted">—</span>}
                  </td>
                  <td className="px-3 py-2">{LABELS_MATTER_STATUS[r.status as MatterStatus] ?? r.status}</td>
                  <td className="px-3 py-2 text-ink-muted">{(r.practice_areas ?? []).join(', ') || '—'}</td>
                  <td className="px-3 py-2 text-ink-muted">{r.fee_type ?? '—'}{r.hourly_rate_eur ? ` · ${formatEur(r.hourly_rate_eur)}/h` : ''}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatEur(r.total_billed)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{Number(r.total_hours).toFixed(1)}h</td>
                  <td className="px-3 py-2 text-ink-muted">{formatDate(r.opening_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <BulkActionBar
        targetType="crm_matter"
        selectedIds={Array.from(selected)}
        onClear={clearSelection}
        onDone={() => { clearSelection(); load(); }}
      />
    </div>
  );
}
