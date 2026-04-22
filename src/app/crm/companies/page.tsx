'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { SearchIcon, PlusIcon } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { CrmFormModal } from '@/components/crm/CrmFormModal';
import { BulkActionBar } from '@/components/crm/BulkActionBar';
import { ExportButton } from '@/components/crm/ExportButton';
import { COMPANY_FIELDS } from '@/components/crm/schemas';
import { useToast } from '@/components/Toaster';
import {
  LABELS_CLASSIFICATION, LABELS_INDUSTRY, LABELS_SIZE,
  type CompanyClassification,
} from '@/lib/crm-types';

interface Company {
  id: string;
  company_name: string;
  country: string | null;
  industry: string | null;
  size: string | null;
  classification: string | null;
  website: string | null;
  linkedin_url: string | null;
  tags: string[];
  entity_id: string | null;
}

export default function CompaniesPage() {
  const [rows, setRows] = useState<Company[] | null>(null);
  const [q, setQ] = useState('');
  const [classFilter, setClassFilter] = useState<string>('');
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
    if (classFilter) qs.set('classification', classFilter);
    fetch(`/api/crm/companies?${qs}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(setRows)
      .catch(() => setRows([]));
  }, [q, classFilter]);

  useEffect(() => { load(); }, [load]);

  async function handleCreate(values: Record<string, unknown>) {
    const res = await fetch('/api/crm/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message ?? `Create failed (${res.status})`);
    }
    toast.success('Company created');
    await load();
  }

  const counts = useMemo(() => {
    const by: Record<string, number> = {};
    for (const r of rows ?? []) by[r.classification ?? 'none'] = (by[r.classification ?? 'none'] || 0) + 1;
    return by;
  }, [rows]);

  if (rows === null) return <PageSkeleton />;

  return (
    <div>
      <PageHeader
        title="Companies"
        subtitle="CRM accounts — firms, prospects, service providers, referrers."
        actions={
          <Button onClick={() => setNewOpen(true)} variant="primary" size="sm" icon={<PlusIcon size={13} />}>
            New company
          </Button>
        }
      />
      <CrmFormModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        mode="create"
        title="New company"
        subtitle="Create a new account in the CRM."
        fields={COMPANY_FIELDS}
        onSave={handleCreate}
      />
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[220px] max-w-xs">
          <SearchIcon size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-muted" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search company name..."
            className="w-full pl-7 pr-3 py-1.5 text-[12.5px] border border-border rounded-md focus:outline-none focus:border-brand-500"
          />
        </div>
        <select
          value={classFilter}
          onChange={e => setClassFilter(e.target.value)}
          className="px-2 py-1.5 text-[12.5px] border border-border rounded-md bg-white"
        >
          <option value="">All classifications</option>
          {Object.entries(LABELS_CLASSIFICATION).map(([k, label]) => (
            <option key={k} value={k}>{label}{counts[k] ? ` · ${counts[k]}` : ''}</option>
          ))}
        </select>
        <div className="ml-auto flex items-center gap-2">
          <ExportButton entity="companies" />
          <span className="text-[11.5px] text-ink-muted">{rows.length} companies</span>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          illustration="clients"
          title="No companies yet"
          description="Run the Notion import (scripts/import-notion-crm.md) to bring your CRM data in."
        />
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
                <th className="text-left px-3 py-2 font-medium">Company</th>
                <th className="text-left px-3 py-2 font-medium">Classification</th>
                <th className="text-left px-3 py-2 font-medium">Country</th>
                <th className="text-left px-3 py-2 font-medium">Industry</th>
                <th className="text-left px-3 py-2 font-medium">Size</th>
                <th className="text-left px-3 py-2 font-medium">Tags</th>
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
                    <Link href={`/crm/companies/${r.id}`} className="font-medium text-brand-700 hover:underline">
                      {r.company_name}
                    </Link>
                    {r.entity_id && (
                      <span className="ml-2 text-[10px] uppercase tracking-wide text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1 py-0.5">
                        Tax entity linked
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {r.classification ? LABELS_CLASSIFICATION[r.classification as CompanyClassification] ?? r.classification : '—'}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{r.country ?? '—'}</td>
                  <td className="px-3 py-2">
                    {r.industry ? LABELS_INDUSTRY[r.industry as keyof typeof LABELS_INDUSTRY] ?? r.industry : '—'}
                  </td>
                  <td className="px-3 py-2">
                    {r.size ? LABELS_SIZE[r.size as keyof typeof LABELS_SIZE] ?? r.size : '—'}
                  </td>
                  <td className="px-3 py-2 text-ink-muted">{(r.tags ?? []).join(', ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <BulkActionBar
        targetType="crm_company"
        selectedIds={Array.from(selected)}
        onClear={clearSelection}
        onDone={() => { clearSelection(); load(); }}
      />
    </div>
  );
}
