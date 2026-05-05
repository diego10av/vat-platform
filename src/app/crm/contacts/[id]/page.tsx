'use client';

import { useEffect, useState, use, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  PencilIcon, Trash2Icon, MailIcon, PhoneIcon, LinkIcon, GlobeIcon,
  PinIcon, BuildingIcon, TrendingUpIcon, GavelIcon,
  CalendarIcon, MessageCircleIcon, FileTextIcon, CheckSquareIcon,
} from 'lucide-react';
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
  LABELS_LIFECYCLE, LABELS_ENGAGEMENT, LABELS_ACTIVITY_TYPE, LABELS_STAGE,
  ENGAGEMENT_LEVELS,
  formatDate, formatEur, type ActivityType,
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
  // Stint 64.U.3 — related deals + matters surfaced in the sidebar.
  opportunities: Array<{
    id: string; name: string; stage: string;
    estimated_value_eur: number | null;
    weighted_value_eur: number | null;
    estimated_close_date: string | null;
    client_name: string | null;
  }>;
  matters: Array<{
    id: string; matter_reference: string; title: string;
    status: string; practice_areas: string[];
    opening_date: string | null; closing_date: string | null;
    client_name: string | null;
  }>;
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

  // Stint 64.U.3 (N2.5) — full rebuild. Avatar + 2-col layout +
  // pinned notes + visual timeline + related deals/matters sidebar.
  // Compared to the previous flat stack, this version mirrors the
  // detail-page convention used by HubSpot / Clio / Salesforce.
  const initials = computeInitials(String(c.full_name ?? ''));
  const lifecycleLabel = c.lifecycle_stage
    ? LABELS_LIFECYCLE[c.lifecycle_stage as keyof typeof LABELS_LIFECYCLE]
    : null;
  const eng = (c.engagement_override as string | null) ?? (c.engagement_level as string | null);
  const tags = (c.tags as string[] | null) ?? [];
  const roleTags = (c.role_tags as string[] | null) ?? [];
  const areas = (c.areas_of_interest as string[] | null) ?? [];

  return (
    <div className="space-y-4">
      <div className="text-xs text-ink-muted">
        <Link href="/crm/contacts" className="hover:underline">← All contacts</Link>
      </div>

      {/* Pinned notes — yellow sticky banner at top. Always visible
          when content exists; "+ Pin a note" affordance otherwise. */}
      <PinnedNotesBanner
        value={(c.pinned_notes as string | null) ?? null}
        onSave={async v => { await patchField('pinned_notes', v); }}
      />

      {/* Hero card — avatar + name + lifecycle/role chips + actions */}
      <div className="rounded-md border border-border bg-surface p-4">
        <div className="flex items-start gap-4">
          <div
            className={`shrink-0 w-14 h-14 rounded-full flex items-center justify-center font-semibold text-lg ${avatarTone(String(c.full_name ?? ''))}`}
            aria-hidden="true"
          >
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-semibold text-ink truncate">{String(c.full_name ?? '(unnamed)')}</h1>
            <div className="text-sm text-ink-muted truncate">
              {c.job_title ? <span>{String(c.job_title)}</span> : null}
              {c.job_title && c.country ? ' · ' : null}
              {c.country ? <span>{String(c.country)}</span> : null}
            </div>
            {/* Chips: lifecycle + role tags + areas + tags. */}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {lifecycleLabel && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-2xs font-medium bg-brand-50 text-brand-800 border border-brand-200">
                  {lifecycleLabel}
                </span>
              )}
              {roleTags.map(t => (
                <span key={`role:${t}`} className="inline-flex items-center px-2 py-0.5 rounded-full text-2xs bg-amber-50 text-amber-900 border border-amber-200">
                  {t.replace(/_/g, ' ')}
                </span>
              ))}
              {areas.map(t => (
                <span key={`area:${t}`} className="inline-flex items-center px-2 py-0.5 rounded-full text-2xs bg-emerald-50 text-emerald-800 border border-emerald-200">
                  {t.replace(/_/g, ' ')}
                </span>
              ))}
              {tags.map(t => (
                <span key={`tag:${t}`} className="inline-flex items-center px-2 py-0.5 rounded-full text-2xs bg-surface-alt text-ink-soft border border-border">
                  #{t}
                </span>
              ))}
              {c.source ? (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-2xs text-ink-muted">
                  Met via <strong className="ml-1 text-ink-soft">{String(c.source).replace(/_/g, ' ')}</strong>
                </span>
              ) : null}
            </div>
          </div>
          <div className="shrink-0 flex items-center gap-2">
            <MeetingBriefButton contactId={id} contactName={String(c.full_name ?? 'contact')} />
            {eng === 'dormant' || eng === 'lapsed'
              ? <DraftEmailButton targetType="crm_contact" targetId={id} intent="check_in" label="Draft check-in" />
              : <DraftEmailButton targetType="crm_contact" targetId={id} intent="follow_up" label="Draft follow-up" />}
            <Button variant="secondary" size="sm" icon={<PencilIcon size={13} />} onClick={() => setEditOpen(true)}>
              Edit
            </Button>
            <Button variant="ghost" size="sm" icon={<Trash2Icon size={13} />} onClick={handleDelete} loading={deleting}>
              Delete
            </Button>
          </div>
        </div>
      </div>

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

      {/* 2-column layout: main 2/3 (timeline-heavy) + sidebar 1/3
          (related entities + quick info). Mirrors HubSpot / Clio /
          Salesforce contact detail. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          {/* Important dates row */}
          <div className="rounded-md border border-border bg-surface p-3">
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
                  <div className="text-2xs text-ink-faint mt-0.5">{formatBirthday(String(c.birthday))}</div>
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

          {/* Long-form notes (read-only here; edit via modal) */}
          {c.notes ? (
            <div className="rounded-md border border-border bg-surface p-3">
              <div className="text-2xs uppercase tracking-wide font-semibold text-ink-muted mb-1">Notes</div>
              <p className="text-sm text-ink-soft whitespace-pre-wrap">{String(c.notes)}</p>
            </div>
          ) : null}

          {/* Lead score badge — only when scored */}
          {(c.lifecycle_stage === 'lead' || c.lifecycle_stage === 'prospect') && c.lead_score !== null && c.lead_score !== undefined && (
            <div className="rounded-md border border-border bg-surface p-3 flex items-start gap-3">
              <div
                className={`shrink-0 w-12 h-12 rounded-full flex items-center justify-center font-semibold text-base tabular-nums ${
                  Number(c.lead_score) >= 70 ? 'bg-emerald-100 text-emerald-800'
                  : Number(c.lead_score) >= 40 ? 'bg-amber-100 text-amber-800'
                  : 'bg-danger-50 text-danger-700'
                }`}
              >
                {Number(c.lead_score)}
              </div>
              <div className="flex-1">
                <div className="text-2xs uppercase tracking-wide font-semibold text-ink-muted">
                  Lead score{c.lead_score_updated_at ? ` · updated ${new Date(String(c.lead_score_updated_at)).toLocaleDateString('en-GB')}` : ''}
                </div>
                <p className="text-sm text-ink-soft whitespace-pre-wrap mt-0.5">
                  {c.lead_score_reasoning ? String(c.lead_score_reasoning) : <span className="italic text-ink-muted">Will be scored on next monthly run.</span>}
                </p>
              </div>
            </div>
          )}

          {/* Activity timeline — visual, with icons by type */}
          <ActivityTimeline activities={data.activities} />

          {/* Audit history */}
          <RecordHistory targetType="crm_contact" targetId={id} />
        </div>

        {/* Sidebar — quick info + related entities */}
        <aside className="space-y-4">
          {/* Contact details */}
          <div className="rounded-md border border-border bg-surface p-3">
            <div className="text-2xs uppercase tracking-wide font-semibold text-ink-muted mb-2">Contact details</div>
            <ul className="space-y-1.5 text-sm">
              <SidebarRow icon={<MailIcon size={13} />} label="Email">
                {c.email
                  ? <a href={`mailto:${c.email}`} className="text-brand-700 hover:underline truncate">{String(c.email)}</a>
                  : <span className="text-ink-faint">—</span>}
              </SidebarRow>
              <SidebarRow icon={<PhoneIcon size={13} />} label="Phone">
                {c.phone
                  ? <a href={`tel:${c.phone}`} className="hover:underline">{String(c.phone)}</a>
                  : <span className="text-ink-faint">—</span>}
              </SidebarRow>
              <SidebarRow icon={<LinkIcon size={13} />} label="LinkedIn">
                {c.linkedin_url
                  ? <a href={String(c.linkedin_url)} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline">Profile ↗</a>
                  : <span className="text-ink-faint">—</span>}
              </SidebarRow>
              <SidebarRow icon={<GlobeIcon size={13} />} label="Country">
                {c.country ? String(c.country) : <span className="text-ink-faint">—</span>}
              </SidebarRow>
            </ul>
          </div>

          {/* Engagement chip select */}
          <div className="rounded-md border border-border bg-surface p-3">
            <div className="text-2xs uppercase tracking-wide font-semibold text-ink-muted mb-2">Engagement</div>
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
          </div>

          {/* Employment current + history (component lives below) */}
          <EmploymentSidebar contactId={id} companies={data.companies} onChanged={() => load()} />

          {/* Related opportunities */}
          <RelatedOpportunities opportunities={data.opportunities} />

          {/* Related matters */}
          <RelatedMatters matters={data.matters} />
        </aside>
      </div>
    </div>
  );
}

// Stint 64.Q.5 + 64.U.3 — Employment sidebar. Compact version of the
// pre-N2.5 EmploymentSection: same data (current + previous firms +
// Switch firm modal) but rendered as a vertical card list instead of
// a wide table. Fits into the right sidebar of the new 2-column
// layout without horizontal scroll.
function EmploymentSidebar({
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
    <div className="rounded-md border border-border bg-surface p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-2xs uppercase tracking-wide font-semibold text-ink-muted">
          Employment ({companies.length})
        </span>
        <button
          type="button"
          onClick={() => setSwitchOpen(true)}
          className="text-2xs text-brand-700 hover:underline"
        >
          {current.length > 0 ? '↻ Switch' : '+ Add'}
        </button>
      </div>
      {current.length > 0 ? (
        <div className="space-y-1.5">
          {current.map(c => (
            <div key={c.junction_id} className="flex items-start gap-2">
              <BuildingIcon size={13} className="mt-0.5 text-ink-muted shrink-0" />
              <div className="flex-1 min-w-0 text-sm">
                <Link href={`/crm/companies/${c.id}`} className="text-brand-700 hover:underline font-medium truncate block">
                  {c.company_name}
                </Link>
                <div className="text-2xs text-ink-muted">
                  {c.role.replace(/_/g, ' ')}
                  {c.is_primary ? <span className="ml-1 text-amber-600">★</span> : null}
                  {c.started_at ? <span> · since {formatDate(c.started_at)}</span> : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-ink-muted italic">No current firm.</p>
      )}
      {past.length > 0 && (
        <details className="mt-3 group">
          <summary className="text-2xs uppercase tracking-wide font-semibold text-ink-muted cursor-pointer hover:text-ink list-none">
            <span className="group-open:hidden">▶ Previous firms ({past.length})</span>
            <span className="hidden group-open:inline">▼ Previous firms ({past.length})</span>
          </summary>
          <div className="mt-2 space-y-1.5">
            {past.map(c => (
              <div key={c.junction_id} className="flex items-start gap-2 text-ink-soft">
                <BuildingIcon size={11} className="mt-0.5 text-ink-faint shrink-0" />
                <div className="flex-1 min-w-0 text-xs">
                  <Link href={`/crm/companies/${c.id}`} className="hover:text-brand-700 hover:underline truncate block">
                    {c.company_name}
                  </Link>
                  <div className="text-2xs text-ink-faint">
                    {c.role.replace(/_/g, ' ')}
                    {c.started_at ? <span> · {formatDate(c.started_at)}</span> : null}
                    {c.ended_at ? <span> – {formatDate(c.ended_at)}</span> : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
      {switchOpen && (
        <SwitchFirmModal
          contactId={contactId}
          onClose={() => setSwitchOpen(false)}
          onDone={() => { setSwitchOpen(false); onChanged(); }}
        />
      )}
    </div>
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
    <div className="fixed inset-0 z-modal bg-ink/75 backdrop-blur-[6px] flex items-center justify-center p-4" onClick={onClose}>
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

// ─────────────────── Stint 64.U.3 — N2.5 helpers ─────────────────────

function computeInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

// Deterministic avatar background tone derived from the name. Same
// person → same colour every time. Six pastel tones to spread evenly.
const AVATAR_TONES = [
  'bg-brand-100 text-brand-800',
  'bg-amber-100 text-amber-900',
  'bg-emerald-100 text-emerald-800',
  'bg-blue-100 text-blue-800',
  'bg-purple-100 text-purple-800',
  'bg-rose-100 text-rose-800',
];
function avatarTone(fullName: string): string {
  let hash = 0;
  for (let i = 0; i < fullName.length; i += 1) hash = (hash * 31 + fullName.charCodeAt(i)) | 0;
  return AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length]!;
}

// Pinned notes — sticky-note banner at the top of the detail page.
// Saves on blur. Empty state offers a "+ Pin a note" affordance so
// the slot stays low-noise when unused.
function PinnedNotesBanner({
  value, onSave,
}: {
  value: string | null;
  onSave: (next: string | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');

  useEffect(() => { setDraft(value ?? ''); }, [value]);

  async function commit() {
    const trimmed = draft.trim();
    const next = trimmed || null;
    setEditing(false);
    if ((next ?? '') !== (value ?? '')) {
      await onSave(next);
    }
  }

  if (!editing && !value) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink"
      >
        <PinIcon size={11} /> + Pin a note (allergies, timezone, scheduling preference, …)
      </button>
    );
  }

  return (
    <div className="rounded-md border-l-4 border-amber-400 bg-amber-50 px-3 py-2 flex items-start gap-2">
      <PinIcon size={13} className="mt-0.5 text-amber-700 shrink-0" />
      <div className="flex-1 min-w-0">
        {editing ? (
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { setEditing(false); setDraft(value ?? ''); }
              else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void commit(); }
            }}
            rows={2}
            className="w-full bg-transparent text-sm text-amber-900 focus:outline-none resize-none"
            placeholder="Pinned reminder for this contact (Cmd+Enter to save)"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-left text-sm text-amber-900 whitespace-pre-wrap w-full"
            title="Click to edit pinned note"
          >
            {value}
          </button>
        )}
      </div>
      {value && !editing && (
        <button
          type="button"
          onClick={() => { setDraft(''); void onSave(null); }}
          className="shrink-0 text-2xs text-amber-700 hover:text-amber-900"
          title="Remove pinned note"
        >
          ✕
        </button>
      )}
    </div>
  );
}

// Sidebar row: icon + label + value, used in the "Contact details"
// card. Compact, scannable, copy-safe (email/phone preserve mailto/tel).
function SidebarRow({
  icon, label, children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-2 min-w-0">
      <span className="text-ink-muted shrink-0" aria-hidden="true">{icon}</span>
      <span className="text-2xs uppercase tracking-wide text-ink-muted shrink-0 w-16">{label}</span>
      <span className="flex-1 min-w-0 truncate">{children}</span>
    </li>
  );
}

// Activity timeline — chronological list of activities with icons per
// type. Replaces the previous flat table; same data, just visual.
const ACTIVITY_ICON: Record<string, React.ReactNode> = {
  call:     <PhoneIcon size={13} />,
  email:    <MailIcon size={13} />,
  meeting:  <CalendarIcon size={13} />,
  note:     <FileTextIcon size={13} />,
  task:     <CheckSquareIcon size={13} />,
};

function ActivityTimeline({
  activities,
}: {
  activities: ContactDetail['activities'];
}) {
  if (activities.length === 0) {
    return (
      <div className="rounded-md border border-border bg-surface p-3">
        <div className="text-2xs uppercase tracking-wide font-semibold text-ink-muted mb-2">Activity timeline</div>
        <p className="text-sm text-ink-muted italic">
          No activities logged yet. Activities are interactions with this contact (calls, emails, meetings).
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-2xs uppercase tracking-wide font-semibold text-ink-muted">
          Activity timeline ({activities.length})
        </span>
      </div>
      <ol className="relative space-y-3 pl-5 before:absolute before:left-1.5 before:top-1 before:bottom-1 before:w-px before:bg-border">
        {activities.map(a => {
          const icon = ACTIVITY_ICON[a.activity_type as keyof typeof ACTIVITY_ICON] ?? <MessageCircleIcon size={13} />;
          return (
            <li key={a.id} className="relative">
              <span
                aria-hidden="true"
                className="absolute -left-3.5 top-0.5 w-5 h-5 rounded-full bg-surface border border-border flex items-center justify-center text-ink-muted"
              >
                {icon}
              </span>
              <div className="text-2xs text-ink-muted tabular-nums">
                {formatDate(a.activity_date)}
                {a.duration_hours !== null && ` · ${Number(a.duration_hours).toFixed(1)}h`}
                {a.billable && ' · billable'}
              </div>
              <div className="text-sm text-ink font-medium truncate">
                {LABELS_ACTIVITY_TYPE[a.activity_type as ActivityType] ?? a.activity_type} · {a.name}
              </div>
              {a.outcome && (
                <p className="mt-0.5 text-xs text-ink-soft whitespace-pre-wrap">{a.outcome}</p>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// Related opportunities sidebar panel.
function RelatedOpportunities({
  opportunities,
}: {
  opportunities: ContactDetail['opportunities'];
}) {
  if (opportunities.length === 0) {
    return (
      <div className="rounded-md border border-border bg-surface p-3">
        <div className="text-2xs uppercase tracking-wide font-semibold text-ink-muted mb-1">Opportunities</div>
        <p className="text-xs text-ink-muted italic">None linked.</p>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <div className="text-2xs uppercase tracking-wide font-semibold text-ink-muted mb-2 flex items-center gap-1">
        <TrendingUpIcon size={13} className="text-ink-muted" />
        Opportunities ({opportunities.length})
      </div>
      <ul className="space-y-1.5">
        {opportunities.map(o => (
          <li key={o.id}>
            <Link
              href={`/crm/opportunities/${o.id}`}
              className="block group hover:bg-surface-alt rounded px-1.5 py-1 -mx-1.5"
            >
              <div className="text-sm font-medium text-brand-700 group-hover:underline truncate">{o.name}</div>
              <div className="text-2xs text-ink-muted truncate">
                {LABELS_STAGE[o.stage as keyof typeof LABELS_STAGE] ?? o.stage}
                {o.client_name ? ` · ${o.client_name}` : ''}
                {o.weighted_value_eur !== null && o.weighted_value_eur !== undefined
                  ? ` · ${formatEur(o.weighted_value_eur)} weighted`
                  : ''}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Related matters sidebar panel.
function RelatedMatters({
  matters,
}: {
  matters: ContactDetail['matters'];
}) {
  if (matters.length === 0) {
    return (
      <div className="rounded-md border border-border bg-surface p-3">
        <div className="text-2xs uppercase tracking-wide font-semibold text-ink-muted mb-1">Matters</div>
        <p className="text-xs text-ink-muted italic">None linked.</p>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <div className="text-2xs uppercase tracking-wide font-semibold text-ink-muted mb-2 flex items-center gap-1">
        <GavelIcon size={13} className="text-ink-muted" />
        Matters ({matters.length})
      </div>
      <ul className="space-y-1.5">
        {matters.map(m => (
          <li key={m.id}>
            <Link
              href={`/crm/matters/${m.id}`}
              className="block group hover:bg-surface-alt rounded px-1.5 py-1 -mx-1.5"
            >
              <div className="text-sm font-medium text-brand-700 group-hover:underline truncate">
                {m.matter_reference}: {m.title}
              </div>
              <div className="text-2xs text-ink-muted truncate">
                {m.status}{m.client_name ? ` · ${m.client_name}` : ''}
                {m.practice_areas.length > 0 ? ` · ${m.practice_areas.join(', ')}` : ''}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
