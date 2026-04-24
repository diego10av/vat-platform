'use client';

// /tax-ops/settings/team — flat CRUD for the 8-ish team roster.
// Intentionally minimal: inline editable rows + add-new row.

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeftIcon, PlusIcon, Trash2Icon, CheckIcon, XIcon } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { CrmErrorBox } from '@/components/crm/CrmErrorBox';
import { useToast } from '@/components/Toaster';
import { crmLoadShape } from '@/lib/useCrmFetch';

interface TeamMember {
  id: string;
  short_name: string;
  full_name: string | null;
  email: string | null;
  is_active: boolean;
}

export default function TaxOpsTeamPage() {
  const [rows, setRows] = useState<TeamMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<TeamMember>>({});
  const [newRow, setNewRow] = useState<{ short_name: string; full_name: string; email: string } | null>(null);
  const toast = useToast();

  const load = useCallback(() => {
    crmLoadShape<TeamMember[]>('/api/tax-ops/team', b => (b as { members: TeamMember[] }).members)
      .then(rows => { setRows(rows); setError(null); })
      .catch(e => { setError(String(e instanceof Error ? e.message : e)); setRows([]); });
  }, []);

  useEffect(() => { load(); }, [load]);

  function startEdit(m: TeamMember) {
    setEditingId(m.id);
    setDraft({ short_name: m.short_name, full_name: m.full_name, email: m.email, is_active: m.is_active });
  }

  async function saveEdit(id: string) {
    try {
      const res = await fetch(`/api/tax-ops/team/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          short_name: draft.short_name,
          full_name: draft.full_name || null,
          email: draft.email || null,
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

  async function remove(id: string) {
    if (!confirm('Remove this team member? Their assignments on past filings stay untouched.')) return;
    const res = await fetch(`/api/tax-ops/team/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      toast.error('Delete failed');
      return;
    }
    toast.success('Removed');
    load();
  }

  async function createNew() {
    if (!newRow || !newRow.short_name.trim()) return;
    try {
      const res = await fetch('/api/tax-ops/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          short_name: newRow.short_name.trim(),
          full_name: newRow.full_name.trim() || undefined,
          email: newRow.email.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error ?? `HTTP ${res.status}`);
      }
      toast.success('Member added');
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
        title="Team members"
        subtitle={`${rows.length} members — ${rows.filter(r => r.is_active).length} active.`}
        actions={
          newRow ? null : (
            <button
              onClick={() => setNewRow({ short_name: '', full_name: '', email: '' })}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[12px] rounded-md bg-brand-500 hover:bg-brand-600 text-white"
            >
              <PlusIcon size={12} /> Add member
            </button>
          )
        }
      />

      {error && <CrmErrorBox message={error} onRetry={load} />}

      <div className="rounded-md border border-border bg-surface overflow-hidden">
        <table className="w-full text-[12.5px]">
          <thead className="bg-surface-alt text-ink-muted">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">Short name</th>
              <th className="px-3 py-2 font-medium">Full name</th>
              <th className="px-3 py-2 font-medium">Email</th>
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
                    value={newRow.short_name}
                    onChange={e => setNewRow({ ...newRow, short_name: e.target.value })}
                    placeholder="e.g. Gab"
                    className="w-full px-2 py-1 text-[12px] border border-border rounded-md bg-surface"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <input
                    value={newRow.full_name}
                    onChange={e => setNewRow({ ...newRow, full_name: e.target.value })}
                    placeholder="Full name"
                    className="w-full px-2 py-1 text-[12px] border border-border rounded-md bg-surface"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <input
                    value={newRow.email}
                    onChange={e => setNewRow({ ...newRow, email: e.target.value })}
                    placeholder="email@firm.com"
                    className="w-full px-2 py-1 text-[12px] border border-border rounded-md bg-surface"
                  />
                </td>
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
                    title="No team members yet"
                    description="Add short-name aliases matching your Excel 'Prepared with' cells."
                  />
                </td>
              </tr>
            ) : rows.map(m => (
              <tr key={m.id} className="border-t border-border">
                {editingId === m.id ? (
                  <>
                    <td className="px-3 py-1.5">
                      <input
                        value={draft.short_name ?? ''}
                        onChange={e => setDraft({ ...draft, short_name: e.target.value })}
                        className="w-full px-2 py-1 text-[12px] border border-border rounded-md bg-surface"
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <input
                        value={draft.full_name ?? ''}
                        onChange={e => setDraft({ ...draft, full_name: e.target.value })}
                        className="w-full px-2 py-1 text-[12px] border border-border rounded-md bg-surface"
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <input
                        value={draft.email ?? ''}
                        onChange={e => setDraft({ ...draft, email: e.target.value })}
                        className="w-full px-2 py-1 text-[12px] border border-border rounded-md bg-surface"
                      />
                    </td>
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
                      <button onClick={() => saveEdit(m.id)} className="inline-flex items-center gap-1 px-2 py-1 text-[11.5px] rounded-md bg-brand-500 text-white hover:bg-brand-600">
                        <CheckIcon size={11} /> Save
                      </button>
                      <button onClick={() => setEditingId(null)} className="inline-flex items-center gap-1 px-2 py-1 ml-1 text-[11.5px] rounded-md border border-border hover:bg-surface-alt">
                        <XIcon size={11} />
                      </button>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-3 py-1.5 font-medium">{m.short_name}</td>
                    <td className="px-3 py-1.5 text-ink-soft">{m.full_name ?? '—'}</td>
                    <td className="px-3 py-1.5 text-ink-soft">{m.email ?? '—'}</td>
                    <td className="px-3 py-1.5">
                      {m.is_active ? (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10.5px] bg-green-100 text-green-800">Active</span>
                      ) : (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10.5px] bg-surface-alt text-ink-muted">Archived</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <button onClick={() => startEdit(m)} className="text-[11.5px] text-brand-700 hover:text-brand-800 mr-2">
                        Edit
                      </button>
                      <button
                        onClick={() => remove(m.id)}
                        aria-label="Remove member"
                        className="inline-flex items-center p-1 text-ink-muted hover:text-danger-600"
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
