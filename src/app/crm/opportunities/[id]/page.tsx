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
import { OPPORTUNITY_FIELDS } from '@/components/crm/schemas';
// Stint 63.M — inline-edit primitives on the detail Cards.
import { InlineTextCell, InlineDateCell } from '@/components/tax-ops/inline-editors';
// Stint 91 — inline reassign of company + primary contact on detail page.
import { InlineEntitySelect } from '@/components/crm/InlineEntitySelect';
import {
  LABELS_STAGE, LABELS_ACTIVITY_TYPE, formatEur, formatDate,
  type ActivityType,
} from '@/lib/crm-types';

interface OppDetail {
  opportunity: Record<string, unknown>;
  activities: Array<{ id: string; name: string; activity_type: string; activity_date: string; duration_hours: number | null; billable: boolean; outcome: string | null; notes: string | null }>;
}

export default function OpportunityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const toast = useToast();
  const [data, setData] = useState<OppDetail | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/crm/opportunities/${id}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(setData)
      .catch(() => setData(null));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function handleUpdate(values: Record<string, unknown>) {
    const res = await fetch(`/api/crm/opportunities/${id}`, {
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

  // Stint 63.M — single-field PUT for the inline Cards.
  // Numeric fields get coerced; everything else passes through.
  async function patchField(field: string, value: unknown) {
    let coerced = value;
    if ((field === 'estimated_value_eur' || field === 'probability_pct')
        && typeof value === 'string') {
      const trimmed = value.trim().replace(/[,€%]/g, '');
      if (trimmed === '') coerced = null;
      else {
        const n = Number(trimmed);
        coerced = Number.isFinite(n) ? n : null;
      }
    }
    try {
      const res = await fetch(`/api/crm/opportunities/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: coerced }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (e) {
      toast.error(`Save failed: ${String(e instanceof Error ? e.message : e)}`);
    }
  }

  async function handleDelete() {
    const name = String((data?.opportunity as { name?: string })?.name ?? '?');
    if (!confirm(`Delete opportunity "${name}"?\n\nGoes to trash for 30 days.`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/crm/opportunities/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err?.error?.message ?? `Delete failed (${res.status})`);
        return;
      }
      toast.withAction('success', 'Opportunity moved to trash', 'Will auto-purge after 30 days.', {
        label: 'Undo',
        onClick: async () => {
          const restore = await fetch(`/api/crm/trash/opportunity/${id}`, { method: 'POST' });
          if (restore.ok) {
            toast.success('Opportunity restored');
            router.push(`/crm/opportunities/${id}`);
          } else {
            toast.error('Undo failed — restore manually from /crm/trash');
          }
        },
      });
      router.push('/crm/opportunities');
    } finally {
      setDeleting(false);
    }
  }

  if (!data) return <PageSkeleton />;
  const o = data.opportunity as Record<string, string | number | string[] | null> & { company_name?: string; primary_contact_name?: string; company_id?: string; primary_contact_id?: string };

  return (
    <div>
      <div className="text-xs text-ink-muted mb-2">
        <Link href="/crm/opportunities" className="hover:underline">← All opportunities</Link>
      </div>
      <PageHeader
        title={String(o.name ?? '(unnamed)')}
        subtitle={`${o.stage ? LABELS_STAGE[o.stage as keyof typeof LABELS_STAGE] : ''}${o.company_name ? ` · ${o.company_name}` : ''}`}
        actions={
          <>
            <Button variant="secondary" size="sm" icon={<PencilIcon size={13} />} onClick={() => setEditOpen(true)}>Edit</Button>
            <Button variant="ghost" size="sm" icon={<Trash2Icon size={13} />} onClick={handleDelete} loading={deleting}>Delete</Button>
          </>
        }
      />
      <CrmFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        mode="edit"
        title="Edit opportunity"
        subtitle={String(o.name ?? '')}
        fields={OPPORTUNITY_FIELDS}
        initial={{
          name: o.name,
          // Stint 91 — surface company + primary contact in the Edit
          // modal. Both columns existed in DB + API; just the modal
          // wasn't pre-populating them, so opening Edit silently
          // cleared the link on save.
          company_id: o.company_id,
          primary_contact_id: o.primary_contact_id,
          stage: o.stage,
          practice_areas: o.practice_areas ?? [],
          source: o.source,
          estimated_value_eur: o.estimated_value_eur,
          probability_pct: o.probability_pct,
          first_contact_date: o.first_contact_date,
          estimated_close_date: o.estimated_close_date,
          next_action: (o as Record<string, string | null>).next_action,
          next_action_due: (o as Record<string, string | null>).next_action_due,
          loss_reason: (o as Record<string, string | null>).loss_reason,
          // Stint 91 — won_reason was accepted by API but never carried
          // through the form. Now visible when stage === 'won'.
          won_reason: (o as Record<string, string | null>).won_reason,
          tags: o.tags ?? [],
          notes: o.notes,
        }}
        onSave={handleUpdate}
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-5">
        <Card title="Estimated value">
          <InlineTextCell
            value={o.estimated_value_eur !== null && o.estimated_value_eur !== undefined ? formatEur(o.estimated_value_eur as number) : null}
            onSave={async v => { await patchField('estimated_value_eur', v); }}
            placeholder="—"
          />
        </Card>
        <Card title="Probability">
          <InlineTextCell
            value={o.probability_pct !== null && o.probability_pct !== undefined ? `${o.probability_pct}%` : null}
            onSave={async v => { await patchField('probability_pct', v); }}
            placeholder="—"
          />
        </Card>
        <Card title="Weighted value">{formatEur((o as Record<string, number | null>).weighted_value_eur)}</Card>
        <Card title="Close date">
          <InlineDateCell
            value={o.estimated_close_date as string | null}
            onSave={async v => { await patchField('estimated_close_date', v); }}
            mode="neutral"
          />
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
        <Card title="Company">
          {/* Stint 91 — inline edit, with the historic link behaviour
              preserved on the label (cmd-click navigates). */}
          <InlineEntitySelect
            source="company"
            value={o.company_id ?? null}
            displayLabel={o.company_name ?? null}
            href={o.company_id ? `/crm/companies/${o.company_id}` : null}
            onSave={async next => { await patchField('company_id', next); }}
          />
        </Card>
        <Card title="Primary contact">
          <InlineEntitySelect
            source="contact"
            value={o.primary_contact_id ?? null}
            displayLabel={o.primary_contact_name ?? null}
            href={o.primary_contact_id ? `/crm/contacts/${o.primary_contact_id}` : null}
            onSave={async next => { await patchField('primary_contact_id', next); }}
          />
        </Card>
      </div>

      {(o as { next_action?: string | null }).next_action && (
        <div className="mb-5 p-3 bg-amber-50 border border-amber-200 rounded">
          <div className="text-2xs uppercase tracking-wide font-semibold text-amber-800 mb-1">Next action</div>
          <div className="text-sm text-ink">{String((o as { next_action?: string | null }).next_action)}</div>
          {(o as { next_action_due?: string | null }).next_action_due && (
            <div className="text-xs text-amber-700 mt-1">Due: {formatDate((o as { next_action_due?: string | null }).next_action_due ?? null)}</div>
          )}
        </div>
      )}

      {o.stage === 'won' && (
        <div className="mb-5 p-3 bg-emerald-50 border border-emerald-300 rounded flex items-start gap-3">
          <div className="flex-1">
            <div className="text-sm font-semibold text-emerald-900">🎉 Deal won — ready to open the matter?</div>
            <div className="text-xs text-emerald-800 mt-0.5">
              Kicks off the matter intake wizard with parties + scope pre-filled from this opportunity.
            </div>
          </div>
          <Link
            href={`/crm/matters/new?source_opp=${id}`}
            className="shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700"
          >
            Open matter →
          </Link>
        </div>
      )}

      {o.notes && (
        <div className="mb-5 p-3 bg-surface-alt border border-border rounded text-sm whitespace-pre-wrap">{String(o.notes)}</div>
      )}

      <Section title={`Activities (${data.activities.length})`}>
        <Table
          headers={['Date', 'Type', 'Name', 'Duration', 'Outcome']}
          rows={data.activities.map(x => [
            formatDate(x.activity_date),
            LABELS_ACTIVITY_TYPE[x.activity_type as ActivityType] ?? x.activity_type,
            x.name,
            x.duration_hours !== null ? `${Number(x.duration_hours).toFixed(1)}h` : '—',
            x.outcome ?? '—',
          ])}
        />
      </Section>

      <RecordHistory targetType="crm_opportunity" targetId={id} />
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
