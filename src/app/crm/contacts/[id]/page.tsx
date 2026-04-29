'use client';

import { useEffect, useState, use, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PencilIcon, Trash2Icon } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/Toaster';
import { CrmFormModal } from '@/components/crm/CrmFormModal';
import { RecordHistory } from '@/components/crm/RecordHistory';
import { MeetingBriefButton } from '@/components/crm/MeetingBriefButton';
import { DraftEmailButton } from '@/components/crm/DraftEmailButton';
import { CONTACT_FIELDS } from '@/components/crm/schemas';
// Stint 63.M — inline-edit primitives on contact detail Cards.
import { InlineDateCell } from '@/components/tax-ops/inline-editors';
import { ChipSelect } from '@/components/tax-ops/ChipSelect';
import {
  LABELS_LIFECYCLE, LABELS_ENGAGEMENT, LABELS_ACTIVITY_TYPE,
  ENGAGEMENT_LEVELS,
  formatDate, type ActivityType,
} from '@/lib/crm-types';

interface ContactDetail {
  contact: Record<string, unknown>;
  // Stint 64.Q.5 — companies now carry employment dates (started_at,
  // ended_at). The UI splits them into "current" (ended_at IS NULL)
  // and "history" (ended_at set) sections.
  companies: Array<{
    junction_id: string;
    id: string;
    company_name: string;
    classification: string | null;
    role: string;
    is_primary: boolean;
    started_at: string | null;
    ended_at:   string | null;
    junction_notes: string | null;
  }>;
  activities: Array<{ id: string; name: string; activity_type: string; activity_date: string; duration_hours: number | null; billable: boolean; outcome: string | null }>;
}

export default function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const toast = useToast();
  const [data, setData] = useState<ContactDetail | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/crm/contacts/${id}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(setData)
      .catch(() => setData(null));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function handleUpdate(values: Record<string, unknown>) {
    const res = await fetch(`/api/crm/contacts/${id}`, {
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

  // Stint 63.M — single-field PUT for inline-editable Cards.
  async function patchField(field: string, value: unknown) {
    try {
      const res = await fetch(`/api/crm/contacts/${id}`, {
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
    const name = String((data?.contact as { full_name?: string })?.full_name ?? '?');
    if (!confirm(`Delete "${name}"?\n\nIt goes to the trash for 30 days — you can restore it from /crm/trash.`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/crm/contacts/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err?.error?.message ?? `Delete failed (${res.status})`);
        return;
      }
      toast.withAction('success', 'Contact moved to trash', 'Will auto-purge after 30 days.', {
        label: 'Undo',
        onClick: async () => {
          const restore = await fetch(`/api/crm/trash/contact/${id}`, { method: 'POST' });
          if (restore.ok) {
            toast.success('Contact restored');
            router.push(`/crm/contacts/${id}`);
          } else {
            toast.error('Undo failed — restore manually from /crm/trash');
          }
        },
      });
      router.push('/crm/contacts');
    } finally {
      setDeleting(false);
    }
  }

  if (!data) return <PageSkeleton />;
  const c = data.contact as Record<string, string | number | string[] | boolean | null>;
  const eng = (c.engagement_override ?? c.engagement_level) as string | null;

  return (
    <div>
      <div className="text-xs text-ink-muted mb-2">
        <Link href="/crm/contacts" className="hover:underline">← All contacts</Link>
      </div>
      <PageHeader
        title={String(c.full_name ?? '(unnamed)')}
        subtitle={`${c.job_title ?? ''}${c.country ? ` · ${c.country}` : ''}${c.lifecycle_stage ? ` · ${LABELS_LIFECYCLE[c.lifecycle_stage as keyof typeof LABELS_LIFECYCLE]}` : ''}`}
        actions={
          <>
            <MeetingBriefButton contactId={id} contactName={String(c.full_name ?? 'contact')} />
            {(() => {
              const eng = (c.engagement_override as string | null) ?? (c.engagement_level as string | null);
              if (eng === 'dormant' || eng === 'lapsed') {
                return <DraftEmailButton targetType="crm_contact" targetId={id} intent="check_in" label="Draft check-in" />;
              }
              return <DraftEmailButton targetType="crm_contact" targetId={id} intent="follow_up" label="Draft follow-up" />;
            })()}
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
        title="Edit contact"
        subtitle={String(c.full_name ?? '')}
        fields={CONTACT_FIELDS}
        initial={{
          full_name: c.full_name,
          job_title: c.job_title,
          email: c.email,
          phone: c.phone,
          linkedin_url: c.linkedin_url,
          country: c.country,
          preferred_language: c.preferred_language,
          lifecycle_stage: c.lifecycle_stage,
          role_tags: c.role_tags ?? [],
          areas_of_interest: c.areas_of_interest ?? [],
          engagement_override: c.engagement_override,
          source: c.source,
          consent_status: c.consent_status,
          next_follow_up: c.next_follow_up,
          birthday: c.birthday,
          client_anniversary: c.client_anniversary,
          notes: c.notes,
          tags: c.tags ?? [],
        }}
        onSave={handleUpdate}
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-5">
        {/* Email/Phone/LinkedIn stay as click-to-action links —
            inline-editing them would break the mailto/tel/external link
            UX. Edit them via the modal. */}
        <Card title="Email">{c.email ? <a href={`mailto:${c.email}`} className="text-brand-700 hover:underline">{String(c.email)}</a> : '—'}</Card>
        <Card title="Phone">{c.phone ? <a href={`tel:${c.phone}`} className="hover:underline">{String(c.phone)}</a> : '—'}</Card>
        <Card title="LinkedIn">{c.linkedin_url ? <a href={String(c.linkedin_url)} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline">Profile →</a> : '—'}</Card>
        {/* Engagement override — inline-editable. */}
        <Card title="Engagement">
          <ChipSelect
            value={String(c.engagement_override ?? '')}
            options={[
              { value: '', label: '— auto —', tone: 'bg-surface-alt text-ink-faint' },
              ...ENGAGEMENT_LEVELS.map(v => ({
                value: v,
                label: LABELS_ENGAGEMENT[v],
              })),
            ]}
            onChange={next => { void patchField('engagement_override', next || null); }}
            ariaLabel="Engagement override"
          />
        </Card>
      </div>

      {/* Important dates — always visible now (was only shown when at
          least one was set; making them inline-editable means Diego
          needs the slots visible to fill them in). */}
      <div className="mb-5 p-3 border border-border rounded-md bg-white">
        <div className="text-2xs uppercase tracking-wide font-semibold text-ink-muted mb-2">Important dates</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <div>
            <div className="text-2xs uppercase text-ink-muted mb-0.5">📞 Next follow-up</div>
            <InlineDateCell
              value={c.next_follow_up as string | null}
              onSave={async v => { await patchField('next_follow_up', v); }}
            />
          </div>
          <div>
            <div className="text-2xs uppercase text-ink-muted mb-0.5">🎂 Birthday</div>
            <InlineDateCell
              value={c.birthday as string | null}
              onSave={async v => { await patchField('birthday', v); }}
              mode="neutral"
            />
            {c.birthday && (
              <div className="text-2xs text-ink-faint mt-0.5">
                Display: {formatBirthday(String(c.birthday))}
              </div>
            )}
          </div>
          <div>
            <div className="text-2xs uppercase text-ink-muted mb-0.5">🥂 Relationship since</div>
            <InlineDateCell
              value={c.client_anniversary as string | null}
              onSave={async v => { await patchField('client_anniversary', v); }}
              mode="neutral"
            />
          </div>
        </div>
      </div>

      {c.notes && (
        <div className="mb-5 p-3 bg-surface-alt border border-border rounded text-sm whitespace-pre-wrap">{String(c.notes)}</div>
      )}

      {(c.lifecycle_stage === 'lead' || c.lifecycle_stage === 'prospect') && c.lead_score !== null && c.lead_score !== undefined && (
        <div className="mb-5 p-3 border border-border rounded bg-white flex items-start gap-3">
          <div className="shrink-0">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center font-semibold text-base tabular-nums ${
              Number(c.lead_score) >= 70 ? 'bg-emerald-100 text-emerald-800'
              : Number(c.lead_score) >= 40 ? 'bg-amber-100 text-amber-800'
              : 'bg-danger-50 text-danger-700'
            }`}>
              {Number(c.lead_score)}
            </div>
          </div>
          <div className="flex-1">
            <div className="text-2xs uppercase tracking-wide font-semibold text-ink-muted mb-0.5">
              Lead score {c.lead_score_updated_at ? `· updated ${new Date(String(c.lead_score_updated_at)).toLocaleDateString('en-GB')}` : ''}
            </div>
            <div className="text-sm text-ink-soft whitespace-pre-wrap">
              {c.lead_score_reasoning ? String(c.lead_score_reasoning) : <span className="italic text-ink-muted">Will be scored on next monthly run.</span>}
            </div>
          </div>
        </div>
      )}

      {/* Stint 64.Q.5 — Employment current vs history. Diego: "si
          cambian de empresa tener la opción de cambiar el nombre de
          la empresa pero de poder ver el historial y donde estaban
          trabajando antes." */}
      <EmploymentSection contactId={id} companies={data.companies} onChanged={() => load()} />

      <Section title={`Activities (${data.activities.length})`}>
        <Table
          headers={['Date', 'Type', 'Name', 'Duration', 'Billable', 'Outcome']}
          rows={data.activities.map(x => [
            formatDate(x.activity_date),
            LABELS_ACTIVITY_TYPE[x.activity_type as ActivityType] ?? x.activity_type,
            x.name,
            x.duration_hours !== null ? `${Number(x.duration_hours).toFixed(1)}h` : '—',
            x.billable ? '✓' : '',
            x.outcome ?? '—',
          ])}
        />
      </Section>

      <RecordHistory targetType="crm_contact" targetId={id} />
    </div>
  );
}

// Stint 64.Q.5 — Employment section. Splits the contact's company
// junctions into "current" (ended_at IS NULL) + "previous" rows,
// shows tenure, and gives a Switch firm... button that POSTs to
// /api/crm/contacts/[id]/companies (closes current, opens new).
function EmploymentSection({
  contactId, companies, onChanged,
}: {
  contactId: string;
  companies: ContactDetail['companies'];
  onChanged: () => void;
}) {
  const current = companies.filter(c => !c.ended_at);
  const past    = companies.filter(c =>  c.ended_at);
  const [switchOpen, setSwitchOpen] = useState(false);

  return (
    <Section title={`Employment (${companies.length})`}>
      <div className="space-y-3">
        {current.length > 0 ? (
          <div>
            <h4 className="text-2xs uppercase tracking-wide font-semibold text-ink-muted mb-1">Current</h4>
            <Table
              headers={['Company', 'Role', 'Since', 'Primary?']}
              rows={current.map(x => [
                <Link key={x.junction_id} href={`/crm/companies/${x.id}`} className="text-brand-700 hover:underline">{x.company_name}</Link>,
                x.role,
                x.started_at ? formatDate(x.started_at) : '—',
                x.is_primary ? '✓' : '',
              ])}
            />
          </div>
        ) : (
          <p className="text-sm text-ink-muted italic">No current firm — independent / between roles.</p>
        )}

        {past.length > 0 && (
          <div>
            <h4 className="text-2xs uppercase tracking-wide font-semibold text-ink-muted mb-1">Previous firms</h4>
            <Table
              headers={['Company', 'Role', 'From', 'To']}
              rows={past.map(x => [
                <Link key={x.junction_id} href={`/crm/companies/${x.id}`} className="text-ink hover:text-brand-700 hover:underline">{x.company_name}</Link>,
                x.role,
                x.started_at ? formatDate(x.started_at) : '—',
                x.ended_at ? formatDate(x.ended_at) : '—',
              ])}
            />
          </div>
        )}

        <div>
          <button
            type="button"
            onClick={() => setSwitchOpen(true)}
            className="text-xs text-brand-700 hover:underline"
          >
            {current.length > 0 ? '↻ Switch firm…' : '+ Add current firm…'}
          </button>
        </div>
      </div>
      {switchOpen && (
        <SwitchFirmModal
          contactId={contactId}
          onClose={() => setSwitchOpen(false)}
          onDone={() => { setSwitchOpen(false); onChanged(); }}
        />
      )}
    </Section>
  );
}

function SwitchFirmModal({
  contactId, onClose, onDone,
}: {
  contactId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [companies, setCompanies] = useState<Array<{ id: string; company_name: string }>>([]);
  const [companyId, setCompanyId] = useState('');
  const [role, setRole] = useState('main_poc');
  const [startedAt, setStartedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    fetch('/api/crm/companies?limit=500', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : [])
      .then((rows: Array<{ id: string; company_name: string }>) => setCompanies(rows ?? []))
      .catch(() => { /* ignore */ });
  }, []);

  async function submit() {
    if (!companyId) { setError('Pick a company'); return; }
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/crm/contacts/${contactId}/companies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, role, started_at: startedAt, is_primary: true }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b?.error?.message ?? `HTTP ${res.status}`);
      }
      toast.success('Firm switched');
      onDone();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-modal bg-ink/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-surface rounded-lg shadow-xl max-w-md w-full p-4 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold">Switch firm</h3>
        <p className="text-xs text-ink-muted">
          The current employment will be closed (ended_at = day before the new start), and a new one will open. The previous firm stays in the history.
        </p>
        <label className="block">
          <span className="text-2xs uppercase font-semibold text-ink-muted block mb-1">New firm</span>
          <select
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            className="w-full h-9 px-2 text-sm border border-border rounded-md bg-white"
          >
            <option value="">— Pick a company —</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-2xs uppercase font-semibold text-ink-muted block mb-1">Role</span>
          <input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-full h-9 px-2 text-sm border border-border rounded-md bg-white"
          />
        </label>
        <label className="block">
          <span className="text-2xs uppercase font-semibold text-ink-muted block mb-1">Started on</span>
          <input
            type="date"
            value={startedAt}
            onChange={(e) => setStartedAt(e.target.value)}
            className="w-full h-9 px-2 text-sm border border-border rounded-md bg-white"
          />
        </label>
        {error && <p className="text-xs text-danger-700">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="h-8 px-3 text-sm rounded-md border border-border text-ink-soft hover:bg-surface-alt"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !companyId}
            className="h-8 px-3 text-sm rounded-md bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Switch firm'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Birthdays: year is a placeholder (the anniversary UX only cares
// about month/day). Render "3 Oct" without the year to reduce noise.
function formatBirthday(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
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
