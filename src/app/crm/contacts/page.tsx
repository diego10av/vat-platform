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
import { CrmErrorBox } from '@/components/crm/CrmErrorBox';
import { crmLoadList } from '@/lib/useCrmFetch';
import { CONTACT_FIELDS } from '@/components/crm/schemas';
import { useToast } from '@/components/Toaster';
import {
  LABELS_LIFECYCLE, LABELS_ENGAGEMENT, CONTACT_LIFECYCLES,
  type ContactLifecycle, type EngagementLevel,
} from '@/lib/crm-types';

interface Contact {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  job_title: string | null;
  country: string | null;
  lifecycle_stage: string | null;
  role_tags: string[];
  engagement_level: string | null;
  engagement_override: string | null;
  source: string | null;
  lead_score: number | null;
  next_follow_up: string | null;
}

export default function ContactsPage() {
  const [rows, setRows] = useState<Contact[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [lifecycle, setLifecycle] = useState<string>('');
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
    if (lifecycle) qs.set('lifecycle', lifecycle);
    crmLoadList<Contact>(`/api/crm/contacts?${qs}`)
      .then(rows => { setRows(rows); setError(null); })
      .catch((e: Error) => { setError(e.message || 'Network error'); setRows([]); });
  }, [q, lifecycle]);

  useEffect(() => { load(); }, [load]);

  async function handleCreate(values: Record<string, unknown>) {
    const res = await fetch('/api/crm/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message ?? `Create failed (${res.status})`);
    }
    toast.success('Contact created');
    await load();
  }

  if (rows === null) return <PageSkeleton />;

  return (
    <div>
      <PageHeader
        title="Contacts"
        subtitle="People at client companies, prospects, referrers."
        actions={
          <Button onClick={() => setNewOpen(true)} variant="primary" size="sm" icon={<PlusIcon size={13} />}>
            New contact
          </Button>
        }
      />
      <CrmFormModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        mode="create"
        title="New contact"
        subtitle="Add a person to the CRM."
        fields={CONTACT_FIELDS}
        onSave={handleCreate}
      />
      {error && <div className="mb-3"><CrmErrorBox message={error} onRetry={load} /></div>}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[220px] max-w-xs">
          <SearchIcon size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-muted" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name or email..."
            className="w-full pl-7 pr-3 py-1.5 text-[12.5px] border border-border rounded-md focus:outline-none focus:border-brand-500" />
        </div>
        <select value={lifecycle} onChange={e => setLifecycle(e.target.value)}
          className="px-2 py-1.5 text-[12.5px] border border-border rounded-md bg-white">
          <option value="">All lifecycle stages</option>
          {CONTACT_LIFECYCLES.map(s => <option key={s} value={s}>{LABELS_LIFECYCLE[s]}</option>)}
        </select>
        <div className="ml-auto flex items-center gap-2">
          <ExportButton entity="contacts" />
          <span className="text-[11.5px] text-ink-muted">{rows.length} contacts</span>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState illustration="approvers" title="No contacts yet" description="Run the Notion import to populate." />
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
                <th className="text-left px-3 py-2 font-medium">Job title</th>
                <th className="text-left px-3 py-2 font-medium">Email</th>
                <th className="text-left px-3 py-2 font-medium">Country</th>
                <th className="text-left px-3 py-2 font-medium">Lifecycle</th>
                <th className="text-left px-3 py-2 font-medium">Engagement</th>
                <th className="text-left px-3 py-2 font-medium">Follow-up</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const eng = r.engagement_override ?? r.engagement_level;
                return (
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
                      <Link href={`/crm/contacts/${r.id}`} className="font-medium text-brand-700 hover:underline">{r.full_name}</Link>
                    </td>
                    <td className="px-3 py-2 text-ink-muted">{r.job_title ?? '—'}</td>
                    <td className="px-3 py-2 tabular-nums">{r.email ?? '—'}</td>
                    <td className="px-3 py-2">{r.country ?? '—'}</td>
                    <td className="px-3 py-2">{r.lifecycle_stage ? LABELS_LIFECYCLE[r.lifecycle_stage as ContactLifecycle] : '—'}</td>
                    <td className="px-3 py-2">{eng ? LABELS_ENGAGEMENT[eng as EngagementLevel] : '—'}</td>
                    <td className="px-3 py-2 text-ink-muted">{r.next_follow_up ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <BulkActionBar
        targetType="crm_contact"
        selectedIds={Array.from(selected)}
        onClear={clearSelection}
        onDone={() => { clearSelection(); load(); }}
      />
    </div>
  );
}
