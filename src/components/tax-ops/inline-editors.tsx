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
            // fire save immediately on selection — matches Linear's pattern
            setTimeout(() => commit(), 0);
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
  value, onSave, placeholder, disabled, multiline = false,
}: {
  value: string | null;
  onSave: (next: string | null) => Promise<void>;
  placeholder?: string;
  disabled?: boolean;
  multiline?: boolean;
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
          className={v ? 'text-ink-soft text-[11.5px] line-clamp-2' : 'text-ink-faint italic text-[11.5px]'}
          title={v || undefined}
        >
          {v || (placeholder ?? 'Add note…')}
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
  value, onSave, placeholder, disabled,
}: {
  value: string[];
  onSave: (next: string[]) => Promise<void>;
  placeholder?: string;
  disabled?: boolean;
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
          ? <span className="text-ink-faint italic text-[11.5px]">{placeholder ?? 'Add…'}</span>
          : <span className="text-ink-soft text-[11.5px]">{v.join(', ')}</span>
      )}
      renderEditor={({ value, setValue, commit, cancel }) => (
        <AutoInput
          value={value.join(', ')}
          onChange={(raw) => setValue(raw.split(',').map(s => s.trim()).filter(Boolean))}
          onCommit={commit}
          onCancel={cancel}
          placeholder={placeholder ?? 'Gab, Andrew'}
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
          className="px-1.5 py-0.5 text-[11.5px] border border-border rounded bg-surface tabular-nums"
        />
      )}
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
      className="px-1.5 py-0.5 text-[11px] border border-border rounded bg-surface"
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
      className="px-1.5 py-0.5 text-[11.5px] border border-border rounded bg-surface w-full min-w-[140px]"
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
      className="px-1.5 py-1 text-[11.5px] border border-border rounded bg-surface w-full min-w-[200px]"
    />
  );
}
