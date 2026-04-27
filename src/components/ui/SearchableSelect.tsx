'use client';

// Stint 43.D8 — Searchable single-select combobox.
//
// Diego's complaint: native <select> with 20+ options is unusable when
// you don't remember the exact name. Today's family selector is fine
// (~20 options) but in 6 months it'll be 50+. Same for partner/associate
// filters when the team grows.
//
// Why not use a library: react-select / radix-combobox add ~30KB. We
// only need: input + filtered list + click-to-pick + ESC/arrows. ~100
// lines of vanilla React do it.
//
// Behaviour:
//   • Click trigger → opens popup with search input pre-focused.
//   • Type → filters list (case-insensitive substring match).
//   • Enter → picks the highlighted item.
//   • Click outside / ESC → closes without change.
//   • Arrow up/down → moves highlight.
//
// Caller controls value via `value` + `onChange`. `options` is the full
// list. The component does NOT enforce that `value` exists in options —
// if it doesn't, the trigger shows the raw value verbatim (useful for
// special tokens like 'all' / '__unassigned' that we render on top of
// the regular options as separate entries).

import { useState, useRef, useEffect, useMemo, useId } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';

export interface SearchableOption {
  value: string;
  label: string;
  /** Optional class applied to the rendered <li> for visual differentiation
   *  (e.g. coloured family chips). Doesn't affect filtering. */
  className?: string;
}

interface Props {
  options: SearchableOption[];
  value: string | null;
  onChange: (next: string) => void;
  placeholder?: string;
  /** Optional class on the trigger — caller controls width / colour. */
  triggerClassName?: string;
  /** ARIA label for the trigger button + search input. */
  ariaLabel?: string;
  /** When `true`, no popup, no events fire. Useful for read-only rows. */
  disabled?: boolean;
  /**
   * Stint 48.B3 — when true, the trigger button skips the default
   * border / bg / min-width styling so `triggerClassName` is the sole
   * styling source. Used by FamilyInlineSelect so the family chip's
   * `bg-{tone}-100` actually shows (the default `bg-surface` was
   * overriding it deterministically).
   */
  bare?: boolean;
}

export function SearchableSelect({
  options, value, onChange, placeholder = 'Select…',
  triggerClassName, ariaLabel, disabled, bare,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  // Stint 49.B2 — popup is portaled to body (not anchored to the trigger
  // via position:absolute) so it cannot be clipped by an overflow:auto
  // ancestor (e.g. the matrix wrapper). We compute its viewport position
  // from the trigger's bounding rect on open + reposition on scroll/resize.
  const [popupPos, setPopupPos] = useState<{ left: number; top: number; minWidth: number } | null>(null);

  function recomputePos() {
    const t = triggerRef.current;
    if (!t) return;
    const r = t.getBoundingClientRect();
    setPopupPos({
      left: r.left,
      top: r.bottom + 4,           // 4px gap below trigger
      minWidth: Math.max(r.width, 200),
    });
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o =>
      o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
    );
  }, [options, query]);

  // Selected option lookup for the trigger label.
  const selected = options.find(o => o.value === value) ?? null;

  // Click-outside to close — listens on the document since the popup
  // lives in a portal (outside the wrapperRef tree).
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapperRef.current?.contains(target)) return;
      // Allow clicks inside the portaled popup
      const popup = document.getElementById(listboxId);
      if (popup?.parentElement?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [open, listboxId]);

  // Auto-focus the search input when opening + position the portaled popup.
  useEffect(() => {
    if (open) {
      recomputePos();
      requestAnimationFrame(() => inputRef.current?.focus());
      setHighlight(Math.max(0, filtered.findIndex(o => o.value === value)));
    } else {
      setQuery('');
      setPopupPos(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Reposition the portaled popup when the page scrolls or resizes —
  // necessary because the popup is fixed-position relative to the
  // viewport while the trigger may scroll inside the matrix wrapper.
  useEffect(() => {
    if (!open) return;
    const onScroll = () => recomputePos();
    const onResize = () => recomputePos();
    window.addEventListener('scroll', onScroll, true);   // capture, catches inner scrolls
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  // Reset highlight on query change
  useEffect(() => {
    setHighlight(0);
  }, [query]);

  function commit(opt: SearchableOption) {
    onChange(opt.value);
    setOpen(false);
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight(h => Math.min(filtered.length - 1, h + 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight(h => Math.max(0, h - 1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const opt = filtered[highlight];
      if (opt) commit(opt);
      return;
    }
  }

  // Stint 49.B2 — popup portaled to body so overflow-auto ancestors
  // (matrix wrapper) cannot clip it.
  const popup = open && popupPos && typeof document !== 'undefined' ? createPortal(
    <div
      className="fixed z-popover bg-surface border border-border rounded-md shadow-lg overflow-hidden"
      style={{
        left: popupPos.left,
        top: popupPos.top,
        minWidth: popupPos.minWidth,
        maxWidth: 360,
      }}
      role="dialog"
    >
      <div className="p-1.5 border-b border-border">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Search…"
          aria-label={`${ariaLabel ?? 'Search'} (search)`}
          className="w-full px-2 py-1 text-sm border border-border rounded bg-surface"
        />
      </div>
      <ul
        id={listboxId}
        role="listbox"
        aria-label={ariaLabel}
        className="max-h-[280px] overflow-auto py-0.5"
      >
        {filtered.length === 0 ? (
          <li className="px-2.5 py-1.5 text-sm text-ink-faint italic">No matches</li>
        ) : filtered.map((opt, i) => (
          <li
            key={opt.value}
            role="option"
            aria-selected={opt.value === value}
            onMouseEnter={() => setHighlight(i)}
            onClick={() => commit(opt)}
            className={[
              'px-2.5 py-1 text-sm cursor-pointer truncate',
              i === highlight ? 'bg-brand-50' : '',
              opt.value === value ? 'font-medium' : '',
              opt.className ?? '',
            ].join(' ')}
          >
            {opt.label}
          </li>
        ))}
      </ul>
    </div>,
    document.body,
  ) : null;

  return (
    <div ref={wrapperRef} className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        disabled={disabled}
        onClick={() => !disabled && setOpen(o => !o)}
        className={[
          'inline-flex items-center justify-between gap-1 px-2 py-1 text-sm rounded-md disabled:opacity-50',
          // Default chrome — only when not in "bare" mode so the caller
          // can fully control bg/border/width via triggerClassName.
          bare ? '' : 'border border-border bg-surface min-w-[120px] hover:bg-surface-alt',
          triggerClassName ?? '',
        ].join(' ')}
      >
        <span className="truncate text-left">
          {selected ? selected.label : (value ? value : <span className="text-ink-faint">{placeholder}</span>)}
        </span>
        <ChevronDown size={12} className="shrink-0 text-ink-muted" />
      </button>
      {popup}
    </div>
  );
}
