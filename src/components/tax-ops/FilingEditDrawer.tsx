'use client';

// ════════════════════════════════════════════════════════════════════════
// FilingEditDrawer — stint 40.G.2
//
// Side drawer that exposes EVERY editable field of a filing at once.
// Diego's workflow: most of the time inline editing is enough, but
// when a filing has several updates to make together (status +
// deadline + prepared_with + contacts + amount_paid), clicking each
// cell in turn is tedious. This drawer surfaces the full form.
//
// Opens via a pencil ✎ row-action on the matrix; GET /api/tax-ops/
// filings/[id] hydrates the form; Save fires a single PATCH.
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { XIcon, ExternalLinkIcon } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { FILING_STATUSES, filingStatusLabel } from './FilingStatusBadge';
import { CspContactsEditor, type CspContact } from './CspContactsEditor';

interface FilingDetail {
  id: string;
  entity_name: string;
  group_name: string | null;
  tax_type: string;
  period_label: string;
  deadline_date: string | null;
  status: string;
  assigned_to: string | null;
  prepared_with: string[];
  /** Stint 43.D11 — partner(s) who own the engagement. */
  partner_in_charge: string[];
  /** Stint 43.D11 — associate(s) doing the prep work. */
  associates_working: string[];
  draft_sent_at: string | null;
  client_approved_at: string | null;
  filed_at: string | null;
  tax_assessment_received_at: string | null;
  tax_assessment_url: string | null;
  amount_due: string | null;
  amount_paid: string | null;
  paid_at: string | null;
  csp_contacts: CspContact[];
  comments: string | null;
  internal_matter_code: string | null;
  last_info_request_sent_at: string | null;
  invoice_price_eur: string | null;
  invoice_price_note: string | null;
  // Stint 52 — separate ISS / Intra-community Supply of Services price.
  invoice_price_iss_eur: string | null;
  invoice_price_iss_note: string | null;
}

interface Props {
  filingId: string | null;
  onClose: () => void;
  onSaved: () => void;
}

export function FilingEditDrawer({ filingId, onClose, onSaved }: Props) {
  const [data, setData] = useState<FilingDetail | null>(null);
  const [draft, setDraft] = useState<FilingDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  // Load detail on open
  useEffect(() => {
    if (!filingId) { setData(null); setDraft(null); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/tax-ops/filings/${filingId}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((body: FilingDetail) => {
        if (cancelled) return;
        setData(body);
        setDraft({
          ...body,
          prepared_with: body.prepared_with ?? [],
          partner_in_charge: body.partner_in_charge ?? [],
          associates_working: body.associates_working ?? [],
          csp_contacts: body.csp_contacts ?? [],
        });
      })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [filingId]);

  // ESC closes (when nothing dirty) — otherwise ask user
  useEffect(() => {
    if (!filingId) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [filingId, onClose]);

  if (!filingId) return null;

  async function save() {
    if (!draft || !data || saving) return;
    setSaving(true);
    setError(null);
    // Build a diff-patch: only send changed fields so audit log stays clean.
    const patch: Record<string, unknown> = {};
    const keys: Array<keyof FilingDetail> = [
      'status', 'assigned_to', 'deadline_date', 'prepared_with',
      'partner_in_charge', 'associates_working',
      'draft_sent_at', 'client_approved_at', 'filed_at',
      'tax_assessment_received_at', 'tax_assessment_url',
      'amount_due', 'amount_paid', 'paid_at',
      'csp_contacts', 'comments', 'internal_matter_code',
      'last_info_request_sent_at', 'invoice_price_eur', 'invoice_price_note',
      'invoice_price_iss_eur', 'invoice_price_iss_note',
    ];
    for (const k of keys) {
      const a = JSON.stringify(draft[k] ?? null);
      const b = JSON.stringify(data[k] ?? null);
      if (a !== b) patch[k] = draft[k] ?? null;
    }
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    try {
      const res = await fetch(`/api/tax-ops/filings/${filingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b?.error ?? `HTTP ${res.status}`);
      }
      toast.withAction('success',
        `Filing updated · ${Object.keys(patch).length} field${Object.keys(patch).length === 1 ? '' : 's'} changed`,
        undefined,
        {
          label: 'Undo',
          onClick: async () => {
            // Reverse = PATCH with the original values of the changed fields.
            const revertPatch: Record<string, unknown> = {};
            for (const k of Object.keys(patch)) {
              revertPatch[k] = (data as unknown as Record<string, unknown>)[k] ?? null;
            }
            const r = await fetch(`/api/tax-ops/filings/${filingId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(revertPatch),
            });
            if (!r.ok) toast.error('Undo failed');
            onSaved();
          },
        },
      );
      onSaved();
      onClose();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-modal flex justify-end"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/20" />

      {/* Drawer */}
      <div
        role="dialog"
        aria-label="Edit filing"
        className="relative bg-surface border-l border-border w-[480px] max-w-[90vw] h-full overflow-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-surface border-b border-border px-4 py-2.5 flex items-center gap-2 z-sticky">
          <div className="flex-1 min-w-0">
            {data ? (
              <>
                <div className="text-sm font-semibold text-ink truncate">{data.entity_name}</div>
                <div className="text-xs text-ink-muted truncate">
                  {data.group_name && <>{data.group_name} · </>}
                  {data.tax_type.replace(/_/g, ' ')} · {data.period_label}
                </div>
              </>
            ) : (
              <div className="text-sm text-ink-muted">Loading…</div>
            )}
          </div>
          {data && (
            <Link
              href={`/tax-ops/filings/${data.id}`}
              target="_blank"
              className="text-xs text-ink-muted hover:text-ink inline-flex items-center gap-1"
              title="Open full detail page in new tab"
            >
              <ExternalLinkIcon size={11} /> Full detail
            </Link>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close drawer"
            className="p-1 text-ink-muted hover:text-ink rounded"
          >
            <XIcon size={14} />
          </button>
        </div>

        {error && (
          <div className="mx-4 mt-3 px-3 py-2 text-sm rounded-md bg-danger-50 text-danger-800 border border-danger-200">
            {error}
          </div>
        )}

        {loading && !data && (
          <div className="p-4 text-sm text-ink-muted italic">Loading filing…</div>
        )}

        {draft && (
          <div className="p-4 space-y-4 text-sm">
            {/* Status + Deadline */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Status">
                <select
                  value={draft.status}
                  onChange={(e) => setDraft({ ...draft, status: e.target.value })}
                  className="w-full px-2 py-1 border border-border rounded bg-surface"
                >
                  {FILING_STATUSES.map(s => (
                    <option key={s} value={s}>{filingStatusLabel(s)}</option>
                  ))}
                </select>
              </Field>
              <Field label="Deadline">
                <input
                  type="date"
                  value={draft.deadline_date ?? ''}
                  onChange={(e) => setDraft({ ...draft, deadline_date: e.target.value || null })}
                  className="w-full px-2 py-1 border border-border rounded bg-surface tabular-nums"
                />
              </Field>
            </div>

            {/* Assignee + matter code */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Assignee">
                <input
                  type="text"
                  value={draft.assigned_to ?? ''}
                  onChange={(e) => setDraft({ ...draft, assigned_to: e.target.value || null })}
                  className="w-full px-2 py-1 border border-border rounded bg-surface"
                />
              </Field>
              <Field label="Internal matter code">
                <input
                  type="text"
                  value={draft.internal_matter_code ?? ''}
                  onChange={(e) => setDraft({ ...draft, internal_matter_code: e.target.value || null })}
                  className="w-full px-2 py-1 border border-border rounded bg-surface"
                />
              </Field>
            </div>

            {/* Stint 43.D11 — split ownership: partner in charge + associates */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Partner in charge">
                <input
                  type="text"
                  value={(draft.partner_in_charge?.length ? draft.partner_in_charge : draft.prepared_with).join(', ')}
                  onChange={(e) => setDraft({
                    ...draft,
                    partner_in_charge: e.target.value.split(',').map(s => s.trim()).filter(Boolean),
                  })}
                  className="w-full px-2 py-1 border border-border rounded bg-surface"
                  placeholder="comma-separated short names"
                />
              </Field>
              <Field label="Associates working">
                <input
                  type="text"
                  value={(draft.associates_working ?? []).join(', ')}
                  onChange={(e) => setDraft({
                    ...draft,
                    associates_working: e.target.value.split(',').map(s => s.trim()).filter(Boolean),
                  })}
                  className="w-full px-2 py-1 border border-border rounded bg-surface"
                  placeholder="comma-separated short names"
                />
              </Field>
            </div>

            {/* Timeline dates */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Last chased (client/CSP)">
                <input
                  type="date"
                  value={draft.last_info_request_sent_at ?? ''}
                  onChange={(e) => setDraft({ ...draft, last_info_request_sent_at: e.target.value || null })}
                  className="w-full px-2 py-1 border border-border rounded bg-surface tabular-nums"
                />
              </Field>
              <Field label="Draft sent">
                <input
                  type="date"
                  value={draft.draft_sent_at ?? ''}
                  onChange={(e) => setDraft({ ...draft, draft_sent_at: e.target.value || null })}
                  className="w-full px-2 py-1 border border-border rounded bg-surface tabular-nums"
                />
              </Field>
              <Field label="Client approved">
                <input
                  type="date"
                  value={draft.client_approved_at ?? ''}
                  onChange={(e) => setDraft({ ...draft, client_approved_at: e.target.value || null })}
                  className="w-full px-2 py-1 border border-border rounded bg-surface tabular-nums"
                />
              </Field>
              <Field label="Filed">
                <input
                  type="date"
                  value={draft.filed_at ?? ''}
                  onChange={(e) => setDraft({ ...draft, filed_at: e.target.value || null })}
                  className="w-full px-2 py-1 border border-border rounded bg-surface tabular-nums"
                />
              </Field>
            </div>

            {/* Tax assessment */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Assessment received">
                <input
                  type="date"
                  value={draft.tax_assessment_received_at ?? ''}
                  onChange={(e) => setDraft({ ...draft, tax_assessment_received_at: e.target.value || null })}
                  className="w-full px-2 py-1 border border-border rounded bg-surface tabular-nums"
                />
              </Field>
              <Field label="Assessment URL">
                <input
                  type="url"
                  value={draft.tax_assessment_url ?? ''}
                  onChange={(e) => setDraft({ ...draft, tax_assessment_url: e.target.value || null })}
                  className="w-full px-2 py-1 border border-border rounded bg-surface"
                  placeholder="https://…"
                />
              </Field>
            </div>

            {/* Money */}
            <div className="grid grid-cols-3 gap-3">
              <Field label="Amount due (€)">
                <input
                  type="number"
                  step="0.01"
                  value={draft.amount_due ?? ''}
                  onChange={(e) => setDraft({ ...draft, amount_due: e.target.value || null })}
                  className="w-full px-2 py-1 border border-border rounded bg-surface tabular-nums"
                />
              </Field>
              <Field label="Amount paid (€)">
                <input
                  type="number"
                  step="0.01"
                  value={draft.amount_paid ?? ''}
                  onChange={(e) => setDraft({ ...draft, amount_paid: e.target.value || null })}
                  className="w-full px-2 py-1 border border-border rounded bg-surface tabular-nums"
                />
              </Field>
              <Field label="Paid at">
                <input
                  type="date"
                  value={draft.paid_at ?? ''}
                  onChange={(e) => setDraft({ ...draft, paid_at: e.target.value || null })}
                  className="w-full px-2 py-1 border border-border rounded bg-surface tabular-nums"
                />
              </Field>
            </div>

            {/* Invoice price — stint 52 split into Per Return + Per ISS for VAT.
                Both fields are always editable here (the matrices decide which
                one to surface as a column based on tax_type). */}
            <div className="grid grid-cols-3 gap-3">
              <Field label="Price per return (€)">
                <input
                  type="number"
                  step="1"
                  value={draft.invoice_price_eur ?? ''}
                  onChange={(e) => setDraft({ ...draft, invoice_price_eur: e.target.value || null })}
                  className="w-full px-2 py-1 border border-border rounded bg-surface tabular-nums"
                />
              </Field>
              <div className="col-span-2">
                <Field label="Note (return)">
                  <input
                    type="text"
                    value={draft.invoice_price_note ?? ''}
                    onChange={(e) => setDraft({ ...draft, invoice_price_note: e.target.value || null })}
                    className="w-full px-2 py-1 border border-border rounded bg-surface"
                    placeholder="+5% office expenses +VAT if applicable"
                  />
                </Field>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <Field label="Price per ISS (€)">
                <input
                  type="number"
                  step="1"
                  value={draft.invoice_price_iss_eur ?? ''}
                  onChange={(e) => setDraft({ ...draft, invoice_price_iss_eur: e.target.value || null })}
                  className="w-full px-2 py-1 border border-border rounded bg-surface tabular-nums"
                  title="Intra-community Supply of Services (Liste récapitulative). Leave blank if no ISS prepared for this filing."
                />
              </Field>
              <div className="col-span-2">
                <Field label="Note (ISS)">
                  <input
                    type="text"
                    value={draft.invoice_price_iss_note ?? ''}
                    onChange={(e) => setDraft({ ...draft, invoice_price_iss_note: e.target.value || null })}
                    className="w-full px-2 py-1 border border-border rounded bg-surface"
                    placeholder="ISS-specific scope or billing note"
                  />
                </Field>
              </div>
            </div>

            {/* Contacts */}
            <Field label="Contacts for this filing">
              <CspContactsEditor
                value={draft.csp_contacts}
                onChange={(next) => setDraft({ ...draft, csp_contacts: next })}
                fallbackLabel="No contacts yet"
              />
            </Field>

            {/* Comments */}
            <Field label="Comments">
              <textarea
                value={draft.comments ?? ''}
                onChange={(e) => setDraft({ ...draft, comments: e.target.value || null })}
                rows={4}
                className="w-full px-2 py-1 border border-border rounded bg-surface"
              />
            </Field>

            {/* Actions */}
            <div className="sticky bottom-0 bg-surface border-t border-border pt-3 -mx-4 px-4 pb-3 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-surface-alt"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                className="px-3 py-1.5 text-sm rounded-md bg-brand-500 hover:bg-brand-600 text-white disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save all'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-ink-muted mb-1">{label}</span>
      {children}
    </label>
  );
}
