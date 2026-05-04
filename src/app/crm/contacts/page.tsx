'use client';

// Stint 67.B.b: per-page force-dynamic — see /clients/page.tsx.
export const dynamic = 'force-dynamic';
import { useEffect, useState, useCallback, useMemo, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { SearchIcon, PlusIcon, ExternalLinkIcon, MailIcon, Trash2Icon } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { CrmFormModal } from '@/components/crm/CrmFormModal';
import { BulkActionBar } from '@/components/crm/BulkActionBar';
import { ExportButton } from '@/components/crm/ExportButton';
import { CrmErrorBox } from '@/components/crm/CrmErrorBox';
import { CrmContextMenu, type CrmContextAction } from '@/components/crm/CrmContextMenu';
import { CrmSavedViews } from '@/components/crm/CrmSavedViews';
import { BulkEditDrawer, type BulkEditField } from '@/components/crm/BulkEditDrawer';
// Stint 63.L — hover preview on contact name.
import { ContactHoverPreview } from '@/components/crm/ContactHoverPreview';
import { crmLoadList } from '@/lib/useCrmFetch';
import { CONTACT_FIELDS } from '@/components/crm/schemas';
import { useToast } from '@/components/Toaster';
// Stint 63.A — port Tax-Ops inline editors to CRM contacts table.
import { InlineTextCell, InlineDateCell } from '@/components/tax-ops/inline-editors';
import { ChipSelect } from '@/components/tax-ops/ChipSelect';
// Stint 64.T — inline editor for the Company / firm column.
import { InlineCompanyCell } from '@/components/crm/InlineCompanyCell';
import {
  LABELS_LIFECYCLE, LABELS_ENGAGEMENT, CONTACT_LIFECYCLES,
  ENGAGEMENT_LEVELS,
  type ContactLifecycle, type EngagementLevel,
} from '@/lib/crm-types';

// Stint 63.A — chip tones per lifecycle/engagement, keeping the visual
// signal language consistent with companies.
const LIFECYCLE_TONES: Record<string, string> = {
  lead:            'bg-info-50 text-info-800',
  prospect:        'bg-amber-50 text-amber-800',
  customer:        'bg-success-50 text-success-800',
  former_customer: 'bg-surface-alt text-ink-faint',
};
const ENGAGEMENT_TONES: Record<string, string> = {
  active:  'bg-success-50 text-success-800',
  dormant: 'bg-amber-50 text-amber-800',
  lapsed:  'bg-danger-50 text-danger-700',
};

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
  // Stint 64.P — current primary company (denormalised by the API).
  primary_company_id: string | null;
  primary_company_name: string | null;
}

export default function ContactsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ContactsPageContent />
    </Suspense>
  );
}

function ContactsPageContent() {
  // Stint 63.D — URL-persistent filters + saved views.
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [rows, setRows] = useState<Contact[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState(searchParams.get('q') ?? '');
  const [lifecycle, setLifecycle] = useState<string>(searchParams.get('lifecycle') ?? '');
  const [newOpen, setNewOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Stint 63.C — right-click context menu state.
  const [contextMenu, setContextMenu] = useState<{ contact: Contact; x: number; y: number } | null>(null);
  // Stint 63.E — bulk-edit drawer state.
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const toast = useToast();

  // Stint 63.D — sync state → URL with router.replace (filter changes
  // don't bloat back-history). Skip first render.
  const firstSync = useRef(true);
  useEffect(() => {
    if (firstSync.current) { firstSync.current = false; return; }
    const qs = new URLSearchParams();
    if (q) qs.set('q', q);
    if (lifecycle) qs.set('lifecycle', lifecycle);
    const s = qs.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }, [q, lifecycle, router, pathname]);

  const currentQuery = useMemo(() => {
    const qs = new URLSearchParams();
    if (q) qs.set('q', q);
    if (lifecycle) qs.set('lifecycle', lifecycle);
    return qs.toString();
  }, [q, lifecycle]);

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

  // Stint 63.C — soft-delete invoked from the context menu.
  async function archiveContact(id: string, name: string) {
    if (!confirm(`Archive "${name}"? Soft delete; restore from /crm/trash.`)) return;
    try {
      const res = await fetch(`/api/crm/contacts/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success('Contact archived');
      await load();
    } catch (e) {
      toast.error(`Archive failed: ${String(e instanceof Error ? e.message : e)}`);
    }
  }

  // Stint 63.A — inline-edit helper, mirror of patchCompany. Writes one
  // field at a time, optimistic update on success, rollback on error.
  async function patchContact(id: string, field: string, value: unknown): Promise<void> {
    try {
      const res = await fetch(`/api/crm/contacts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message ?? `Save failed (${res.status})`);
      }
      setRows(prev => prev?.map(r =>
        r.id === id ? { ...r, [field]: value as never } : r
      ) ?? null);
    } catch (e) {
      toast.error(`Save failed: ${String(e instanceof Error ? e.message : e)}`);
      await load();
      throw e;
    }
  }

  if (rows === null) return <PageSkeleton />;

  return (
    <div>
      <PageHeader
        title="Contacts"
        subtitle="People at client companies, prospects, referrers. Press N anywhere to quick-create."
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
            className="w-full pl-7 pr-3 py-1.5 text-sm border border-border rounded-md" />
        </div>
        <select value={lifecycle} onChange={e => setLifecycle(e.target.value)}
          className="px-2 py-1.5 text-sm border border-border rounded-md bg-white">
          <option value="">All lifecycle stages</option>
          {CONTACT_LIFECYCLES.map(s => <option key={s} value={s}>{LABELS_LIFECYCLE[s]}</option>)}
        </select>
        <CrmSavedViews
          currentQuery={currentQuery}
          storageKey="cifra.crm.contacts.savedViews.v1"
          defaultLabel="All contacts"
        />
        <div className="ml-auto flex items-center gap-2">
          <ExportButton entity="contacts" />
          <span className="text-xs text-ink-muted">{rows.length} contacts</span>
        </div>
      </div>

      {rows.length === 0 ? (
        (() => {
          const filtersActive = q !== '' || lifecycle !== '';
          return (
            <EmptyState
              illustration="approvers"
              title={filtersActive ? 'No contacts match these filters' : 'No contacts yet'}
              description={filtersActive
                ? 'Loosen your filters or clear them to see all contacts.'
                : 'Add your first contact to start tracking people. Press N anywhere in /crm for quick-capture.'}
              action={filtersActive ? undefined : (
                <Button onClick={() => setNewOpen(true)} variant="primary" size="sm" icon={<PlusIcon size={13} />}>
                  New contact
                </Button>
              )}
            />
          );
        })()
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
                <th className="text-left px-3 py-2 font-medium">Name</th>
                <th className="text-left px-3 py-2 font-medium">Company / firm</th>
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
                // engagement_override is the user-set value; engagement_level
                // is server-computed (active/dormant/lapsed by activity heuristic).
                // The cell shows the override if set, falling back to the
                // computed level — but the editor writes ONLY engagement_override
                // (the only writable column on the server).
                const engDisplay = r.engagement_override ?? r.engagement_level;
                return (
                  <tr
                    key={r.id}
                    onContextMenu={(e) => {
                      const tgt = e.target as HTMLElement;
                      const tag = tgt.tagName?.toLowerCase();
                      if (tag === 'input' || tag === 'textarea' || tgt.isContentEditable) return;
                      e.preventDefault();
                      setContextMenu({ contact: r, x: e.clientX, y: e.clientY });
                    }}
                    className={`border-t border-border hover:bg-surface-alt/50 ${selected.has(r.id) ? 'bg-brand-50/40' : ''}`}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selected.has(r.id)}
                        onChange={() => toggleOne(r.id)}
                        className="h-4 w-4 accent-brand-500 cursor-pointer"
                      />
                    </td>
                    {/* Name — Link wrapped in hover preview (renaming a
                        person in the list view is an edge case better
                        handled in detail). */}
                    <td className="px-3 py-2">
                      <ContactHoverPreview contactId={r.id}>
                        <Link href={`/crm/contacts/${r.id}`} className="font-medium text-brand-700 hover:underline">{r.full_name}</Link>
                      </ContactHoverPreview>
                    </td>
                    {/* Stint 64.P + 64.T + 64.U.1 — Company / firm.
                        Click the name → navigate to the company. Hover
                        reveals a ✎ icon → click to switch firm (history
                        preserved). Empty state: "+ Set firm" button. */}
                    <td className="px-3 py-2 max-w-[220px]">
                      <InlineCompanyCell
                        contactId={r.id}
                        currentCompanyId={r.primary_company_id}
                        currentCompanyName={r.primary_company_name}
                        onChanged={load}
                      />
                    </td>
                    {/* Job title — inline editable text. */}
                    <td className="px-3 py-2 max-w-[180px]">
                      <InlineTextCell
                        value={r.job_title}
                        onSave={async v => { await patchContact(r.id, 'job_title', v); }}
                        placeholder="—"
                      />
                    </td>
                    {/* Email — inline editable text. */}
                    <td className="px-3 py-2 tabular-nums max-w-[220px]">
                      <InlineTextCell
                        value={r.email}
                        onSave={async v => { await patchContact(r.id, 'email', v); }}
                        placeholder="—"
                      />
                    </td>
                    {/* Country — short code (LU, FR, DE…). */}
                    <td className="px-3 py-2 max-w-[80px]">
                      <InlineTextCell
                        value={r.country}
                        onSave={async v => { await patchContact(r.id, 'country', v); }}
                        placeholder="—"
                      />
                    </td>
                    {/* Lifecycle — ChipSelect with fixed taxonomy. */}
                    <td className="px-3 py-2">
                      <ChipSelect
                        value={r.lifecycle_stage ?? ''}
                        options={[
                          { value: '', label: '—', tone: 'bg-surface-alt text-ink-faint' },
                          ...CONTACT_LIFECYCLES.map(v => ({
                            value: v,
                            label: LABELS_LIFECYCLE[v as ContactLifecycle],
                            tone: LIFECYCLE_TONES[v],
                          })),
                        ]}
                        onChange={next => { void patchContact(r.id, 'lifecycle_stage', next || null); }}
                        ariaLabel="Lifecycle stage"
                      />
                    </td>
                    {/* Engagement — write to engagement_override; display
                        prefers override, falls back to computed level. */}
                    <td className="px-3 py-2">
                      <ChipSelect
                        value={r.engagement_override ?? ''}
                        options={[
                          {
                            value: '',
                            label: r.engagement_level
                              ? `auto · ${LABELS_ENGAGEMENT[r.engagement_level as EngagementLevel]}`
                              : '—',
                            tone: 'bg-surface-alt text-ink-faint',
                          },
                          ...ENGAGEMENT_LEVELS.map(v => ({
                            value: v,
                            label: LABELS_ENGAGEMENT[v as EngagementLevel],
                            tone: ENGAGEMENT_TONES[v],
                          })),
                        ]}
                        onChange={next => { void patchContact(r.id, 'engagement_override', next || null); }}
                        ariaLabel="Engagement (override)"
                        placeholder={engDisplay ? LABELS_ENGAGEMENT[engDisplay as EngagementLevel] : '—'}
                      />
                    </td>
                    {/* Follow-up — inline editable date. */}
                    <td className="px-3 py-2">
                      <InlineDateCell
                        value={r.next_follow_up}
                        onSave={async v => { await patchContact(r.id, 'next_follow_up', v); }}
                      />
                    </td>
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
        onEditFields={() => setBulkEditOpen(true)}
      />

      {/* Stint 63.E — bulk-edit drawer. */}
      <BulkEditDrawer
        open={bulkEditOpen}
        onClose={() => setBulkEditOpen(false)}
        recordType="contact"
        selectedIds={Array.from(selected)}
        endpoint="/api/crm/contacts/bulk-update"
        fields={[
          {
            key: 'lifecycle_stage',
            label: 'Lifecycle stage',
            type: 'select',
            options: CONTACT_LIFECYCLES.map(s => ({ value: s, label: LABELS_LIFECYCLE[s] })),
          },
          {
            key: 'engagement_override',
            label: 'Engagement (override auto-computed)',
            type: 'select',
            options: ENGAGEMENT_LEVELS.map(s => ({ value: s, label: LABELS_ENGAGEMENT[s] })),
          },
          { key: 'country',  label: 'Country',  type: 'text', placeholder: 'e.g. LU' },
          { key: 'source',   label: 'Source',   type: 'text', placeholder: 'e.g. Referral, LinkedIn, Event' },
        ] satisfies BulkEditField[]}
        onApplied={() => { clearSelection(); load(); }}
      />

      {/* Stint 63.C — right-click context menu. */}
      {contextMenu && (() => {
        const c = contextMenu.contact;
        const actions: CrmContextAction[] = [
          {
            label: 'Open detail',
            icon: ExternalLinkIcon,
            onClick: () => router.push(`/crm/contacts/${c.id}`),
          },
          {
            label: c.email ? 'Email this contact' : 'No email on file',
            icon: MailIcon,
            disabled: !c.email,
            onClick: () => {
              if (c.email) window.location.href = `mailto:${c.email}`;
            },
          },
          {
            label: 'Archive',
            icon: Trash2Icon,
            danger: true,
            separatorBefore: true,
            onClick: () => archiveContact(c.id, c.full_name),
          },
        ];
        return (
          <CrmContextMenu
            title={c.full_name}
            x={contextMenu.x}
            y={contextMenu.y}
            actions={actions}
            onClose={() => setContextMenu(null)}
          />
        );
      })()}
    </div>
  );
}
