'use client';

// /tax-ops/settings/groups — CRUD for client groups (families).
// Stint 37.E: Diego manages families (Peninsula, Trilantic, ...)
// directly. Inline rename, archive toggle, delete (blocked when
// entities still reference it).

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeftIcon, PlusIcon, Trash2Icon, CheckIcon, XIcon } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { CrmErrorBox } from '@/components/crm/CrmErrorBox';
import { useToast } from '@/components/Toaster';

interface ClientGroup {
  id: string;
  name: string;
  is_active: boolean;
  notes: string | null;
  entity_count: number;
}

export default function ClientGroupsPage() {
  const [rows, setRows] = useState<ClientGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<ClientGroup>>({});
  const [newRow, setNewRow] = useState<{ name: string; notes: string } | null>(null);
  const toast = useToast();

  const load = useCallback(() => {
    fetch('/api/tax-ops/client-groups')
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(body => { setRows(body.groups); setError(null); })
      .catch(e => { setError(String(e instanceof Error ? e.message : e)); setRows([]); });
  }, []);

  useEffect(() => { load(); }, [load]);

  function startEdit(g: ClientGroup) {
    setEditingId(g.id);
    setDraft({ name: g.name, notes: g.notes, is_active: g.is_active });
  }

  async function saveEdit(id: string) {
    try {
      const res = await fetch(`/api/tax-ops/client-groups/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name,
          notes: draft.notes || null,
          is_active: draft.is_active,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error ?? `HTTP ${res.status}`);
      }
      toast.success('Saved');
      setEditingId(null);
      load();
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
    }
  }

  async function remove(g: ClientGroup) {
    if (g.entity_count > 0) {
      toast.error(`Can't delete "${g.name}" — ${g.entity_count} entities still reference it. Reassign them or archive first.`);
      return;
    }
    if (!confirm(`Delete family "${g.name}"? Reversible via audit log.`)) return;
    const res = await fetch(`/api/tax-ops/client-groups/${g.id}`, { method: 'DELETE' });
    if (!res.ok) {
      toast.error('Delete failed');
      return;
    }
    toast.success('Family deleted');
    load();
  }

  async function createNew() {
    if (!newRow || !newRow.name.trim()) return;
    try {
      const res = await fetch('/api/tax-ops/client-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newRow.name.trim(), notes: newRow.notes || null }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error ?? `HTTP ${res.status}`);
      }
      toast.success('Family added');
      setNewRow(null);
      load();
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
    }
  }

  if (rows === null) return <PageSkeleton />;

  return (
    <div>
      <Link href="/tax-ops/settings" className="inline-flex items-center gap-1 text-[12px] text-ink-muted hover:text-ink mb-2">
        <ArrowLeftIcon size={12} /> Back to settings
      </Link>
      <PageHeader
        title="Client groups (families)"
        subtitle={`${rows.length} families — ${rows.filter(r => r.is_active).length} active.`}
        actions={
          newRow ? null : (
            <button
              onClick={() => setNewRow({ name: '', notes: '' })}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[12px] rounded-md bg-brand-500 hover:bg-brand-600 text-white"
            >
              <PlusIcon size={12} /> Add family
            </button>
          )
        }
      />

      {error && <CrmErrorBox message={error} onRetry={load} />}

      <div className="rounded-md border border-border bg-surface overflow-hidden">
        <table className="w-full text-[12.5px]">
          <thead className="bg-surface-alt text-ink-muted">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Notes</th>
              <th className="px-3 py-2 font-medium text-right">Entities</th>
              <th className="px-3 py-2 font-medium">Active</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {newRow && (
              <tr className="border-t border-border bg-brand-50/30">
                <td className="px-3 py-1.5">
                  <input
                    autoFocus
                    value={newRow.name}
                    onChange={e => setNewRow({ ...newRow, name: e.target.value })}
                    placeholder="e.g. Acme Holdings"
                    className="w-full px-2 py-1 text-[12px] border border-border rounded-md bg-surface"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <input
                    value={newRow.notes}
                    onChange={e => setNewRow({ ...newRow, notes: e.target.value })}
                    placeholder="optional notes"
                    className="w-full px-2 py-1 text-[12px] border border-border rounded-md bg-surface"
                  />
                </td>
                <td className="px-3 py-1.5 text-right text-ink-muted">—</td>
                <td className="px-3 py-1.5 text-ink-muted">Yes (default)</td>
                <td className="px-3 py-1.5 text-right">
                  <button onClick={createNew} className="inline-flex items-center gap-1 px-2 py-1 text-[11.5px] rounded-md bg-brand-500 text-white hover:bg-brand-600">
                    <CheckIcon size={11} /> Save
                  </button>
                  <button onClick={() => setNewRow(null)} className="inline-flex items-center gap-1 px-2 py-1 ml-1 text-[11.5px] rounded-md border border-border hover:bg-surface-alt">
                    <XIcon size={11} />
                  </button>
                </td>
              </tr>
            )}
            {rows.length === 0 && !newRow ? (
              <tr>
                <td colSpan={5}>
                  <EmptyState
                    title="No families yet"
                    description="Add families to group your entities (fund families, client groups, etc.)."
                  />
                </td>
              </tr>
            ) : rows.map(g => (
              <tr key={g.id} className="border-t border-border">
                {editingId === g.id ? (
                  <>
                    <td className="px-3 py-1.5">
                      <input
                        value={draft.name ?? ''}
                        onChange={e => setDraft({ ...draft, name: e.target.value })}
                        className="w-full px-2 py-1 text-[12px] border border-border rounded-md bg-surface"
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <input
                        value={draft.notes ?? ''}
                        onChange={e => setDraft({ ...draft, notes: e.target.value })}
                        className="w-full px-2 py-1 text-[12px] border border-border rounded-md bg-surface"
                      />
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{g.entity_count}</td>
                    <td className="px-3 py-1.5">
                      <label className="inline-flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={draft.is_active ?? true}
                          onChange={e => setDraft({ ...draft, is_active: e.target.checked })}
                        />
                        <span className="text-[11.5px]">{draft.is_active ? 'Active' : 'Archived'}</span>
                      </label>
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <button onClick={() => saveEdit(g.id)} className="inline-flex items-center gap-1 px-2 py-1 text-[11.5px] rounded-md bg-brand-500 text-white hover:bg-brand-600">
                        <CheckIcon size={11} /> Save
                      </button>
                      <button onClick={() => setEditingId(null)} className="inline-flex items-center gap-1 px-2 py-1 ml-1 text-[11.5px] rounded-md border border-border hover:bg-surface-alt">
                        <XIcon size={11} />
                      </button>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-3 py-1.5 font-medium">{g.name}</td>
                    <td className="px-3 py-1.5 text-ink-soft">{g.notes ?? '—'}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{g.entity_count}</td>
                    <td className="px-3 py-1.5">
                      {g.is_active ? (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10.5px] bg-green-100 text-green-800">Active</span>
                      ) : (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10.5px] bg-surface-alt text-ink-muted">Archived</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <button onClick={() => startEdit(g)} className="text-[11.5px] text-brand-700 hover:text-brand-800 mr-2">
                        Edit
                      </button>
                      <button
                        onClick={() => remove(g)}
                        aria-label="Delete family"
                        disabled={g.entity_count > 0}
                        title={g.entity_count > 0 ? `${g.entity_count} entities still reference this` : 'Delete'}
                        className="inline-flex items-center p-1 text-ink-muted hover:text-danger-600 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <Trash2Icon size={12} />
                      </button>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
