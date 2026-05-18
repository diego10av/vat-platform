'use client';

import { useEffect, useState, use, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PencilIcon, Trash2Icon, ArrowRightIcon } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Breadcrumbs } from '@/components/ui/Breadcrumbs';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/Toaster';
import { CrmFormModal } from '@/components/crm/CrmFormModal';
import { RecordHistory } from '@/components/crm/RecordHistory';
import { ConflictCheckPanel } from '@/components/crm/ConflictCheckPanel';
import { MatterTimeTracker } from '@/components/crm/MatterTimeTracker';
import { MatterDisbursements } from '@/components/crm/MatterDisbursements';
import { MatterDocsClosing } from '@/components/crm/MatterDocsClosing';
import { ApplyTemplateButton } from '@/components/crm/ApplyTemplateButton';
import { MATTER_FIELDS } from '@/components/crm/schemas';
// Stint 63.M — inline-edit primitives on matter detail Cards.
import { InlineDateCell } from '@/components/tax-ops/inline-editors';
import {
  LABELS_MATTER_STATUS, LABELS_ACTIVITY_TYPE, LABELS_INVOICE_STATUS,
  formatEur, formatDate, type ActivityType,
} from '@/lib/crm-types';

interface MatterDetail {
  matter: Record<string, unknown>;
  activities: Array<{ id: string; name: string; activity_type: string; activity_date: string; duration_hours: number | null; billable: boolean; outcome: string | null }>;
  invoices: Array<{ id: string; invoice_number: string; issue_date: string | null; due_date: string | null; amount_incl_vat: number; outstanding: number; status: string }>;
}

export default function MatterDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const toast = useToast();
  const [data, setData] = useState<MatterDetail | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/crm/matters/${id}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(setData)
      .catch(() => setData(null));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function handleUpdate(values: Record<string, unknown>) {
    const res = await fetch(`/api/crm/matters/${id}`, {
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
    } else toast.info('No changes to save');
    await load();
  }

  // Stint 63.M — single-field PUT for inline-editable Cards.
  async function patchField(field: string, value: unknown) {
    try {
      const res = await fetch(`/api/crm/matters/${id}`, {
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
    const ref = String((data?.matter as { matter_reference?: string })?.matter_reference ?? '?');
    if (!confirm(`Delete matter "${ref}"?\n\nThis is permanent and cannot be undone.`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/crm/matters/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err?.error?.message ?? `Delete failed (${res.status})`);
        return;
      }
      toast.success('Matter deleted');
      router.push('/crm/matters');
    } finally {
      setDeleting(false);
    }
  }

  if (!data) return <PageSkeleton />;
  const m = data.matter as Record<string, string | number | boolean | string[] | null> & { client_name?: string; client_id?: string; primary_contact_name?: string; primary_contact_id?: string };
  const totalBilled = data.invoices.reduce((s, i) => s + Number(i.amount_incl_vat), 0);
  const totalOutstanding = data.invoices.reduce((s, i) => s + Number(i.outstanding), 0);
  const totalHours = data.activities.reduce((s, a) => s + Number(a.duration_hours ?? 0), 0);

  return (
    <div>
      <PageHeader
        // Stint 65.E — breadcrumb replaces the loose "← All matters"
        // backlink so deep-linked users see the full path.
        breadcrumb={
          <Breadcrumbs crumbs={[
            { label: 'CRM',     href: '/crm' },
            { label: 'Matters', href: '/crm/matters' },
            { label: String(m.matter_reference ?? m.title ?? '(unnamed)') },
          ]} />
        }
        title={<span><span className="font-mono text-brand-600 mr-2">{String(m.matter_reference)}</span>{String(m.title)}</span>}
        subtitle={`${m.status ? LABELS_MATTER_STATUS[m.status as keyof typeof LABELS_MATTER_STATUS] : ''}${m.client_name ? ` · ${m.client_name}` : ''}${m.fee_type ? ` · ${m.fee_type}` : ''}`}
        actions={
          <>
            <ApplyTemplateButton scope="matter" targetType="crm_matter" targetId={id} />
            <Button variant="secondary" size="sm" icon={<PencilIcon size={13} />} onClick={() => setEditOpen(true)}>Edit</Button>
            <Button variant="ghost" size="sm" icon={<Trash2Icon size={13} />} onClick={handleDelete} loading={deleting}>Delete</Button>
          </>
        }
      />
      <CrmFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        mode="edit"
        title="Edit matter"
        subtitle={String(m.matter_reference ?? '')}
        fields={MATTER_FIELDS}
        initial={{
          matter_reference: m.matter_reference,
          title: m.title,
          status: m.status,
          practice_areas: m.practice_areas ?? [],
          fee_type: m.fee_type,
          hourly_rate_eur: m.hourly_rate_eur,
          opening_date: m.opening_date,
          closing_date: m.closing_date,
          conflict_check_done: !!m.conflict_check_done,
          conflict_check_date: m.conflict_check_date,
          documents_link: m.documents_link,
          tags: m.tags ?? [],
          notes: m.notes,
          // Stint 101 — missing here pre-fix caused silent data loss:
          // open Edit, change ANY field, save → these six got NULL-ed
          // because the form state for absent fields defaulted to ''
          // → trimmed to null → PUT wrote NULL. Add the current values
          // so they round-trip cleanly.
          client_company_id: (m as { client_company_id?: string | null }).client_company_id ?? null,
          primary_contact_id: (m as { primary_contact_id?: string | null }).primary_contact_id ?? null,
          counterparty_name: (m as { counterparty_name?: string | null }).counterparty_name ?? null,
          related_parties: (m as { related_parties?: string | null }).related_parties ?? null,
          estimated_budget_eur: (m as { estimated_budget_eur?: number | null }).estimated_budget_eur ?? null,
          cap_eur: (m as { cap_eur?: number | null }).cap_eur ?? null,
        }}
        onSave={handleUpdate}
      />

      {!m.conflict_check_done && m.status === 'active' && (
        <div className="mb-4 p-3 bg-danger-50 border border-danger-300 rounded text-sm text-danger-800">
          ⚠ Conflict check NOT marked as done. Run the scan below + tick the box in Edit.
        </div>
      )}

      <ConflictCheckPanel
        matterId={id}
        clientCompanyId={(m as { client_id?: string | null }).client_id ?? null}
        clientName={m.client_name ?? null}
        counterpartyName={(m as { counterparty_name?: string | null }).counterparty_name ?? null}
        relatedParties={Array.isArray((m as { related_parties?: string[] }).related_parties) ? (m as { related_parties: string[] }).related_parties : []}
        initialResult={(m as { conflict_check_result?: { checked_at: string; hits: Array<{ matter_id: string; matter_reference: string; status: string; field: 'client' | 'counterparty' | 'related'; party: string; match_value: string; client_name: string | null }>; false_positive_ids?: string[] } | null }).conflict_check_result ?? null}
      />

      <MatterTimeTracker
        matterId={id}
        defaultRateEur={m.hourly_rate_eur !== null && m.hourly_rate_eur !== undefined ? Number(m.hourly_rate_eur) : null}
        estimatedBudgetEur={(m as { estimated_budget_eur?: number | null }).estimated_budget_eur !== null && (m as { estimated_budget_eur?: number | null }).estimated_budget_eur !== undefined ? Number((m as { estimated_budget_eur?: number | null }).estimated_budget_eur) : null}
        capEur={(m as { cap_eur?: number | null }).cap_eur !== null && (m as { cap_eur?: number | null }).cap_eur !== undefined ? Number((m as { cap_eur?: number | null }).cap_eur) : null}
        billedSoFar={totalBilled}
      />

      <MatterDisbursements matterId={id} />

      <MatterDocsClosing matterId={id} />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-5">
        <Card title="Total billed">{formatEur(totalBilled)}</Card>
        <Card title="Outstanding">{formatEur(totalOutstanding)}</Card>
        <Card title="Total hours">{totalHours.toFixed(1)}h</Card>
        <Card title="Opened">
          <InlineDateCell
            value={m.opening_date as string | null}
            onSave={async v => { await patchField('opening_date', v); }}
            mode="neutral"
          />
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
        <Card title="Client">
          {m.client_id ? <Link href={`/crm/companies/${m.client_id}`} className="text-brand-700 hover:underline">{m.client_name ?? '—'}</Link> : '—'}
        </Card>
        <Card title="Primary contact">
          {m.primary_contact_id ? <Link href={`/crm/contacts/${m.primary_contact_id}`} className="text-brand-700 hover:underline">{m.primary_contact_name ?? '—'}</Link> : '—'}
        </Card>
      </div>

      {/* Stint 94 — Engagement bridge CRM → Tax-Ops. Diego closes a
          matter, but the compliance follow-up work lives in Tax-Ops.
          Rule §14 forbids auto-sync / cross-module FKs, so this is a
          UX affordance only: a single click creates a parent task in
          Tax-Ops with the matter's title + client + reference pre-
          filled into the description, then redirects there for Diego
          to flesh out sub-tasks and counterparties. Idempotency is
          NOT enforced (clicking twice creates two tasks); for dogfood
          single-user that's an acceptable trade. */}
      <EngagementBridge matterId={id} matter={m} />



      {m.documents_link && (
        <div className="mb-5">
          <a href={String(m.documents_link)} target="_blank" rel="noopener noreferrer" className="text-sm text-brand-700 hover:underline">📁 Documents folder →</a>
        </div>
      )}

      {m.notes && (
        <div className="mb-5 p-3 bg-surface-alt border border-border rounded text-sm whitespace-pre-wrap">{String(m.notes)}</div>
      )}

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

      <Section title={`Activities (${data.activities.length})`}>
        <Table
          headers={['Date', 'Type', 'Name', 'Duration', 'Billable']}
          rows={data.activities.map(x => [
            formatDate(x.activity_date),
            LABELS_ACTIVITY_TYPE[x.activity_type as ActivityType] ?? x.activity_type,
            x.name,
            x.duration_hours !== null ? `${Number(x.duration_hours).toFixed(1)}h` : '—',
            x.billable ? '✓' : '',
          ])}
        />
      </Section>

      <RecordHistory targetType="crm_matter" targetId={id} />
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-border rounded-md bg-white px-3 py-2">
      <div className="text-2xs uppercase tracking-wide font-semibold text-ink-muted mb-1">{title}</div>
      <div className="text-base font-medium tabular-nums">{children}</div>
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

// Stint 94 — Engagement bridge card. Sends the user from a CRM matter
// to a freshly-created Tax-Ops parent task in one click. Pre-fills the
// task title + description with matter ref / client / practice areas.
// Respects Rule §14 (no auto-sync, no cross-module FK): a click is a
// user-confirmed manual creation; the matter does not "remember" the
// task. If Diego later wants persistent linkage we add a denormalised
// reference column on crm_matters; for dogfood the lazy approach works.
function EngagementBridge({
  matterId, matter,
}: {
  matterId: string;
  matter: Record<string, string | number | boolean | string[] | null> & {
    client_name?: string;
    matter_reference?: string;
  };
}) {
  const router = useRouter();
  const toast = useToast();
  const [creating, setCreating] = useState(false);

  async function createEngagement() {
    setCreating(true);
    try {
      const matterRef = String(matter.matter_reference ?? '');
      const matterTitle = String(matter.title ?? '(untitled matter)');
      const clientName = matter.client_name ? String(matter.client_name) : '';
      const practiceAreas = Array.isArray(matter.practice_areas) ? matter.practice_areas as string[] : [];
      const taskTitle = clientName
        ? `${clientName} — ${matterTitle}`
        : matterTitle;
      const description = [
        `Engagement spun off from CRM matter ${matterRef}.`,
        clientName ? `Client: ${clientName}.` : null,
        practiceAreas.length ? `Practice areas: ${practiceAreas.join(', ')}.` : null,
        '',
        `Source matter: /crm/matters/${matterId}`,
        '',
        'Add sub-tasks for each compliance workstream, counterparties (CSP, AED, etc.), and deliverables as the engagement progresses.',
      ].filter(Boolean).join('\n');

      const res = await fetch('/api/tax-ops/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: taskTitle,
          description,
          status: 'queued',
          priority: 'medium',
          tags: ['crm-engagement', ...practiceAreas],
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error ?? `HTTP ${res.status}`);
      }
      const body = await res.json() as { id: string };
      toast.success('Tax-Ops engagement created');
      router.push(`/tax-ops/tasks/${body.id}`);
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mb-5 rounded-md border border-brand-200 bg-brand-50/50 px-4 py-3 flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <div className="text-2xs uppercase tracking-wide font-semibold text-brand-700 mb-1">
          Next step · Tax-Ops engagement
        </div>
        <div className="text-sm text-ink leading-snug">
          Spin off the compliance side of this matter into a Tax-Ops parent
          task. Title, client and practice areas are pre-filled; add
          sub-tasks, counterparties and deliverables there.
        </div>
        <div className="text-xs text-ink-muted mt-1">
          No auto-sync (Rule §14): each click creates a new task you can
          flesh out manually.
        </div>
      </div>
      <Button
        variant="primary"
        size="sm"
        iconRight={<ArrowRightIcon size={13} />}
        loading={creating}
        onClick={createEngagement}
      >
        Create engagement
      </Button>
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
