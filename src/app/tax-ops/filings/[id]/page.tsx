'use client';

// ════════════════════════════════════════════════════════════════════════
// /tax-ops/filings/[id] — filing detail page.
//
// Layout:
//   Header  | entity name + group · tax_type · period · status dropdown
//   Left    | Timeline (draft_sent, client_approved, filed, assessment, paid)
//             CSP contacts editable (override of entity defaults)
//             Amounts (due, paid)
//             Assessment URL
//   Right   | Comments (markdown-lite textarea)
//             Deadline rule context (statutory, tolerance, market note)
//   Footer  | "Back to filings" · meta (import_source, created_at)
//
// Every change hits PATCH /api/tax-ops/filings/[id] and re-fetches.
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useState, useCallback, use } from 'react';
import Link from 'next/link';
import { ArrowLeftIcon, CheckIcon, HistoryIcon } from 'lucide-react';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { CrmErrorBox } from '@/components/crm/CrmErrorBox';
import { DateBadge } from '@/components/crm/DateBadge';
import { useToast } from '@/components/Toaster';
import {
  FilingStatusBadge, FILING_STATUSES, filingStatusLabel,
} from '@/components/tax-ops/FilingStatusBadge';
import { CspContactsEditor, type CspContact } from '@/components/tax-ops/CspContactsEditor';
import { AuditLogDrawer } from '@/components/tax-ops/AuditLogDrawer';

interface FilingDetail {
  id: string;
  obligation_id: string;
  entity_id: string;
  entity_name: string;
  group_id: string | null;
  group_name: string | null;
  tax_type: string;
  /** Stint 64.X.2 — provision filings render with the provision label
   *  set; field added to the FilingDetail GET response so the badge
   *  uses the right enum. */
  service_kind?: 'filing' | 'provision' | 'review';
  period_pattern: string;
  period_year: number;
  period_label: string;
  deadline_date: string | null;
  status: string;
  assigned_to: string | null;
  prepared_with: string[];
  partner_in_charge?: string[];
  associates_working?: string[];
  draft_sent_at: string | null;
  client_approved_at: string | null;
  filed_at: string | null;
  tax_assessment_received_at: string | null;
  tax_assessment_url: string | null;
  amount_due: string | null;
  amount_paid: string | null;
  paid_at: string | null;
  csp_contacts: CspContact[];
  entity_csp_contacts: CspContact[];
  comments: string | null;
  internal_matter_code: string | null;
  import_source: string;
  created_at: string;
  updated_at: string;
  rule_statutory_description: string | null;
  rule_admin_tolerance_days: number | null;
  rule_market_practice_note: string | null;
}

function humanTaxType(t: string): string {
  return t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// Route params are now a Promise in Next 16 — unwrap with `use`.
export default function FilingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<FilingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  // Local editable copies (autosaved on blur)
  const [comments, setComments] = useState('');
  const [cspContacts, setCspContacts] = useState<CspContact[]>([]);

  // Stint 64.O — F2 audit log drawer.
  const [historyOpen, setHistoryOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/tax-ops/filings/${id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as FilingDetail;
      setData(body);
      setComments(body.comments ?? '');
      // If per-filing CSP is empty, pre-populate UI with entity defaults
      // so Diego can edit them without re-typing. Only persisted if
      // Diego saves — the defaults remain at the entity level.
      setCspContacts(
        (body.csp_contacts && body.csp_contacts.length > 0)
          ? body.csp_contacts
          : body.entity_csp_contacts ?? [],
      );
      setError(null);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function patch(body: Record<string, unknown>, successMsg: string) {
    try {
      const res = await fetch(`/api/tax-ops/filings/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success(successMsg);
      await load();
    } catch (e) {
      toast.error(`Save failed: ${String(e instanceof Error ? e.message : e)}`);
    }
  }

  if (error) return <CrmErrorBox message={error} onRetry={load} />;
  if (!data) return <PageSkeleton />;

  return (
    <div className="space-y-4 max-w-5xl">
      <Link href="/tax-ops/filings" className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
        <ArrowLeftIcon size={12} /> Back to filings
      </Link>

      {/* Header */}
      <div className="rounded-md border border-border bg-surface px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <Link href={`/tax-ops/entities/${data.entity_id}`} className="text-base font-semibold text-ink hover:text-brand-700">
              {data.entity_name}
            </Link>
            <div className="text-sm text-ink-muted mt-0.5">
              {data.group_name && <span className="mr-2">{data.group_name}</span>}
              {humanTaxType(data.tax_type)} · {data.period_label} ({data.period_pattern})
            </div>
          </div>
          <div className="flex items-center gap-2">
            <FilingStatusBadge status={data.status} serviceKind={data.service_kind} />
            <select
              value={data.status}
              onChange={e => patch({ status: e.target.value }, 'Status updated')}
              className="px-2 py-1 text-sm border border-border rounded-md bg-surface"
              aria-label="Change status"
            >
              {FILING_STATUSES.map(s => <option key={s} value={s}>{filingStatusLabel(s)}</option>)}
            </select>
            {/* Stint 64.O — open the audit log timeline for this filing. */}
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              className="inline-flex items-center gap-1 px-2 py-1 text-sm border border-border rounded-md bg-surface hover:bg-surface-alt/50 text-ink-soft hover:text-ink"
              title="View change history (audit log) for this filing"
            >
              <HistoryIcon size={13} /> History
            </button>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-4 text-sm">
          <div>
            <span className="text-ink-muted mr-1">Deadline:</span>
            <DateBadge value={data.deadline_date} mode="urgency" />
          </div>
          {data.assigned_to && (
            <div><span className="text-ink-muted mr-1">Assignee:</span>{data.assigned_to}</div>
          )}
          {(data.partner_in_charge?.length ? data.partner_in_charge : data.prepared_with).length > 0 && (
            <div><span className="text-ink-muted mr-1">Partner in charge:</span>{(data.partner_in_charge?.length ? data.partner_in_charge : data.prepared_with).join(', ')}</div>
          )}
          {data.associates_working && data.associates_working.length > 0 && (
            <div><span className="text-ink-muted mr-1">Associates:</span>{data.associates_working.join(', ')}</div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left column — 2 cols wide */}
        <div className="lg:col-span-2 space-y-4">
          {/* Timeline */}
          <div className="rounded-md border border-border bg-surface px-4 py-3">
            <h3 className="text-sm font-semibold text-ink mb-2">Timeline</h3>
            <div className="space-y-2 text-sm">
              <TimelineRow
                label="Draft sent to client"
                value={data.draft_sent_at}
                onSet={v => patch({ draft_sent_at: v }, 'Draft-sent date saved')}
              />
              <TimelineRow
                label="Client approved"
                value={data.client_approved_at}
                onSet={v => patch({ client_approved_at: v }, 'Client-approved date saved')}
              />
              <TimelineRow
                label="Filed with AED"
                value={data.filed_at}
                onSet={v => patch({ filed_at: v, status: 'filed' }, 'Filed date saved')}
              />
              <TimelineRow
                label="Tax assessment received"
                value={data.tax_assessment_received_at}
                onSet={v => patch({ tax_assessment_received_at: v, status: 'assessment_received' }, 'Assessment date saved')}
              />
              <TimelineRow
                label="Paid"
                value={data.paid_at}
                onSet={v => patch({ paid_at: v, status: 'paid' }, 'Paid date saved')}
              />
            </div>
          </div>

          {/* CSP contacts */}
          <div className="rounded-md border border-border bg-surface px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-ink">CSP contacts</h3>
              <span className="text-xs text-ink-muted">
                {data.csp_contacts.length > 0 ? 'Override for this filing' : 'Using entity defaults'}
              </span>
            </div>
            <CspContactsEditor
              value={cspContacts}
              onChange={setCspContacts}
              fallbackLabel="No CSP contacts recorded"
            />
            <div className="mt-2">
              <button
                onClick={() => patch({ csp_contacts: cspContacts }, 'CSP contacts saved')}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-sm rounded-md border border-border hover:bg-surface-alt"
              >
                <CheckIcon size={11} /> Save contacts
              </button>
            </div>
          </div>

          {/* Amounts */}
          <div className="rounded-md border border-border bg-surface px-4 py-3">
            <h3 className="text-sm font-semibold text-ink mb-2">Amounts</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <AmountField
                label="Amount due"
                value={data.amount_due}
                onSave={v => patch({ amount_due: v }, 'Amount due saved')}
              />
              <AmountField
                label="Amount paid"
                value={data.amount_paid}
                onSave={v => patch({ amount_paid: v }, 'Amount paid saved')}
              />
            </div>
          </div>

          {/* Assessment URL */}
          <div className="rounded-md border border-border bg-surface px-4 py-3">
            <h3 className="text-sm font-semibold text-ink mb-2">Tax assessment</h3>
            <UrlField
              label="Assessment URL"
              value={data.tax_assessment_url}
              onSave={v => patch({ tax_assessment_url: v }, 'Assessment URL saved')}
              placeholder="https://… or Drive/file link"
            />
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* Comments */}
          <div className="rounded-md border border-border bg-surface px-4 py-3">
            <h3 className="text-sm font-semibold text-ink mb-2">Comments</h3>
            <textarea
              value={comments}
              onChange={e => setComments(e.target.value)}
              onBlur={() => {
                if (comments !== (data.comments ?? '')) {
                  patch({ comments }, 'Comments saved');
                }
              }}
              rows={8}
              placeholder="Notes, status log, todos. Saved on blur."
              className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-surface font-mono"
            />
          </div>

          {/* Rule context — explains where the deadline comes from */}
          {data.rule_statutory_description && (
            <div className="rounded-md border border-border bg-surface-alt/40 px-4 py-3 text-xs text-ink-soft">
              <h3 className="text-sm font-semibold text-ink mb-1">Deadline rule</h3>
              <p className="mb-1.5">{data.rule_statutory_description}</p>
              {typeof data.rule_admin_tolerance_days === 'number' && data.rule_admin_tolerance_days > 0 && (
                <p className="mb-1.5">Admin tolerance: <strong>{data.rule_admin_tolerance_days} days</strong> past statutory.</p>
              )}
              {data.rule_market_practice_note && <p className="italic">{data.rule_market_practice_note}</p>}
            </div>
          )}

          {/* Meta */}
          <div className="text-xs text-ink-muted space-y-0.5">
            <div>Source: {data.import_source}</div>
            <div>Created: {new Date(data.created_at).toLocaleString()}</div>
            <div>Updated: {new Date(data.updated_at).toLocaleString()}</div>
          </div>
        </div>
      </div>

      {/* Stint 64.O — F2 audit log drawer. Open via the History button
          in the header. */}
      <AuditLogDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        targetType="tax_filing"
        targetId={data.id}
        targetLabel={`${humanTaxType(data.tax_type)} · ${data.period_label} · ${data.entity_name}`}
      />
    </div>
  );
}

function TimelineRow({
  label, value, onSet,
}: {
  label: string;
  value: string | null;
  onSet: (v: string | null) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-44 text-ink-muted">{label}</div>
      <input
        type="date"
        value={value ?? ''}
        onChange={e => onSet(e.target.value || null)}
        className="flex-1 px-2 py-1 border border-border rounded-md bg-surface"
      />
    </div>
  );
}

function AmountField({
  label, value, onSave,
}: {
  label: string;
  value: string | null;
  onSave: (v: number | null) => void;
}) {
  const [local, setLocal] = useState(value ?? '');
  useEffect(() => setLocal(value ?? ''), [value]);
  return (
    <label className="flex flex-col gap-1">
      <span className="text-ink-muted">{label}</span>
      <input
        type="number"
        step="0.01"
        value={local}
        onChange={e => setLocal(e.target.value)}
        onBlur={() => {
          if (local === (value ?? '')) return;
          onSave(local === '' ? null : Number(local));
        }}
        placeholder="0.00"
        className="px-2 py-1 border border-border rounded-md bg-surface tabular-nums"
      />
    </label>
  );
}

function UrlField({
  label, value, onSave, placeholder,
}: {
  label: string;
  value: string | null;
  onSave: (v: string | null) => void;
  placeholder?: string;
}) {
  const [local, setLocal] = useState(value ?? '');
  useEffect(() => setLocal(value ?? ''), [value]);
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-ink-muted">{label}</span>
      <input
        value={local}
        onChange={e => setLocal(e.target.value)}
        onBlur={() => {
          if (local === (value ?? '')) return;
          onSave(local === '' ? null : local);
        }}
        placeholder={placeholder}
        className="px-2 py-1 border border-border rounded-md bg-surface"
      />
      {value && (
        <a href={value} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-700 hover:underline truncate">
          Open ↗
        </a>
      )}
    </label>
  );
}
