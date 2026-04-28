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
import { CrmErrorBox } from '@/components/crm/CrmErrorBox';
import { COMPANY_FIELDS } from '@/components/crm/schemas';
import { useToast } from '@/components/Toaster';
// Stint 63.A — port Tax-Ops inline-edit primitives. Same components,
// different endpoint. Closes Diego's "todo debería ser editable" — the
// table cells become live edit widgets without leaving the list view.
import { InlineTextCell, InlineTagsCell } from '@/components/tax-ops/inline-editors';
import { ChipSelect } from '@/components/tax-ops/ChipSelect';
import {
  COMPANY_CLASSIFICATIONS, COMPANY_INDUSTRIES, COMPANY_SIZES,
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

// Stint 63.A — chip tones per classification, mirroring the tax-ops
// pattern (status chips coloured by semantic meaning).
const CLASSIFICATION_TONES: Record<string, string> = {
  key_account:    'bg-brand-50 text-brand-800',
  standard:       'bg-info-50 text-info-800',
  occasional:     'bg-amber-50 text-amber-800',
  not_yet_client: 'bg-surface-alt text-ink-faint',
};

export default function CompaniesPage() {
  const [rows, setRows] = useState<Company[] | null>(null);
  const [error, setError] = useState<string | null>(null);
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
      .then(async r => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body?.error?.message ?? `${r.status} ${r.statusText}`);
        }
        return r.json();
      })
      .then(body => { setRows(Array.isArray(body) ? body : []); setError(null); })
      .catch((e: Error) => { setError(e.message || 'Network error'); setRows([]); });
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

  // Stint 63.A — inline-edit helper. Each editable cell calls this with
  // a single field/value, hits PUT /api/crm/companies/[id] which only
  // touches that field (whitelist enforced server-side), and refetches
  // the list so any audit-log row flushed by the server is reflected.
  // Optimistic display happens inside InlineCellEditor; on save error
  // we toast and reload to rollback to server state.
  async function patchCompany(id: string, field: string, value: unknown): Promise<void> {
    try {
      const res = await fetch(`/api/crm/companies/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message ?? `Save failed (${res.status})`);
      }
      // Optimistic: patch the row in-place so the UI reflects the change
      // without the visual flicker of a full reload.
      setRows(prev => prev?.map(r =>
        r.id === id ? { ...r, [field]: value as never } : r
      ) ?? null);
    } catch (e) {
      toast.error(`Save failed: ${String(e instanceof Error ? e.message : e)}`);
      // Rollback by reloading from server.
      await load();
      throw e;
    }
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
      {error && <div className="mb-3"><CrmErrorBox message={error} onRetry={load} /></div>}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[220px] max-w-xs">
          <SearchIcon size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-muted" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search company name..."
            className="w-full pl-7 pr-3 py-1.5 text-sm border border-border rounded-md"
          />
        </div>
        <select
          value={classFilter}
          onChange={e => setClassFilter(e.target.value)}
          className="px-2 py-1.5 text-sm border border-border rounded-md bg-white"
        >
          <option value="">All classifications</option>
          {Object.entries(LABELS_CLASSIFICATION).map(([k, label]) => (
            <option key={k} value={k}>{label}{counts[k] ? ` · ${counts[k]}` : ''}</option>
          ))}
        </select>
        <div className="ml-auto flex items-center gap-2">
          <ExportButton entity="companies" />
          <span className="text-xs text-ink-muted">{rows.length} companies</span>
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
          <table className="w-full text-sm">
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
                  {/* Company name — kept as Link to detail page (the list
                      isn't the place to rename a company; that's a heavy
                      action that warrants the detail context). */}
                  <td className="px-3 py-2">
                    <Link href={`/crm/companies/${r.id}`} className="font-medium text-brand-700 hover:underline">
                      {r.company_name}
                    </Link>
                    {r.entity_id && (
                      <span className="ml-2 text-2xs uppercase tracking-wide text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1 py-0.5">
                        Tax entity linked
                      </span>
                    )}
                  </td>
                  {/* Classification — ChipSelect with tone per value. */}
                  <td className="px-3 py-2">
                    <ChipSelect
                      value={r.classification ?? ''}
                      options={[
                        { value: '', label: '—', tone: 'bg-surface-alt text-ink-faint' },
                        ...COMPANY_CLASSIFICATIONS.map(v => ({
                          value: v,
                          label: LABELS_CLASSIFICATION[v as CompanyClassification],
                          tone: CLASSIFICATION_TONES[v],
                        })),
                      ]}
                      onChange={next => { void patchCompany(r.id, 'classification', next || null); }}
                      ariaLabel="Classification"
                    />
                  </td>
                  {/* Country — free-text 2-letter code (LU, FR, BE, etc.). */}
                  <td className="px-3 py-2 tabular-nums max-w-[80px]">
                    <InlineTextCell
                      value={r.country}
                      onSave={async v => { await patchCompany(r.id, 'country', v); }}
                      placeholder="—"
                    />
                  </td>
                  {/* Industry — ChipSelect, fixed taxonomy. */}
                  <td className="px-3 py-2">
                    <ChipSelect
                      value={r.industry ?? ''}
                      options={[
                        { value: '', label: '—', tone: 'bg-surface-alt text-ink-faint' },
                        ...COMPANY_INDUSTRIES.map(v => ({
                          value: v,
                          label: LABELS_INDUSTRY[v as keyof typeof LABELS_INDUSTRY],
                        })),
                      ]}
                      onChange={next => { void patchCompany(r.id, 'industry', next || null); }}
                      ariaLabel="Industry"
                    />
                  </td>
                  {/* Size — ChipSelect, fixed taxonomy. */}
                  <td className="px-3 py-2">
                    <ChipSelect
                      value={r.size ?? ''}
                      options={[
                        { value: '', label: '—', tone: 'bg-surface-alt text-ink-faint' },
                        ...COMPANY_SIZES.map(v => ({
                          value: v,
                          label: LABELS_SIZE[v as keyof typeof LABELS_SIZE],
                        })),
                      ]}
                      onChange={next => { void patchCompany(r.id, 'size', next || null); }}
                      ariaLabel="Size"
                    />
                  </td>
                  {/* Tags — comma-separated free-text via InlineTagsCell. */}
                  <td className="px-3 py-2">
                    <InlineTagsCell
                      value={r.tags ?? []}
                      onSave={async v => { await patchCompany(r.id, 'tags', v); }}
                      placeholder="—"
                    />
                  </td>
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
