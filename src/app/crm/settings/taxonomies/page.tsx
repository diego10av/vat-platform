'use client';

// ════════════════════════════════════════════════════════════════════════
// /crm/settings/taxonomies — CRUD for the dropdown values used across
// the CRM. Replaces the hardcoded arrays (countries, practice areas,
// fee types, etc.) with user-editable rows backed by crm_taxonomies.
//
// System values can be renamed + archived (not deleted). User-added
// values can be deleted outright. Archiving hides a value from new
// dropdowns but keeps it rendering on records that already use it.
// ════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { PlusIcon, Trash2Icon, EyeOffIcon, EyeIcon, PencilIcon, CheckIcon } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/Toaster';
import { CrmErrorBox } from '@/components/crm/CrmErrorBox';
import { crmLoadList } from '@/lib/useCrmFetch';

interface TaxonomyRow {
  id: string;
  kind: string;
  value: string;
  label: string;
  sort_order: number;
  is_system: boolean;
  archived: boolean;
}

const KINDS: Array<{ value: string; label: string; help: string }> = [
  { value: 'country',       label: 'Countries',      help: 'Used on companies (country of registration) and future on contacts.' },
  { value: 'industry',      label: 'Industries',     help: 'Sector classification for companies.' },
  { value: 'practice_area', label: 'Practice areas', help: 'Legal practice areas for matters + opportunities.' },
  { value: 'fee_type',      label: 'Fee types',      help: 'Billing structure options on matters.' },
  { value: 'role_tag',      label: 'Contact roles',  help: 'Role tags that classify contacts (main POC, decision maker, etc.).' },
  { value: 'source',        label: 'Lead sources',   help: 'Where opportunities came from.' },
  { value: 'loss_reason',   label: 'Loss reasons',   help: 'Why an opportunity was lost. Used in funnel analysis.' },
];

export default function TaxonomiesPage() {
  const toast = useToast();
  const [selectedKind, setSelectedKind] = useState<string>(KINDS[0].value);
  const [rows, setRows] = useState<TaxonomyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');

  const load = useCallback(() => {
    const qs = new URLSearchParams({ kind: selectedKind });
    if (showArchived) qs.set('include_archived', '1');
    crmLoadList<TaxonomyRow>(`/api/crm/taxonomies?${qs}`)
      .then(r => { setRows(r); setError(null); })
      .catch((e: Error) => { setError(e.message); setRows([]); });
  }, [selectedKind, showArchived]);
  useEffect(() => { load(); }, [load]);

  async function add(value: string, label: string) {
    const res = await fetch('/api/crm/taxonomies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: selectedKind, value, label }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body?.error?.message ?? 'Add failed');
      return;
    }
    toast.success(`Added: ${label}`);
    setAddOpen(false);
    load();
  }

  async function toggleArchive(row: TaxonomyRow) {
    const res = await fetch(`/api/crm/taxonomies/${row.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: !row.archived }),
    });
    if (!res.ok) { toast.error('Update failed'); return; }
    toast.success(row.archived ? 'Unarchived' : 'Archived');
    load();
  }

  async function saveLabel(row: TaxonomyRow) {
    if (!editLabel.trim() || editLabel.trim() === row.label) {
      setEditingId(null);
      return;
    }
    const res = await fetch(`/api/crm/taxonomies/${row.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: editLabel.trim() }),
    });
    if (!res.ok) { toast.error('Update failed'); return; }
    toast.success('Label updated');
    setEditingId(null);
    load();
  }

  async function remove(row: TaxonomyRow) {
    if (!confirm(`Delete "${row.label}"? User-added values are gone for good — consider archive first.`)) return;
    const res = await fetch(`/api/crm/taxonomies/${row.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body?.error?.message ?? 'Delete failed');
      return;
    }
    toast.success('Deleted');
    load();
  }

  const kindMeta = KINDS.find(k => k.value === selectedKind)!;

  return (
    <div className="max-w-[820px]">
      <div className="text-[11.5px] text-ink-muted mb-2">
        <Link href="/crm/settings" className="hover:underline">← Settings</Link>
      </div>
      <PageHeader
        title="Categories"
        subtitle="Editable dropdown values used across the CRM."
      />

      <div className="grid grid-cols-[200px,1fr] gap-5">
        {/* Kind picker */}
        <nav className="space-y-0.5">
          {KINDS.map(k => (
            <button
              key={k.value}
              onClick={() => { setSelectedKind(k.value); setEditingId(null); }}
              className={`w-full text-left px-3 py-2 rounded-md text-[12.5px] ${
                selectedKind === k.value
                  ? 'bg-brand-50 border border-brand-200 text-brand-800 font-semibold'
                  : 'text-ink-soft hover:bg-surface-alt'
              }`}
            >
              {k.label}
            </button>
          ))}
        </nav>

        {/* Table */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div>
              <h2 className="text-[14px] font-semibold text-ink">{kindMeta.label}</h2>
              <p className="text-[11.5px] text-ink-muted">{kindMeta.help}</p>
            </div>
            <div className="flex items-center gap-2">
              <label className="inline-flex items-center gap-1.5 text-[11.5px] text-ink-soft">
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={e => setShowArchived(e.target.checked)}
                  className="h-3.5 w-3.5 accent-brand-500"
                />
                Show archived
              </label>
              <Button variant="primary" size="sm" icon={<PlusIcon size={12} />} onClick={() => setAddOpen(true)}>
                Add
              </Button>
            </div>
          </div>

          {error && <div className="mb-2"><CrmErrorBox message={error} onRetry={load} compact /></div>}

          <div className="border border-border rounded-md bg-white overflow-hidden">
            <table className="w-full text-[12px]">
              <thead className="bg-surface-alt/50 text-ink-muted">
                <tr>
                  <th className="text-left px-3 py-1.5 font-medium">Label</th>
                  <th className="text-left px-3 py-1.5 font-medium font-mono text-[11px]">value</th>
                  <th className="text-left px-3 py-1.5 font-medium">Type</th>
                  <th className="text-left px-3 py-1.5 font-medium">Status</th>
                  <th className="px-3 py-1.5 w-[140px]"></th>
                </tr>
              </thead>
              <tbody>
                {rows === null && (
                  <tr><td colSpan={5} className="px-3 py-4 text-center text-ink-muted italic">Loading…</td></tr>
                )}
                {rows && rows.length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-4 text-center text-ink-muted italic">No values in this category.</td></tr>
                )}
                {rows?.map(r => (
                  <tr key={r.id} className={`border-t border-border ${r.archived ? 'opacity-50' : ''}`}>
                    <td className="px-3 py-2">
                      {editingId === r.id ? (
                        <input
                          value={editLabel}
                          onChange={e => setEditLabel(e.target.value)}
                          onBlur={() => saveLabel(r)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') saveLabel(r);
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          autoFocus
                          className="h-7 px-2 text-[12px] border border-brand-300 rounded w-full"
                        />
                      ) : (
                        <button
                          onClick={() => { setEditingId(r.id); setEditLabel(r.label); }}
                          className="text-left hover:bg-surface-alt/60 px-1 py-0.5 rounded inline-flex items-center gap-1"
                          title="Click to rename"
                        >
                          {r.label}
                          <PencilIcon size={10} className="text-ink-muted" />
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-ink-muted">{r.value}</td>
                    <td className="px-3 py-2 text-[11px] text-ink-muted">
                      {r.is_system ? 'System' : 'Custom'}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-ink-muted">
                      {r.archived ? 'Archived' : 'Active'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => toggleArchive(r)}
                        className="text-ink-muted hover:text-ink inline-flex items-center gap-1 text-[11px] mr-2"
                        title={r.archived ? 'Unarchive' : 'Archive'}
                      >
                        {r.archived ? <EyeIcon size={11} /> : <EyeOffIcon size={11} />}
                        {r.archived ? 'Unarchive' : 'Archive'}
                      </button>
                      {!r.is_system && (
                        <button
                          onClick={() => remove(r)}
                          className="text-danger-600 hover:text-danger-800 inline-flex items-center gap-1 text-[11px]"
                          title="Delete permanently"
                        >
                          <Trash2Icon size={11} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {addOpen && (
            <AddForm
              kindLabel={kindMeta.label}
              onCancel={() => setAddOpen(false)}
              onAdd={add}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function AddForm({
  kindLabel, onCancel, onAdd,
}: {
  kindLabel: string;
  onCancel: () => void;
  onAdd: (value: string, label: string) => Promise<void>;
}) {
  const [label, setLabel] = useState('');
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  // Auto-suggest a value from the label (slugify).
  function handleLabelChange(v: string) {
    setLabel(v);
    if (!value || value === slug(label)) {
      setValue(slug(v));
    }
  }

  async function submit() {
    if (!label.trim() || !value.trim()) return;
    setSaving(true);
    try { await onAdd(value.trim(), label.trim()); } finally { setSaving(false); }
  }

  return (
    <div className="mt-3 border border-brand-200 bg-brand-50/30 rounded-md p-3">
      <div className="text-[12px] font-semibold mb-2">New {kindLabel.toLowerCase().replace(/s$/, '')}</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div>
          <label className="block text-[10.5px] uppercase text-ink-muted mb-0.5">Label</label>
          <input
            value={label}
            onChange={e => handleLabelChange(e.target.value)}
            placeholder="What the user sees"
            className="w-full h-8 px-2 text-[12.5px] border border-border rounded"
          />
        </div>
        <div>
          <label className="block text-[10.5px] uppercase text-ink-muted mb-0.5">Value (slug)</label>
          <input
            value={value}
            onChange={e => setValue(e.target.value.replace(/[^a-zA-Z0-9_-]/g, '_'))}
            placeholder="stored_in_db"
            className="w-full h-8 px-2 text-[12.5px] border border-border rounded font-mono"
          />
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-2">
        <button onClick={onCancel} disabled={saving} className="h-7 px-2.5 rounded border border-border text-[11.5px] text-ink-soft hover:bg-white">
          Cancel
        </button>
        <Button variant="primary" size="sm" onClick={submit} loading={saving} icon={<CheckIcon size={12} />}>
          Add
        </Button>
      </div>
    </div>
  );
}

function slug(s: string): string {
  return s.trim().toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/__+/g, '_');
}
