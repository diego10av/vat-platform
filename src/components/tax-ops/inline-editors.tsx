'use client';

// ════════════════════════════════════════════════════════════════════════
// Concrete inline editors wired on top of InlineCellEditor.
//
// Exports four ready-to-use cell editors:
//   - InlineStatusCell      — status badge + dropdown
//   - InlineTextCell        — comment / short free text
//   - InlineTagsCell        — prepared_with-style string[]
//   - InlineDateCell        — date picker
//
// They all share the "click to edit → save on click-outside / Enter /
// blur, cancel on ESC" rhythm from InlineCellEditor.
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useRef } from 'react';
import { XIcon } from 'lucide-react';
import { InlineCellEditor } from './InlineCellEditor';
import { FilingStatusBadge, FILING_STATUSES, filingStatusLabel } from './FilingStatusBadge';
import { DateBadge } from '@/components/crm/DateBadge';

// ─── Status ──────────────────────────────────────────────────────────

export function InlineStatusCell({
  value, onSave, disabled,
}: {
  value: string;
  onSave: (next: string) => Promise<void>;
  disabled?: boolean;
}) {
  return (
    <InlineCellEditor<string>
      value={value}
      onSave={onSave}
      disabled={disabled}
      inline
      ariaLabel="Edit status"
      renderDisplay={(v) => <FilingStatusBadge status={v} />}
      renderEditor={({ value, setValue, commit }) => (
        <AutoSelect
          value={value}
          onChange={(next) => {
            setValue(next);
            // Fire save immediately on selection. Pass `next` explicitly
            // so commit isn't racing React's async setDraft batching
            // (caught a real bug here: pre-fix commit() read stale draft
            // and silently no-op'd because draft === value).
            setTimeout(() => commit(next), 0);
          }}
        >
          {FILING_STATUSES.map(s => (
            <option key={s} value={s}>{filingStatusLabel(s)}</option>
          ))}
        </AutoSelect>
      )}
    />
  );
}

// ─── Short text (comments — single line preview, popover multiline) ───

export function InlineTextCell({
  value, onSave, placeholder, disabled, multiline = false, hoverReveal = false,
}: {
  value: string | null;
  onSave: (next: string | null) => Promise<void>;
  placeholder?: string;
  disabled?: boolean;
  multiline?: boolean;
  /**
   * Stint 64.X.12 — when `true`, an empty cell renders `—` at rest and
   * reveals the placeholder hint only on row hover (parent `<tr>` must
   * carry the `group` class — TaxTypeMatrix already does). Default
   * `false` preserves the always-visible placeholder so non-matrix
   * call sites (CRM activity / opportunity detail / form-like layouts
   * with no `group` ancestor) keep working.
   */
  hoverReveal?: boolean;
}) {
  return (
    <InlineCellEditor<string>
      value={value ?? ''}
      onSave={async (next) => onSave(next.trim() === '' ? null : next.trim())}
      disabled={disabled}
      inline
      ariaLabel="Edit text"
      renderDisplay={(v) => (
        <span
          className={v ? 'text-ink-soft text-xs line-clamp-2' : 'text-ink-faint italic text-xs whitespace-nowrap'}
          title={v || (placeholder ?? 'Add note…')}
        >
          {v || (hoverReveal ? (
            <>
              <span className="group-hover:hidden">—</span>
              <span className="hidden group-hover:inline">{placeholder ?? 'Add note…'}</span>
            </>
          ) : (placeholder ?? 'Add note…'))}
        </span>
      )}
      renderEditor={({ value, setValue, commit, cancel }) =>
        multiline ? (
          <AutoTextarea
            value={value}
            onChange={setValue}
            onCommit={commit}
            onCancel={cancel}
            placeholder={placeholder}
          />
        ) : (
          <AutoInput
            value={value}
            onChange={setValue}
            onCommit={commit}
            onCancel={cancel}
            placeholder={placeholder}
          />
        )
      }
    />
  );
}

// ─── Tags (string[]) — comma-separated input ─────────────────────────

export function InlineTagsCell({
  value, onSave, placeholder, disabled, hoverReveal = false,
}: {
  value: string[];
  onSave: (next: string[]) => Promise<void>;
  placeholder?: string;
  disabled?: boolean;
  /** Stint 64.X.12 — see InlineTextCell. */
  hoverReveal?: boolean;
}) {
  return (
    <InlineCellEditor<string[]>
      value={value}
      onSave={onSave}
      disabled={disabled}
      inline
      ariaLabel="Edit tags"
      renderDisplay={(v) => (
        v.length === 0
          ? (
            <span className="text-ink-faint italic text-xs whitespace-nowrap" title={placeholder ?? 'Add…'}>
              {hoverReveal ? (
                <>
                  <span className="group-hover:hidden">—</span>
                  <span className="hidden group-hover:inline">{placeholder ?? 'Add…'}</span>
                </>
              ) : (placeholder ?? 'Add…')}
            </span>
          )
          : <span className="text-ink-soft text-xs">{v.join(', ')}</span>
      )}
      renderEditor={({ value, setValue, commit, cancel }) => (
        <AutoInput
          value={value.join(', ')}
          onChange={(raw) => setValue(raw.split(',').map(s => s.trim()).filter(Boolean))}
          onCommit={commit}
          onCancel={cancel}
          placeholder={placeholder ?? ''}
        />
      )}
    />
  );
}

// ─── Date (native picker) ─────────────────────────────────────────────

export function InlineDateCell({
  value, onSave, mode = 'urgency', disabled,
}: {
  value: string | null;
  onSave: (next: string | null) => Promise<void>;
  mode?: 'urgency' | 'neutral';
  disabled?: boolean;
}) {
  return (
    <InlineCellEditor<string>
      value={value ?? ''}
      onSave={async (next) => onSave(next === '' ? null : next)}
      disabled={disabled}
      inline
      ariaLabel="Edit date"
      renderDisplay={(v) => <DateBadge value={v || null} mode={mode} />}
      renderEditor={({ value, setValue, commit, cancel }) => (
        <div className="inline-flex items-center gap-1">
          <input
            type="date"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commit(); }
              else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
            }}
            onBlur={() => commit()}
            className="px-1.5 py-0.5 text-xs border border-border rounded bg-surface tabular-nums"
          />
          {value && (
            <button
              type="button"
              // Stint 106 — explicit clear (✕). Native <input type="date">
              // hides its clear affordance behind browser quirks (Chrome
              // Mac shows a tiny ✕, Safari refuses value=""), so the
              // discoverable path was non-existent. preventDefault on
              // mousedown stops the input from blurring first — without
              // it, onBlur fires commit() with the OLD draft and races
              // the explicit clear.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => commit('')}
              title="Clear date"
              aria-label="Clear date"
              className="p-0.5 text-ink-muted hover:text-danger-600 rounded"
            >
              <XIcon size={11} />
            </button>
          )}
        </div>
      )}
    />
  );
}

// ─── Price (€ number + free-text note, stint 40.O) ─────────────────

/**
 * InlinePriceCell — edits an invoice_price_eur (NUMERIC) and
 * invoice_price_note (TEXT) pair in a single popover. Display shows
 * "€3,000 +5%" (truncated note) with the full note on hover.
 */
export function InlinePriceCell({
  priceEur, note, onSave, disabled, defaultNote = '+5% office expenses +VAT if applicable',
}: {
  priceEur: string | null;
  note: string | null;
  onSave: (next: { priceEur: string | null; note: string | null }) => Promise<void>;
  disabled?: boolean;
  defaultNote?: string;
}) {
  // Serialize the pair as "eur|note" for the InlineCellEditor value.
  const serial = `${priceEur ?? ''}|${note ?? ''}`;
  return (
    <InlineCellEditor<string>
      value={serial}
      onSave={async (next) => {
        const [eurStr = '', n = ''] = next.split('|');
        const eur = eurStr.trim() === '' ? null : eurStr.trim();
        const finalNote = n.trim() === '' ? null : n;
        await onSave({ priceEur: eur, note: finalNote });
      }}
      disabled={disabled}
      ariaLabel="Edit invoice price"
      renderDisplay={() => {
        if (!priceEur) {
          return <span className="text-ink-faint italic text-xs">—</span>;
        }
        const fmtEur = (() => {
          const n = Number(priceEur);
          if (!Number.isFinite(n)) return priceEur;
          return `€${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
        })();
        const compactNote = note
          ? (note.length > 14 ? `${note.slice(0, 14)}…` : note)
          : '';
        return (
          <span
            className="inline-block text-xs text-ink font-mono whitespace-nowrap"
            title={note ?? ''}
          >
            {fmtEur}{compactNote ? <span className="text-ink-muted"> {compactNote}</span> : null}
          </span>
        );
      }}
      renderEditor={({ value, setValue, commit, cancel }) => {
        const [curEur = '', curNote = ''] = value.split('|');
        const effNote = curNote || (priceEur ? '' : defaultNote);
        return (
          <div className="flex flex-col gap-1 p-1 w-[260px] bg-surface border border-border rounded shadow-sm">
            <label className="text-xs text-ink-muted">Price (€)</label>
            <input
              type="number"
              step="1"
              min="0"
              autoFocus
              value={curEur}
              onChange={(e) => setValue(`${e.target.value}|${effNote}`)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commit(); }
                else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
              }}
              className="px-1.5 py-1 text-sm border border-border rounded bg-surface tabular-nums"
              placeholder="e.g. 3000"
            />
            <label className="text-xs text-ink-muted mt-1">Note (shown next to €)</label>
            <textarea
              value={effNote}
              onChange={(e) => setValue(`${curEur}|${e.target.value}`)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault(); commit();
                } else if (e.key === 'Escape') {
                  e.preventDefault(); cancel();
                }
              }}
              rows={2}
              className="px-1.5 py-1 text-xs border border-border rounded bg-surface"
              placeholder="+5% office expenses +VAT if applicable"
            />
            <div className="flex justify-end gap-1 mt-1">
              <button
                type="button"
                onClick={cancel}
                className="px-2 py-0.5 text-xs rounded border border-border hover:bg-surface-alt"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => commit()}
                className="px-2 py-0.5 text-xs rounded bg-brand-500 text-white hover:bg-brand-600"
              >
                Save
              </button>
            </div>
          </div>
        );
      }}
    />
  );
}

// ═════════════════════════════════════════════════════════════════════
// Private building blocks — tiny input primitives that auto-focus +
// handle Enter/ESC commit/cancel.
// ═════════════════════════════════════════════════════════════════════

function AutoSelect({
  value, onChange, children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLSelectElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <select
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="px-1.5 py-0.5 text-xs border border-border rounded bg-surface"
    >
      {children}
    </select>
  );
}

function AutoInput({
  value, onChange, onCommit, onCancel, placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  placeholder?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); onCommit(); }
        else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      }}
      onBlur={onCommit}
      className="px-1.5 py-0.5 text-xs border border-border rounded bg-surface w-full min-w-[140px]"
    />
  );
}

function AutoTextarea({
  value, onChange, onCommit, onCancel, placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <textarea
      ref={ref}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        // ⌘/Ctrl+Enter to commit, Enter inserts newline.
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          onCommit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
      onBlur={onCommit}
      rows={3}
      className="px-1.5 py-1 text-xs border border-border rounded bg-surface w-full min-w-[200px]"
    />
  );
}
