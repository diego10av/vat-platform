'use client';

// BulkEditDrawer — right-side drawer for editing multiple CRM records
// at once. Companies + contacts.
//
// Stint 63.E (2026-04-28). Driven from BulkActionBar — when Diego
// selects N rows and clicks "Edit fields ✎", this drawer opens with a
// checkbox per field. Only fields whose checkbox is ticked get sent in
// the patch — so Diego can change classification on 5 companies
// without inadvertently nulling out their country.
//
// Fields are passed in by the call site so the same component serves
// companies and contacts (and future entity types).

import { useState } from 'react';
import { XIcon } from 'lucide-react';
import { useToast } from '@/components/Toaster';

export interface BulkEditField {
  key: string;
  label: string;
  type: 'select' | 'text';
  options?: Array<{ value: string; label: string }>; // for type=select
  placeholder?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** "company" / "contact" — used in the title + plurals. */
  recordType: string;
  selectedIds: string[];
  fields: BulkEditField[];
  /** Endpoint URL — POST receives `{ ids, patch }`. */
  endpoint: string;
  onApplied: () => void;
}

export function BulkEditDrawer({
  open, onClose, recordType, selectedIds, fields, endpoint, onApplied,
}: Props) {
  // Per-field state: enabled flag (checkbox) + value (input).
  const [state, setState] = useState<Record<string, { enabled: boolean; value: string }>>({});
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  function toggleField(key: string) {
    setState(s => {
      const cur = s[key] ?? { enabled: false, value: '' };
      return { ...s, [key]: { ...cur, enabled: !cur.enabled } };
    });
  }
  function setValue(key: string, value: string) {
    setState(s => {
      const cur = s[key] ?? { enabled: true, value: '' };
      return { ...s, [key]: { enabled: true, value } };
    });
  }

  // Patch = only the enabled fields, sending `null` when value === ''.
  const patch: Record<string, string | null> = {};
  for (const f of fields) {
    const fs = state[f.key];
    if (!fs?.enabled) continue;
    patch[f.key] = fs.value === '' ? null : fs.value;
  }
  const enabledCount = Object.keys(patch).length;

  async function apply() {
    if (enabledCount === 0) {
      toast.error('Tick at least one field to apply.');
      return;
    }
    if (!confirm(
      `Apply ${enabledCount} field change${enabledCount === 1 ? '' : 's'} to ` +
      `${selectedIds.length} ${recordType}${selectedIds.length === 1 ? '' : 's'}?`,
    )) return;
    setBusy(true);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedIds, patch }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message ?? `Bulk edit failed (${res.status})`);
      }
      const body = await res.json() as { affected: number };
      toast.success(`Updated ${body.affected} ${recordType}${body.affected === 1 ? '' : 's'}`);
      setState({});
      onApplied();
      onClose();
    } catch (e) {
      toast.error(`Bulk edit failed: ${String(e instanceof Error ? e.message : e)}`);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 z-modal"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Drawer */}
      <div
        className="fixed top-0 right-0 bottom-0 w-[420px] max-w-[90vw] bg-surface border-l border-border z-modal shadow-xl flex flex-col animate-slideInRight"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="text-base font-semibold text-ink">
              Bulk edit
            </h2>
            <p className="text-xs text-ink-muted mt-0.5">
              Editing {selectedIds.length} {recordType}{selectedIds.length === 1 ? '' : 's'}.
              Tick the fields you want to change — others stay untouched.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close drawer"
            className="p-1 rounded hover:bg-surface-alt text-ink-muted"
          >
            <XIcon size={16} />
          </button>
        </div>
        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {fields.map(f => {
            const fs = state[f.key] ?? { enabled: false, value: '' };
            return (
              <div key={f.key}>
                <label className="flex items-center gap-2 mb-1.5">
                  <input
                    type="checkbox"
                    checked={fs.enabled}
                    onChange={() => toggleField(f.key)}
                    className="h-4 w-4 accent-brand-500"
                  />
                  <span className="text-sm font-medium text-ink">{f.label}</span>
                </label>
                {f.type === 'select' ? (
                  <select
                    value={fs.value}
                    onChange={e => setValue(f.key, e.target.value)}
                    disabled={!fs.enabled}
                    className="w-full px-2.5 py-1.5 text-sm border border-border rounded-md bg-surface disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <option value="">— clear value —</option>
                    {f.options?.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={fs.value}
                    onChange={e => setValue(f.key, e.target.value)}
                    disabled={!fs.enabled}
                    placeholder={f.placeholder ?? '—'}
                    className="w-full px-2.5 py-1.5 text-sm border border-border rounded-md bg-surface disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                )}
              </div>
            );
          })}
        </div>
        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border shrink-0 bg-surface-alt/50">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-surface"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={busy || enabledCount === 0}
            className="px-3 py-1.5 text-sm rounded-md bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? 'Applying…' : `Apply${enabledCount > 0 ? ` (${enabledCount} field${enabledCount === 1 ? '' : 's'})` : ''}`}
          </button>
        </div>
      </div>
    </>
  );
}
