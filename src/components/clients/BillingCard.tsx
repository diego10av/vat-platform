'use client';

// ════════════════════════════════════════════════════════════════════════
// BillingCard — fee schedule + engagement letter for a client.
//
// The card has two modes:
//   1. Empty state — one-line CTA "Add fee schedule". No visual weight
//      for clients where billing isn't yet captured.
//   2. Read mode — compact summary of all non-null fees + disbursement
//      config + engagement-letter filename. "Edit" flips to editing.
//   3. Edit mode — the form.
//
// Amounts are kept in EUR cents in the DB; the UI shows euros with
// two decimals. Typing "400" → 40000 cents. Disbursement fee is in
// basis points (bps): 4.25% → 425 bps.
//
// Stint 15 (2026-04-20). Per Diego: "con el tema del Billing para
// poder ver qué FIIs hemos acordado con ese cliente y tener a mano ese
// Engagement Letter".
// ════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BanknoteIcon, PencilIcon, CheckIcon, XIcon, Loader2Icon, PlusIcon,
  FileTextIcon, UploadCloudIcon, ExternalLinkIcon, Trash2Icon,
  AlertTriangleIcon,
} from 'lucide-react';
import { useToast } from '@/components/Toaster';

interface BillingRow {
  client_id: string;
  fee_monthly_cents: number | null;
  fee_quarterly_cents: number | null;
  fee_annual_cents: number | null;
  fee_annual_summary_cents: number | null;
  fee_vat_registration_cents: number | null;
  fee_ad_hoc_hourly_cents: number | null;
  currency: string;
  disbursement_fee_bps: number | null;
  vat_on_disbursement_fee: boolean | null;
  disbursement_notes: string | null;
  billing_notes: string | null;
  engagement_letter_filename: string | null;
  engagement_letter_path: string | null;
  engagement_letter_size_bytes: number | null;
  engagement_letter_uploaded_at: string | null;
  engagement_letter_signed_on: string | null;
}

interface Draft {
  fee_monthly: string;
  fee_quarterly: string;
  fee_annual: string;
  fee_annual_summary: string;
  fee_vat_registration: string;
  fee_ad_hoc_hourly: string;
  currency: string;
  disbursement_fee_pct: string;       // percent, e.g. "4.25" (converted to bps on save)
  vat_on_disbursement_fee: 'yes' | 'no' | 'unknown';
  disbursement_notes: string;
  billing_notes: string;
  engagement_letter_signed_on: string;
}

const EMPTY_DRAFT: Draft = {
  fee_monthly: '',
  fee_quarterly: '',
  fee_annual: '',
  fee_annual_summary: '',
  fee_vat_registration: '',
  fee_ad_hoc_hourly: '',
  currency: 'EUR',
  disbursement_fee_pct: '',
  vat_on_disbursement_fee: 'unknown',
  disbursement_notes: '',
  billing_notes: '',
  engagement_letter_signed_on: '',
};

export function BillingCard({ clientId }: { clientId: string }) {
  const toast = useToast();
  const [billing, setBilling] = useState<BillingRow | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/clients/${clientId}/billing`);
      const body = await res.json();
      if (res.status === 501 || body?.error?.code === 'migration_required') {
        setMigrationMissing(true);
        setBilling(null);
        return;
      }
      if (!res.ok) {
        toast.error(body?.error?.message ?? 'Could not load billing.');
        setBilling(null);
        return;
      }
      setBilling(body.billing ?? null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Network error.');
      setBilling(null);
    }
  }, [clientId, toast]);

  useEffect(() => { load(); }, [load]);

  // When opening edit mode, hydrate the draft from the row.
  useEffect(() => {
    if (!editing) return;
    if (!billing) { setDraft(EMPTY_DRAFT); return; }
    setDraft({
      fee_monthly: centsToEuros(billing.fee_monthly_cents),
      fee_quarterly: centsToEuros(billing.fee_quarterly_cents),
      fee_annual: centsToEuros(billing.fee_annual_cents),
      fee_annual_summary: centsToEuros(billing.fee_annual_summary_cents),
      fee_vat_registration: centsToEuros(billing.fee_vat_registration_cents),
      fee_ad_hoc_hourly: centsToEuros(billing.fee_ad_hoc_hourly_cents),
      currency: billing.currency || 'EUR',
      disbursement_fee_pct: billing.disbursement_fee_bps != null
        ? (billing.disbursement_fee_bps / 100).toString()
        : '',
      vat_on_disbursement_fee:
        billing.vat_on_disbursement_fee == null ? 'unknown'
        : billing.vat_on_disbursement_fee ? 'yes' : 'no',
      disbursement_notes: billing.disbursement_notes ?? '',
      billing_notes: billing.billing_notes ?? '',
      engagement_letter_signed_on: billing.engagement_letter_signed_on ?? '',
    });
  }, [editing, billing]);

  async function save() {
    setSaving(true);
    try {
      const body = {
        fee_monthly_cents: eurosToCentsOrNull(draft.fee_monthly),
        fee_quarterly_cents: eurosToCentsOrNull(draft.fee_quarterly),
        fee_annual_cents: eurosToCentsOrNull(draft.fee_annual),
        fee_annual_summary_cents: eurosToCentsOrNull(draft.fee_annual_summary),
        fee_vat_registration_cents: eurosToCentsOrNull(draft.fee_vat_registration),
        fee_ad_hoc_hourly_cents: eurosToCentsOrNull(draft.fee_ad_hoc_hourly),
        currency: draft.currency.trim().toUpperCase() || 'EUR',
        disbursement_fee_bps: pctToBpsOrNull(draft.disbursement_fee_pct),
        vat_on_disbursement_fee:
          draft.vat_on_disbursement_fee === 'unknown' ? null :
          draft.vat_on_disbursement_fee === 'yes',
        disbursement_notes: draft.disbursement_notes.trim() || null,
        billing_notes: draft.billing_notes.trim() || null,
        engagement_letter_signed_on: draft.engagement_letter_signed_on.trim() || null,
      };
      const res = await fetch(`/api/clients/${clientId}/billing`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const resp = await res.json();
      if (!res.ok) {
        toast.error(resp?.error?.message ?? 'Could not save billing.', resp?.error?.hint);
        return;
      }
      toast.success('Billing saved.');
      setBilling(resp.billing);
      setEditing(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setSaving(false);
    }
  }

  async function uploadEngagementLetter(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (draft.engagement_letter_signed_on) {
        fd.append('signed_on', draft.engagement_letter_signed_on);
      }
      const res = await fetch(`/api/clients/${clientId}/billing/engagement-letter`, {
        method: 'POST',
        body: fd,
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body?.error?.message ?? 'Upload failed.', body?.error?.hint);
        return;
      }
      toast.success('Engagement letter uploaded.');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setUploading(false);
    }
  }

  async function openEngagementLetter() {
    try {
      const res = await fetch(`/api/clients/${clientId}/billing/engagement-letter?action=url`);
      const body = await res.json();
      if (!res.ok) {
        toast.error(body?.error?.message ?? 'Could not open.');
        return;
      }
      if (body.url) window.open(body.url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Network error.');
    }
  }

  async function deleteEngagementLetter() {
    if (!confirm('Remove the engagement letter? The fee schedule stays.')) return;
    try {
      const res = await fetch(`/api/clients/${clientId}/billing/engagement-letter`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        toast.error(body?.error?.message ?? 'Delete failed.');
        return;
      }
      toast.success('Engagement letter removed.');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Network error.');
    }
  }

  // ───────────────────────────────── render

  if (migrationMissing) {
    return (
      <div className="bg-amber-50/50 border border-amber-200 rounded-lg px-4 py-3">
        <div className="text-[12.5px] font-semibold text-amber-900 flex items-center gap-1.5">
          <AlertTriangleIcon size={13} /> Migration 018 pending
        </div>
        <div className="text-[11.5px] text-amber-800 mt-1">
          Apply <code className="text-[10.5px] bg-amber-100 px-1 rounded">018_client_billing.sql</code> to
          enable the Billing panel.
        </div>
      </div>
    );
  }

  if (billing === undefined) {
    return (
      <div className="bg-surface border border-border rounded-lg px-4 py-3 text-[12px] text-ink-muted inline-flex items-center gap-2">
        <Loader2Icon size={13} className="animate-spin" /> Loading billing…
      </div>
    );
  }

  const isEmpty = !billing || (
    billing.fee_monthly_cents == null
    && billing.fee_quarterly_cents == null
    && billing.fee_annual_cents == null
    && billing.fee_annual_summary_cents == null
    && billing.fee_vat_registration_cents == null
    && billing.fee_ad_hoc_hourly_cents == null
    && billing.disbursement_fee_bps == null
    && !billing.billing_notes
    && !billing.engagement_letter_filename
  );

  if (!editing && isEmpty) {
    return (
      <div className="bg-surface border border-dashed border-border rounded-lg px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[12px] text-ink-muted min-w-0">
          <BanknoteIcon size={13} className="text-ink-faint shrink-0" />
          <span className="truncate">
            <strong className="text-ink-soft">No fee schedule on record.</strong>{' '}
            Capture the fees you&apos;ve agreed — monthly / quarterly / annual, VAT
            registration one-off, disbursement %.
          </span>
        </div>
        <button
          onClick={() => setEditing(true)}
          className="shrink-0 h-7 px-2.5 rounded-md border border-border-strong text-[11.5px] font-medium text-ink-soft hover:text-ink hover:bg-surface-alt inline-flex items-center gap-1"
        >
          <PlusIcon size={11} /> Add fee schedule
        </button>
      </div>
    );
  }

  if (!editing && billing) {
    return (
      <div className="bg-emerald-50/20 border border-emerald-200 rounded-lg px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-[10.5px] uppercase tracking-wide font-semibold text-emerald-800">
              <BanknoteIcon size={11} /> Billing · fees agreed with this client
            </div>

            {/* Fee rows */}
            <div className="mt-2 grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-[12px]">
              <FeeItem label="Monthly" cents={billing.fee_monthly_cents} currency={billing.currency} />
              <FeeItem label="Quarterly" cents={billing.fee_quarterly_cents} currency={billing.currency} />
              <FeeItem label="Annual" cents={billing.fee_annual_cents} currency={billing.currency} />
              <FeeItem label="Annual summary" cents={billing.fee_annual_summary_cents} currency={billing.currency} />
              <FeeItem label="VAT registration" cents={billing.fee_vat_registration_cents} currency={billing.currency} suffix=" · one-off" />
              <FeeItem label="Ad-hoc hourly" cents={billing.fee_ad_hoc_hourly_cents} currency={billing.currency} suffix=" / h" />
            </div>

            {billing.disbursement_fee_bps != null && (
              <div className="mt-2 text-[12px] text-ink-soft">
                <span className="font-medium">
                  Disbursement fee: {(billing.disbursement_fee_bps / 100).toFixed(2)}%
                </span>
                {billing.vat_on_disbursement_fee === true && <span className="text-ink-muted"> · VAT-subject</span>}
                {billing.vat_on_disbursement_fee === false && <span className="text-ink-muted"> · VAT-exempt</span>}
                {billing.disbursement_notes && (
                  <span className="text-ink-muted"> · {billing.disbursement_notes}</span>
                )}
              </div>
            )}

            {billing.billing_notes && (
              <div className="mt-2 text-[11.5px] text-ink-muted italic leading-relaxed">
                {billing.billing_notes}
              </div>
            )}

            {/* Engagement letter */}
            {billing.engagement_letter_filename ? (
              <div className="mt-3 rounded border border-emerald-200/70 bg-white/50 px-3 py-2 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <FileTextIcon size={13} className="text-emerald-700 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[12px] font-medium text-ink truncate">
                      {billing.engagement_letter_filename}
                    </div>
                    <div className="text-[10.5px] text-ink-muted">
                      {billing.engagement_letter_signed_on && `Signed ${billing.engagement_letter_signed_on}`}
                      {billing.engagement_letter_signed_on && billing.engagement_letter_uploaded_at && ' · '}
                      {billing.engagement_letter_uploaded_at && `Uploaded ${fmtDate(billing.engagement_letter_uploaded_at)}`}
                      {billing.engagement_letter_size_bytes != null && ` · ${fmtBytes(billing.engagement_letter_size_bytes)}`}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={openEngagementLetter}
                    className="h-7 px-2 rounded border border-border text-[11px] text-ink-muted hover:text-ink hover:bg-surface-alt inline-flex items-center gap-1"
                  >
                    <ExternalLinkIcon size={10} /> Open
                  </button>
                  <button
                    onClick={deleteEngagementLetter}
                    className="h-7 px-2 rounded border border-border text-[11px] text-ink-muted hover:text-danger-700 hover:border-danger-200 hover:bg-danger-50 inline-flex items-center gap-1"
                    title="Delete engagement letter"
                  >
                    <Trash2Icon size={10} />
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-3 text-[11px] text-ink-muted">
                No engagement letter on file.{' '}
                <button
                  onClick={() => setEditing(true)}
                  className="text-brand-600 hover:underline font-medium"
                >
                  Upload one
                </button>
              </div>
            )}
          </div>

          <button
            onClick={() => setEditing(true)}
            className="shrink-0 h-7 px-2.5 rounded-md border border-border-strong text-[11.5px] font-medium text-ink-soft hover:text-ink hover:bg-surface-alt inline-flex items-center gap-1"
          >
            <PencilIcon size={11} /> Edit
          </button>
        </div>
      </div>
    );
  }

  // Edit mode
  return (
    <div className="bg-emerald-50/30 border border-emerald-300 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-semibold text-ink inline-flex items-center gap-2">
          <BanknoteIcon size={14} className="text-emerald-700" />
          {billing ? 'Edit billing' : 'Add fee schedule'}
        </h3>
        <button
          onClick={() => setEditing(false)}
          className="p-1 text-ink-muted hover:text-ink"
          aria-label="Cancel"
        >
          <XIcon size={13} />
        </button>
      </div>

      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <EuroField
            label="Monthly fee"
            value={draft.fee_monthly}
            onChange={(v) => setDraft({ ...draft, fee_monthly: v })}
            currency={draft.currency}
          />
          <EuroField
            label="Quarterly fee"
            value={draft.fee_quarterly}
            onChange={(v) => setDraft({ ...draft, fee_quarterly: v })}
            currency={draft.currency}
          />
          <EuroField
            label="Annual fee"
            value={draft.fee_annual}
            onChange={(v) => setDraft({ ...draft, fee_annual: v })}
            currency={draft.currency}
          />
          <EuroField
            label="Annual summary"
            hint="once-a-year recap"
            value={draft.fee_annual_summary}
            onChange={(v) => setDraft({ ...draft, fee_annual_summary: v })}
            currency={draft.currency}
          />
          <EuroField
            label="VAT registration"
            hint="one-off"
            value={draft.fee_vat_registration}
            onChange={(v) => setDraft({ ...draft, fee_vat_registration: v })}
            currency={draft.currency}
          />
          <EuroField
            label="Ad-hoc hourly"
            hint="consultation rate"
            value={draft.fee_ad_hoc_hourly}
            onChange={(v) => setDraft({ ...draft, fee_ad_hoc_hourly: v })}
            currency={draft.currency}
          />
        </div>

        <div className="pt-2 border-t border-emerald-200/60">
          <div className="text-[11px] uppercase tracking-wide font-semibold text-emerald-900 mb-2">
            Disbursements
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Disbursement fee" hint="percentage, e.g. 4.25">
              <div className="relative">
                <input
                  value={draft.disbursement_fee_pct}
                  onChange={(e) => setDraft({ ...draft, disbursement_fee_pct: e.target.value })}
                  placeholder="4.25"
                  inputMode="decimal"
                  className="w-full border border-border-strong rounded px-2 py-1.5 pr-8 text-[12.5px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-ink-muted">%</span>
              </div>
            </Field>
            <Field label="VAT on disbursement fee?">
              <select
                value={draft.vat_on_disbursement_fee}
                onChange={(e) => setDraft({ ...draft, vat_on_disbursement_fee: e.target.value as Draft['vat_on_disbursement_fee'] })}
                className="w-full border border-border-strong rounded px-2 py-1.5 text-[12.5px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                <option value="unknown">Unknown / not discussed</option>
                <option value="yes">Yes (VAT-subject)</option>
                <option value="no">No (VAT-exempt)</option>
              </select>
            </Field>
            <Field label="Currency">
              <input
                value={draft.currency}
                onChange={(e) => setDraft({ ...draft, currency: e.target.value.toUpperCase().slice(0, 3) })}
                className="w-full border border-border-strong rounded px-2 py-1.5 text-[12.5px] font-mono uppercase focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </Field>
          </div>
          <div className="mt-2">
            <Field label="Disbursement notes" hint="optional — any carve-outs">
              <input
                value={draft.disbursement_notes}
                onChange={(e) => setDraft({ ...draft, disbursement_notes: e.target.value })}
                placeholder="e.g. 5% up to €100k, 4% above"
                className="w-full border border-border-strong rounded px-2 py-1.5 text-[12.5px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </Field>
          </div>
        </div>

        <Field label="Billing notes">
          <textarea
            value={draft.billing_notes}
            onChange={(e) => setDraft({ ...draft, billing_notes: e.target.value })}
            rows={2}
            placeholder="e.g. Billed quarterly in advance; invoice issued on the 1st of the period."
            className="w-full border border-border-strong rounded px-2 py-1.5 text-[12.5px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </Field>

        {/* Engagement letter upload */}
        <div className="pt-2 border-t border-emerald-200/60">
          <div className="text-[11px] uppercase tracking-wide font-semibold text-emerald-900 mb-2">
            Engagement letter
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Signed on" hint="YYYY-MM-DD">
              <input
                type="date"
                value={draft.engagement_letter_signed_on}
                onChange={(e) => setDraft({ ...draft, engagement_letter_signed_on: e.target.value })}
                className="w-full border border-border-strong rounded px-2 py-1.5 text-[12.5px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </Field>
            <div className="flex flex-col justify-end">
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf,image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadEngagementLetter(f);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="h-9 px-3 rounded border border-emerald-300 bg-emerald-50 text-emerald-800 text-[12px] font-medium hover:bg-emerald-100 disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
              >
                {uploading
                  ? <Loader2Icon size={12} className="animate-spin" />
                  : <UploadCloudIcon size={12} />}
                {billing?.engagement_letter_filename ? 'Replace letter' : 'Upload letter'}
              </button>
            </div>
          </div>
          {billing?.engagement_letter_filename && (
            <div className="mt-2 text-[11px] text-ink-muted flex items-center gap-2">
              <FileTextIcon size={11} /> Current: {billing.engagement_letter_filename}
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          onClick={() => setEditing(false)}
          disabled={saving}
          className="h-8 px-3 rounded border border-border-strong text-[12px] text-ink-muted hover:text-ink"
        >
          Cancel
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="h-8 px-4 rounded bg-emerald-600 text-white text-[12px] font-semibold hover:bg-emerald-700 disabled:opacity-50 inline-flex items-center gap-1"
        >
          {saving ? <Loader2Icon size={12} className="animate-spin" /> : <CheckIcon size={12} />}
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

function Field({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[10.5px] uppercase tracking-wide font-semibold text-ink-muted mb-0.5 flex items-baseline gap-2">
        <span>{label}</span>
        {hint && <span className="text-[9.5px] text-ink-faint normal-case tracking-normal font-normal">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

function EuroField({
  label, value, onChange, currency, hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  currency: string;
  hint?: string;
}) {
  const symbol = currency === 'EUR' ? '€' : currency === 'USD' ? '$' : currency === 'GBP' ? '£' : currency;
  return (
    <Field label={label} hint={hint}>
      <div className="relative">
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11.5px] text-ink-muted">{symbol}</span>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0.00"
          inputMode="decimal"
          className="w-full border border-border-strong rounded pl-6 pr-2 py-1.5 text-[12.5px] font-mono focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
      </div>
    </Field>
  );
}

function FeeItem({
  label, cents, currency, suffix,
}: {
  label: string;
  cents: number | null;
  currency: string;
  suffix?: string;
}) {
  if (cents == null) {
    return (
      <div>
        <div className="text-[10px] uppercase tracking-wide text-ink-faint">{label}</div>
        <div className="text-ink-faint italic text-[11.5px]">—</div>
      </div>
    );
  }
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-ink-muted">{label}</div>
      <div className="text-ink font-semibold">
        {fmtMoney(cents, currency)}{suffix && <span className="text-[10.5px] text-ink-muted font-normal">{suffix}</span>}
      </div>
    </div>
  );
}

// ────────────────────────────────── helpers

function centsToEuros(cents: number | null): string {
  if (cents == null) return '';
  return (cents / 100).toFixed(2);
}

function eurosToCentsOrNull(raw: string): number | null {
  const s = raw.trim().replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function pctToBpsOrNull(raw: string): number | null {
  const s = raw.trim().replace(',', '.').replace('%', '');
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  // percent → basis points. 4.25% → 425 bps.
  return Math.round(n * 100);
}

function fmtMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency, maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}
