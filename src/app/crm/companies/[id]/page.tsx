'use client';

import { useEffect, useState, use, useCallback } from 'react';
import Link from 'next/link';
import { Breadcrumbs } from '@/components/ui/Breadcrumbs';
import { useRouter } from 'next/navigation';
import { PencilIcon, Trash2Icon } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/Toaster';
import { CrmFormModal } from '@/components/crm/CrmFormModal';
import { RecordHistory } from '@/components/crm/RecordHistory';
import { RetainerLedger } from '@/components/crm/RetainerLedger';
import { ApplyTemplateButton } from '@/components/crm/ApplyTemplateButton';
import { COMPANY_FIELDS } from '@/components/crm/schemas';
// Stint 63 bonus — port inline-edit primitives to the detail page so
// the read-only Cards become live edit widgets, matching the list UX.
import { ChipSelect } from '@/components/tax-ops/ChipSelect';
import {
  COMPANY_INDUSTRIES, COMPANY_SIZES,
  LABELS_CLASSIFICATION, LABELS_INDUSTRY, LABELS_SIZE,
  LABELS_STAGE, LABELS_MATTER_STATUS, LABELS_INVOICE_STATUS,
  formatEur, formatDate,
} from '@/lib/crm-types';

interface CompanyDetail {
  company: Record<string, unknown>;
  // Stint 64.U.2 — junction_id + started_at so the contacts table
  // can edit role + primary inline via PATCH /api/crm/contacts/[id]/companies.
  contacts: Array<{
    id: string;
    full_name: string;
    email: string | null;
    job_title: string | null;
    junction_id: string;
    role: string;
    is_primary: boolean;
    started_at: string | null;
  }>;
  opportunities: Array<{ id: string; name: string; stage: string; estimated_value_eur: number | null; probability_pct: number | null; weighted_value_eur: number | null; estimated_close_date: string | null }>;
  matters: Array<{ id: string; matter_reference: string; title: string; status: string; practice_areas: string[]; opening_date: string | null; closing_date: string | null }>;
  invoices: Array<{ id: string; invoice_number: string; issue_date: string | null; due_date: string | null; amount_incl_vat: number; outstanding: number; status: string }>;
}

export default function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const toast = useToast();
  const [data, setData] = useState<CompanyDetail | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/crm/companies/${id}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(setData)
      .catch(() => setData(null));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function handleUpdate(values: Record<string, unknown>) {
    const res = await fetch(`/api/crm/companies/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message ?? `Update failed (${res.status})`);
    }
    const body = await res.json();
    if (Array.isArray(body.changed) && body.changed.length > 0) {
      toast.success(`Updated ${body.changed.length} field${body.changed.length === 1 ? '' : 's'}`);
    } else {
      toast.info('No changes to save');
    }
    await load();
  }

  // Stint 63 bonus — single-field patch for the inline edit Cards.
  async function patchField(field: string, value: unknown) {
    try {
      const res = await fetch(`/api/crm/companies/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (e) {
      toast.error(`Save failed: ${String(e instanceof Error ? e.message : e)}`);
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete "${String(data?.company?.company_name ?? '?')}"?\n\nIt goes to the trash for 30 days — you can restore it from /crm/trash.`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/crm/companies/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err?.error?.message ?? `Delete failed (${res.status})`);
        return;
      }
      toast.withAction('success', 'Company moved to trash', 'Will auto-purge after 30 days.', {
        label: 'Undo',
        onClick: async () => {
          const restore = await fetch(`/api/crm/trash/company/${id}`, { method: 'POST' });
          if (restore.ok) {
            toast.success('Company restored');
            router.push(`/crm/companies/${id}`);
          } else {
            toast.error('Undo failed — restore manually from /crm/trash');
          }
        },
      });
      router.push('/crm/companies');
    } finally {
      setDeleting(false);
    }
  }

  if (!data) return <PageSkeleton />;
  const c = data.company as Record<string, string | number | string[] | null>;

  return (
    <div>
      <PageHeader
        // Stint 65.E — breadcrumb replaces the loose "← All companies"
        // backlink. Same orientation, more orientation: shows the full
        // path so a user dropped in via a deep-link (or after closing
        // a drawer) immediately knows where they are.
        breadcrumb={
          <Breadcrumbs crumbs={[
            { label: 'CRM',       href: '/crm' },
            { label: 'Companies', href: '/crm/companies' },
            { label: String(c.company_name ?? '(unnamed)') },
          ]} />
        }
        title={String(c.company_name ?? '(unnamed)')}
        subtitle={`${c.classification ? LABELS_CLASSIFICATION[c.classification as keyof typeof LABELS_CLASSIFICATION] : ''}${c.country ? ` · ${c.country}` : ''}`}
        actions={
          <>
            <ApplyTemplateButton scope="company" targetType="crm_company" targetId={id} />
            <Button variant="secondary" size="sm" icon={<PencilIcon size={13} />} onClick={() => setEditOpen(true)}>
              Edit
            </Button>
            <Button variant="ghost" size="sm" icon={<Trash2Icon size={13} />} onClick={handleDelete} loading={deleting}>
              Delete
            </Button>
          </>
        }
      />
      <CrmFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        mode="edit"
        title="Edit company"
        subtitle={String(c.company_name ?? '')}
        fields={COMPANY_FIELDS}
        initial={{
          company_name: c.company_name,
          classification: c.classification,
          country: c.country,
          industry: c.industry,
          size: c.size,
          website: c.website,
          linkedin_url: c.linkedin_url,
          tags: c.tags ?? [],
          notes: c.notes,
        }}
        onSave={handleUpdate}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
        <Card title="Industry">
          <ChipSelect
            value={String(c.industry ?? '')}
            options={[
              { value: '', label: '—', tone: 'bg-surface-alt text-ink-faint' },
              ...COMPANY_INDUSTRIES.map(v => ({
                value: v,
                label: LABELS_INDUSTRY[v as keyof typeof LABELS_INDUSTRY],
              })),
            ]}
            onChange={next => { void patchField('industry', next || null); }}
            ariaLabel="Industry"
          />
        </Card>
        <Card title="Size">
          <ChipSelect
            value={String(c.size ?? '')}
            options={[
              { value: '', label: '—', tone: 'bg-surface-alt text-ink-faint' },
              ...COMPANY_SIZES.map(v => ({
                value: v,
                label: LABELS_SIZE[v as keyof typeof LABELS_SIZE],
              })),
            ]}
            onChange={next => { void patchField('size', next || null); }}
            ariaLabel="Size"
          />
        </Card>
        {/* Stint 66.A — "Linked tax entity" card removed. Diego
            (2026-05-04, Rule §14): the three modules stay strictly
            independent. CRM owns its own companies; Tax-Ops owns its
            own entities; no cross-FK. The `entity_id` column stays
            in the DB as dead data (easy revert if Diego changes
            mind), but every UI / API surface stops exposing it. */}
      </div>

      {c.notes && (
        <div className="mb-5 p-3 bg-surface-alt border border-border rounded text-sm whitespace-pre-wrap">{String(c.notes)}</div>
      )}

      {/* Stint 64.U.2 — Contacts: role + primary editable inline.
          Diego: "todos aparecen como primary point of contact... debería
          haber posibilidades de poner diferentes grados". Click the
          ⭐ to mark primary, or change role inline. */}
      <Section title={`Contacts (${data.contacts.length})`}>
        <ContactsTable contacts={data.contacts} onChanged={load} />
      </Section>

      <Section title={`Opportunities (${data.opportunities.length})`}>
        <Table
          headers={['Name', 'Stage', 'Value', 'Probability', 'Weighted', 'Close date']}
          rows={data.opportunities.map(x => [
            <Link key={x.id} href={`/crm/opportunities/${x.id}`} className="text-brand-700 hover:underline">{x.name}</Link>,
            LABELS_STAGE[x.stage as keyof typeof LABELS_STAGE] ?? x.stage,
            formatEur(x.estimated_value_eur),
            x.probability_pct !== null ? `${x.probability_pct}%` : '—',
            formatEur(x.weighted_value_eur),
            formatDate(x.estimated_close_date),
          ])}
        />
      </Section>

      <Section title={`Matters (${data.matters.length})`}>
        <Table
          headers={['Reference', 'Title', 'Status', 'Practice', 'Opened', 'Closed']}
          rows={data.matters.map(x => [
            <Link key={x.id} href={`/crm/matters/${x.id}`} className="text-brand-700 hover:underline">{x.matter_reference}</Link>,
            x.title,
            LABELS_MATTER_STATUS[x.status as keyof typeof LABELS_MATTER_STATUS] ?? x.status,
            (x.practice_areas ?? []).join(', '),
            formatDate(x.opening_date),
            formatDate(x.closing_date),
          ])}
        />
      </Section>

      <Section title={`Invoices (${data.invoices.length})`}>
        <Table
          headers={['Number', 'Issue', 'Due', 'Amount', 'Outstanding', 'Status']}
          rows={data.invoices.map(x => [
            x.invoice_number,
            formatDate(x.issue_date),
            formatDate(x.due_date),
            formatEur(x.amount_incl_vat),
            formatEur(x.outstanding),
            LABELS_INVOICE_STATUS[x.status as keyof typeof LABELS_INVOICE_STATUS] ?? x.status,
          ])}
        />
      </Section>

      <RetainerLedger companyId={id} companyName={String((data.company as { company_name?: string }).company_name ?? 'this client')} />

      <RecordHistory targetType="crm_company" targetId={id} />
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-border rounded-md bg-white px-3 py-2">
      <div className="text-2xs uppercase tracking-wide font-semibold text-ink-muted mb-1">{title}</div>
      <div className="text-sm">{children}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h3 className="text-sm uppercase tracking-wide font-semibold text-ink-muted mb-2">{title}</h3>
      {children}
    </div>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: React.ReactNode[][] }) {
  if (rows.length === 0) return <div className="text-sm text-ink-muted italic px-3 py-2">None</div>;
  return (
    <div className="border border-border rounded-md overflow-hidden bg-white">
      <table className="w-full text-sm">
        <thead className="bg-surface-alt text-ink-muted">
          <tr>{headers.map((h, i) => <th key={i} className="text-left px-3 py-1.5 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border">{r.map((cell, j) => <td key={j} className="px-3 py-1.5">{cell}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Stint 64.U.2 — Contacts table on the company detail page.
// Diego: "no todos deberían aparecer como primary point of contact.
// Para Roca Juniet, Raúl es el number one contact, el otro es
// simplemente una persona."
//
// Each row exposes:
//   - ⭐ / ☆ click → toggles is_primary on the junction. Setting one
//     primary auto-clears the others (single-primary invariant).
//   - Role chip → click to open dropdown of ROLE_TAGS values.
//   - Click on full_name → navigates to the contact detail.
//
// Both edits hit PATCH /api/crm/contacts/{contact_id}/companies
// with the junction_id, so the audit log + history-preservation
// semantics are inherited for free.
const ROLE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'main_poc',         label: 'Main POC' },
  { value: 'decision_maker',   label: 'Decision maker' },
  { value: 'billing_contact',  label: 'Billing contact' },
  { value: 'referrer',         label: 'Referrer' },
  { value: 'internal',         label: 'Internal' },
  { value: 'opposing_party',   label: 'Opposing party' },
];

const ROLE_TONES: Record<string, string> = {
  main_poc:        'bg-brand-100 text-brand-800',
  decision_maker:  'bg-amber-100 text-amber-900',
  billing_contact: 'bg-blue-50 text-blue-800',
  referrer:        'bg-emerald-50 text-emerald-800',
  internal:        'bg-surface-alt text-ink-soft',
  opposing_party:  'bg-danger-50 text-danger-700',
};

function ContactsTable({
  contacts, onChanged,
}: {
  contacts: CompanyDetail['contacts'];
  onChanged: () => void;
}) {
  const toast = useToast();

  async function patchJunction(
    contactId: string,
    junctionId: string,
    patch: { role?: string; is_primary?: boolean },
  ) {
    try {
      const res = await fetch(`/api/crm/contacts/${contactId}/companies`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ junction_id: junctionId, ...patch }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b?.error?.message ?? `HTTP ${res.status}`);
      }
      onChanged();
    } catch (e) {
      toast.error(`Save failed: ${String(e instanceof Error ? e.message : e)}`);
    }
  }

  async function setPrimary(contactId: string, junctionId: string) {
    // Single-primary invariant: clear the others, then set this one.
    // Done in two passes (no transaction needed — last writer wins is
    // acceptable for this UX, and the company detail re-fetches at the
    // end which will reflect the truth).
    for (const c of contacts) {
      if (c.junction_id === junctionId) continue;
      if (c.is_primary) {
        await fetch(`/api/crm/contacts/${c.id}/companies`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ junction_id: c.junction_id, is_primary: false }),
        });
      }
    }
    await patchJunction(contactId, junctionId, { is_primary: true });
    toast.success('Primary contact updated');
  }

  if (contacts.length === 0) {
    return <div className="text-sm text-ink-muted italic px-3 py-2">No contacts linked yet.</div>;
  }

  return (
    <div className="border border-border rounded-md overflow-hidden bg-white">
      <table className="w-full text-sm">
        <thead className="bg-surface-alt text-ink-muted">
          <tr>
            <th className="text-left px-3 py-1.5 font-medium w-8" title="Primary point of contact">⭐</th>
            <th className="text-left px-3 py-1.5 font-medium">Name</th>
            <th className="text-left px-3 py-1.5 font-medium">Role</th>
            <th className="text-left px-3 py-1.5 font-medium">Job title</th>
            <th className="text-left px-3 py-1.5 font-medium">Email</th>
          </tr>
        </thead>
        <tbody>
          {contacts.map(c => (
            <tr key={c.junction_id} className="border-t border-border hover:bg-surface-alt/50">
              <td className="px-3 py-1.5">
                <button
                  type="button"
                  onClick={() => { if (!c.is_primary) void setPrimary(c.id, c.junction_id); }}
                  className={`text-base leading-none ${
                    c.is_primary
                      ? 'text-amber-500 cursor-default'
                      : 'text-ink-faint hover:text-amber-500 cursor-pointer'
                  }`}
                  title={c.is_primary ? 'Primary point of contact' : 'Click to make this the primary contact'}
                  aria-label={c.is_primary ? 'Primary contact' : 'Make primary'}
                  disabled={c.is_primary}
                >
                  {c.is_primary ? '★' : '☆'}
                </button>
              </td>
              <td className="px-3 py-1.5">
                <Link href={`/crm/contacts/${c.id}`} className="text-brand-700 hover:underline font-medium">
                  {c.full_name}
                </Link>
              </td>
              <td className="px-3 py-1.5">
                <select
                  value={c.role}
                  onChange={(e) => void patchJunction(c.id, c.junction_id, { role: e.target.value })}
                  className={`px-1.5 py-0.5 text-xs rounded border border-border bg-white ${ROLE_TONES[c.role] ?? ''}`}
                  aria-label="Contact role"
                >
                  {ROLE_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </td>
              <td className="px-3 py-1.5 text-ink-soft">{c.job_title ?? '—'}</td>
              <td className="px-3 py-1.5">
                {c.email ? <a href={`mailto:${c.email}`} className="text-brand-700 hover:underline">{c.email}</a> : <span className="text-ink-muted">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
