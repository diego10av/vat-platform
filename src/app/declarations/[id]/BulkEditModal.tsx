'use client';

// ════════════════════════════════════════════════════════════════════════
// BulkEditModal
//
// Opened from the BulkActionBar's "Edit fields…" button. Lets the
// reviewer change ONE or more fields across every selected line in a
// single call, then records it all in the audit trail — per line.
//
// Customer feedback (2026-04-18) driving this:
//
//   "Que se pudieran aplicar los cambios a varias facturas a la vez,
//    si fuese el mismo cambio" — bank tester.
//
//   Today they download Excel, edit in bulk, re-upload. We kill the
//   Excel round-trip by making this feel Excel-fast inside the app.
//
// Design: checkbox per field ("edit treatment?", "edit date?", "edit
// note?"). When ticked, the input for that field appears below. Only
// ticked fields are sent to the API — the patch is sparse. A single
// optional "reason" textarea applies to every audit row generated.
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { CheckIcon, XIcon, Loader2Icon, AlertTriangleIcon, ShieldCheckIcon } from 'lucide-react';
import { TREATMENT_CODES } from '@/config/treatment-codes';

type Direction = 'incoming' | 'outgoing';

interface Props {
  lineIds: string[];
  direction: Direction; // determines which treatments are offered
  onClose: () => void;
  onApplied: () => void;
}

// Fields the modal lets you touch. Mirrors the whitelist in
// /api/invoice-lines/bulk's 'update' action.
interface FieldState {
  treatment: { enabled: boolean; value: string };
  invoice_date: { enabled: boolean; value: string };
  description: { enabled: boolean; value: string };
  note: { enabled: boolean; value: string };
  reviewed: { enabled: boolean; value: boolean };
}

export function BulkEditModal({ lineIds, direction, onClose, onApplied }: Props) {
  const [fields, setFields] = useState<FieldState>({
    treatment:    { enabled: false, value: '' },
    invoice_date: { enabled: false, value: '' },
    description:  { enabled: false, value: '' },
    note:         { enabled: false, value: '' },
    reviewed:     { enabled: false, value: true },
  });
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  const treatments = direction === 'incoming' ? INCOMING_TREATMENTS : OUTGOING_TREATMENTS;
  const somethingEnabled = Object.values(fields).some(f => f.enabled);

  async function apply() {
    setError(null);
    if (!somethingEnabled) {
      setError('Tick at least one field to change.');
      return;
    }
    // Sparse patch — only enabled fields go.
    const patch: Record<string, unknown> = {};
    if (fields.treatment.enabled) {
      if (!fields.treatment.value) { setError('Pick a treatment code.'); return; }
      patch.treatment = fields.treatment.value;
    }
    if (fields.invoice_date.enabled) {
      if (!fields.invoice_date.value) { setError('Pick a date.'); return; }
      patch.invoice_date = fields.invoice_date.value;
    }
    if (fields.description.enabled) patch.description = fields.description.value;
    if (fields.note.enabled)        patch.note        = fields.note.value;
    if (fields.reviewed.enabled)    patch.reviewed    = fields.reviewed.value;

    setSubmitting(true);
    try {
      const res = await fetch('/api/invoice-lines/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: lineIds,
          action: 'update',
          patch,
          reason: reason.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? 'Failed to apply changes.');
        return;
      }
      onApplied();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-modal bg-ink/75 backdrop-blur-[6px] flex items-center justify-center p-4 animate-fadeIn"
      role="presentation"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-edit-title"
        className="bg-surface rounded-lg w-full max-w-lg shadow-2xl"
      >
        {/* Header */}
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div>
            <h3 id="bulk-edit-title" className="text-base font-semibold text-ink leading-tight">
              Edit {lineIds.length} line{lineIds.length === 1 ? '' : 's'}
            </h3>
            <p className="text-xs text-ink-muted mt-0.5 leading-tight">
              Tick the fields you want to change. Only ticked fields are touched.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close"
                  className="w-8 h-8 inline-flex items-center justify-center rounded-md hover:bg-surface-alt text-ink-soft">
            <XIcon size={15} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Treatment */}
          <FieldRow
            label="Treatment"
            hint="Applies to every selected line. Logged as an AI override where appropriate."
            enabled={fields.treatment.enabled}
            onToggle={(on) => setFields(f => ({ ...f, treatment: { ...f.treatment, enabled: on } }))}
          >
            <select
              value={fields.treatment.value}
              onChange={(e) => setFields(f => ({ ...f, treatment: { ...f.treatment, value: e.target.value } }))}
              className="w-full h-9 px-3 text-sm border border-border-strong rounded-md bg-surface"
            >
              <option value="">Pick a treatment code…</option>
              {treatments.map(t => (
                <option key={t} value={t}>
                  {t} — {TREATMENT_CODES[t].label}
                </option>
              ))}
            </select>
          </FieldRow>

          {/* Invoice date — applies to the INVOICES (parent of lines), not lines */}
          <FieldRow
            label="Invoice date"
            hint="Applies to the invoices that contain the selected lines."
            enabled={fields.invoice_date.enabled}
            onToggle={(on) => setFields(f => ({ ...f, invoice_date: { ...f.invoice_date, enabled: on } }))}
          >
            <input
              type="date"
              value={fields.invoice_date.value}
              onChange={(e) => setFields(f => ({ ...f, invoice_date: { ...f.invoice_date, value: e.target.value } }))}
              className="w-full h-9 px-3 text-sm border border-border-strong rounded-md bg-surface"
            />
          </FieldRow>

          {/* Description */}
          <FieldRow
            label="Description"
            hint="Replaces the description on every selected line."
            enabled={fields.description.enabled}
            onToggle={(on) => setFields(f => ({ ...f, description: { ...f.description, enabled: on } }))}
          >
            <input
              type="text"
              value={fields.description.value}
              onChange={(e) => setFields(f => ({ ...f, description: { ...f.description, value: e.target.value } }))}
              placeholder="e.g. Consulting services Q1"
              className="w-full h-9 px-3 text-sm border border-border-strong rounded-md bg-surface"
            />
          </FieldRow>

          {/* Note */}
          <FieldRow
            label="Note"
            hint="Internal note (not on the filing). Replaces any existing note on the selected lines."
            enabled={fields.note.enabled}
            onToggle={(on) => setFields(f => ({ ...f, note: { ...f.note, enabled: on } }))}
          >
            <textarea
              value={fields.note.value}
              onChange={(e) => setFields(f => ({ ...f, note: { ...f.note, value: e.target.value } }))}
              rows={2}
              className="w-full px-3 py-2 text-sm border border-border-strong rounded-md bg-surface resize-none"
            />
          </FieldRow>

          {/* Reviewed toggle */}
          <FieldRow
            label="Mark reviewed"
            hint="Flag these lines as reviewed by you."
            enabled={fields.reviewed.enabled}
            onToggle={(on) => setFields(f => ({ ...f, reviewed: { ...f.reviewed, enabled: on } }))}
          >
            <div className="flex items-center gap-4">
              <label className="inline-flex items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  checked={fields.reviewed.value === true}
                  onChange={() => setFields(f => ({ ...f, reviewed: { ...f.reviewed, value: true } }))}
                />
                <CheckIcon size={13} className="text-emerald-600" />
                Reviewed
              </label>
              <label className="inline-flex items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  checked={fields.reviewed.value === false}
                  onChange={() => setFields(f => ({ ...f, reviewed: { ...f.reviewed, value: false } }))}
                />
                Not reviewed
              </label>
            </div>
          </FieldRow>

          {/* Reason */}
          <div className="pt-2 border-t border-divider">
            <label className="block text-sm font-medium text-ink mb-1 flex items-center gap-1.5">
              <ShieldCheckIcon size={12} className="text-brand-600" />
              Reason <span className="text-ink-faint font-normal">(optional — recorded in the audit trail)</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Supplier re-issued with corrected date in follow-up email."
              rows={2}
              maxLength={500}
              className="w-full px-3 py-2 text-sm border border-border-strong rounded-md bg-surface resize-none"
            />
          </div>

          {error && (
            <div className="text-xs text-danger-700 bg-danger-50 border border-danger-200 rounded px-3 py-2 flex items-start gap-2">
              <AlertTriangleIcon size={13} className="mt-0.5 shrink-0" />
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border bg-surface-alt flex items-center justify-between">
          <div className="text-2xs text-ink-faint">
            Every actual change is logged per line in the audit trail.
          </div>
          <div className="flex gap-2">
            <button onClick={onClose}
                    className="h-9 px-3 rounded border border-border-strong text-sm font-medium text-ink-soft hover:bg-surface-alt">
              Cancel
            </button>
            <button
              onClick={apply}
              disabled={submitting || !somethingEnabled}
              className="h-9 px-4 rounded bg-brand-500 text-white text-sm font-semibold hover:bg-brand-600 disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {submitting
                ? (<><Loader2Icon size={13} className="animate-spin" /> Applying…</>)
                : (<><CheckIcon size={13} /> Apply to {lineIds.length}</>)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FieldRow({
  label, hint, enabled, onToggle, children,
}: {
  label: string;
  hint?: string;
  enabled: boolean;
  onToggle: (on: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className={enabled ? '' : 'opacity-75'}>
      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onToggle(e.target.checked)}
          className="mt-0.5 accent-brand-500 cursor-pointer"
        />
        <div className="flex-1">
          <span className="text-sm font-medium text-ink">{label}</span>
          {hint && <div className="text-2xs text-ink-muted leading-snug mt-0.5">{hint}</div>}
        </div>
      </label>
      {enabled && (
        <div className="mt-2 pl-6 animate-fadeIn">
          {children}
        </div>
      )}
    </div>
  );
}

// Derive treatment lists from TREATMENT_CODES itself so the picker
// never drifts from the canonical config. Both lists are sorted
// alphabetically for predictable scanning.
const INCOMING_TREATMENTS = (Object.keys(TREATMENT_CODES) as (keyof typeof TREATMENT_CODES)[])
  .filter(k => TREATMENT_CODES[k].direction === 'incoming')
  .sort();
const OUTGOING_TREATMENTS = (Object.keys(TREATMENT_CODES) as (keyof typeof TREATMENT_CODES)[])
  .filter(k => TREATMENT_CODES[k].direction === 'outgoing')
  .sort();
