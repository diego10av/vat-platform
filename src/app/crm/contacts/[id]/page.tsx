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
import { CONTACT_FIELDS } from '@/components/crm/schemas';
import {
  LABELS_LIFECYCLE, LABELS_ENGAGEMENT, LABELS_ACTIVITY_TYPE,
  formatDate, type ActivityType,
} from '@/lib/crm-types';

interface ContactDetail {
  contact: Record<string, unknown>;
  companies: Array<{ id: string; company_name: string; classification: string | null; role: string; is_primary: boolean }>;
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
      <div className="text-[11.5px] text-ink-muted mb-2">
        <Link href="/crm/contacts" className="hover:underline">← All contacts</Link>
      </div>
      <PageHeader
        title={String(c.full_name ?? '(unnamed)')}
        subtitle={`${c.job_title ?? ''}${c.country ? ` · ${c.country}` : ''}${c.lifecycle_stage ? ` · ${LABELS_LIFECYCLE[c.lifecycle_stage as keyof typeof LABELS_LIFECYCLE]}` : ''}`}
        actions={
          <>
            <MeetingBriefButton contactId={id} contactName={String(c.full_name ?? 'contact')} />
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
        <Card title="Email">{c.email ? <a href={`mailto:${c.email}`} className="text-brand-700 hover:underline">{String(c.email)}</a> : '—'}</Card>
        <Card title="Phone">{c.phone ? <a href={`tel:${c.phone}`} className="hover:underline">{String(c.phone)}</a> : '—'}</Card>
        <Card title="LinkedIn">{c.linkedin_url ? <a href={String(c.linkedin_url)} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline">Profile →</a> : '—'}</Card>
        <Card title="Engagement">{eng ? LABELS_ENGAGEMENT[eng as keyof typeof LABELS_ENGAGEMENT] : '—'}</Card>
      </div>

      {(c.next_follow_up || c.birthday || c.client_anniversary) && (
        <div className="mb-5 p-3 border border-border rounded-md bg-white">
          <div className="text-[10.5px] uppercase tracking-wide font-semibold text-ink-muted mb-2">Important dates</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[12.5px]">
            {c.next_follow_up && (
              <div>
                <div className="text-[10px] uppercase text-ink-muted mb-0.5">📞 Next follow-up</div>
                <div className="tabular-nums">{formatDate(String(c.next_follow_up))}</div>
              </div>
            )}
            {c.birthday && (
              <div>
                <div className="text-[10px] uppercase text-ink-muted mb-0.5">🎂 Birthday</div>
                <div className="tabular-nums">{formatBirthday(String(c.birthday))}</div>
              </div>
            )}
            {c.client_anniversary && (
              <div>
                <div className="text-[10px] uppercase text-ink-muted mb-0.5">🥂 Relationship since</div>
                <div className="tabular-nums">{formatDate(String(c.client_anniversary))}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {c.notes && (
        <div className="mb-5 p-3 bg-surface-alt border border-border rounded text-[12.5px] whitespace-pre-wrap">{String(c.notes)}</div>
      )}

      {(c.lifecycle_stage === 'lead' || c.lifecycle_stage === 'prospect') && c.lead_score !== null && c.lead_score !== undefined && (
        <div className="mb-5 p-3 border border-border rounded bg-white flex items-start gap-3">
          <div className="shrink-0">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center font-semibold text-[14px] tabular-nums ${
              Number(c.lead_score) >= 70 ? 'bg-emerald-100 text-emerald-800'
              : Number(c.lead_score) >= 40 ? 'bg-amber-100 text-amber-800'
              : 'bg-danger-50 text-danger-700'
            }`}>
              {Number(c.lead_score)}
            </div>
          </div>
          <div className="flex-1">
            <div className="text-[10.5px] uppercase tracking-wide font-semibold text-ink-muted mb-0.5">
              Lead score {c.lead_score_updated_at ? `· updated ${new Date(String(c.lead_score_updated_at)).toLocaleDateString('en-GB')}` : ''}
            </div>
            <div className="text-[12px] text-ink-soft whitespace-pre-wrap">
              {c.lead_score_reasoning ? String(c.lead_score_reasoning) : <span className="italic text-ink-muted">Will be scored on next monthly run.</span>}
            </div>
          </div>
        </div>
      )}

      <Section title={`Companies (${data.companies.length})`}>
        <Table
          headers={['Company', 'Classification', 'Role', 'Primary?']}
          rows={data.companies.map(x => [
            <Link key={x.id} href={`/crm/companies/${x.id}`} className="text-brand-700 hover:underline">{x.company_name}</Link>,
            x.classification ?? '—',
            x.role,
            x.is_primary ? '✓' : '',
          ])}
        />
      </Section>

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
      <div className="text-[10px] uppercase tracking-wide font-semibold text-ink-muted mb-1">{title}</div>
      <div className="text-[13px]">{children}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h3 className="text-[12px] uppercase tracking-wide font-semibold text-ink-muted mb-2">{title}</h3>
      {children}
    </div>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: React.ReactNode[][] }) {
  if (rows.length === 0) return <div className="text-[12px] text-ink-muted italic px-3 py-2">None</div>;
  return (
    <div className="border border-border rounded-md overflow-hidden bg-white">
      <table className="w-full text-[12px]">
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
