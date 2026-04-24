'use client';

// ════════════════════════════════════════════════════════════════════════
// InlineCellEditor — tiny state machine for "click display → edit →
// save/cancel" cells in the tax-type matrix. Optimistic UI: the parent
// gets an onSave callback that returns a Promise; the editor shows
// saving state and reverts on error.
//
// Used for status dropdowns, prepared-with tag inputs, comment text,
// and date picks. Each consumer picks its own inner editor via the
// `editor` render prop; this component owns the show/edit toggle +
// click-outside + ESC handling + error display.
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState, useCallback } from 'react';
import type { ReactNode } from 'react';

export interface InlineEditorRenderArgs<T> {
  value: T;
  setValue: (v: T) => void;
  commit: () => void;      // trigger save + exit edit mode
  cancel: () => void;      // exit without save
}

interface Props<T> {
  /** Current value (display form). */
  value: T;
  /** Render the display node (the clickable target). */
  renderDisplay: (value: T) => ReactNode;
  /** Render the edit control (dropdown, input, textarea, …). */
  renderEditor: (args: InlineEditorRenderArgs<T>) => ReactNode;
  /** Persist. Throw or return rejected Promise to signal failure. */
  onSave: (next: T) => Promise<void>;
  /** Disabled state (e.g. no obligation exists). */
  disabled?: boolean;
  /** Compact layout: inline-block; default is block. */
  inline?: boolean;
  /** Extra class on the wrapper. */
  className?: string;
  /** Optional ARIA label for accessibility. */
  ariaLabel?: string;
}

export function InlineCellEditor<T>({
  value, renderDisplay, renderEditor, onSave,
  disabled = false, inline = false, className = '', ariaLabel,
}: Props<T>) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<T>(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLSpanElement | HTMLDivElement | null>(null);

  // Reset draft whenever incoming value changes (e.g. after refetch).
  useEffect(() => { if (!isEditing) setDraft(value); }, [value, isEditing]);

  const commit = useCallback(async () => {
    // Avoid unnecessary save if draft equals current value.
    if (draft === value || JSON.stringify(draft) === JSON.stringify(value)) {
      setIsEditing(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(draft);
      setIsEditing(false);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }, [draft, value, onSave]);

  const cancel = useCallback(() => {
    setDraft(value);
    setIsEditing(false);
    setError(null);
  }, [value]);

  // ESC = cancel. Global-listener so it fires even when focus is on the
  // native dropdown/date-picker pop-up.
  useEffect(() => {
    if (!isEditing) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isEditing, cancel]);

  // Click-outside = save (unless busy). Standard Linear/Notion pattern.
  useEffect(() => {
    if (!isEditing) return;
    const handler = (e: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (wrapperRef.current.contains(e.target as Node)) return;
      if (busy) return;
      void commit();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isEditing, busy, commit]);

  const Wrapper = inline ? 'span' : 'div';

  if (disabled) {
    return (
      <Wrapper className={className}>
        {renderDisplay(value)}
      </Wrapper>
    );
  }

  return (
    <Wrapper
      ref={wrapperRef as never}
      className={className}
      aria-label={ariaLabel}
    >
      {isEditing ? (
        <span className="relative">
          {renderEditor({ value: draft, setValue: setDraft, commit, cancel })}
          {busy && (
            <span className="ml-1 text-[10px] text-ink-muted italic">saving…</span>
          )}
          {error && (
            <span
              className="block text-[10px] text-danger-700 mt-0.5 truncate max-w-[200px]"
              title={error}
            >
              {error}
            </span>
          )}
        </span>
      ) : (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsEditing(true);
          }}
          className="inline text-left hover:bg-brand-50/50 rounded px-0.5 cursor-text"
        >
          {renderDisplay(value)}
        </button>
      )}
    </Wrapper>
  );
}
