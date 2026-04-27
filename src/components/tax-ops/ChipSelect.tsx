'use client';

// Stint 58.T2.3 — chip-styled select with a popover-on-click editor.
//
// Replacement for the native <select> elements that proliferated on
// the tasks list. Native selects don't honour cifra's design tokens
// and look amateur next to Linear/Asana. This component renders a
// compact chip with the current label + tone; click opens a tiny
// floating menu with the options.
//
// Same accessibility commitments as the rest of the design system:
//   - role="combobox" + aria-expanded
//   - Escape closes
//   - Click outside closes
//   - Keyboard arrows navigate the popover
//
// Position is computed from the trigger's rect each open + on
// scroll/resize, mirroring the SearchableSelect pattern.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDownIcon, CheckIcon } from 'lucide-react';

export interface ChipOption {
  value: string;
  label: string;
  /** Optional Tailwind classes applied to the chip when this option is
   *  selected (e.g. "bg-amber-100 text-amber-800"). */
  tone?: string;
}

interface Props {
  value: string;
  options: ChipOption[];
  onChange: (next: string) => void;
  ariaLabel: string;
  /** Forced label override — useful when the value is "" but you still
   *  want to show a placeholder like "—". */
  placeholder?: string;
  /** Extra Tailwind classes for the trigger chip. */
  className?: string;
  disabled?: boolean;
}

export function ChipSelect({
  value, options, onChange, ariaLabel, placeholder, className, disabled,
}: Props) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const selected = options.find(o => o.value === value);
  const label = selected?.label ?? placeholder ?? '—';
  const tone = selected?.tone ?? 'bg-surface-alt text-ink';

  function recompute() {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ top: r.bottom + 2, left: r.left, width: Math.max(r.width, 140) });
  }

  useLayoutEffect(() => { if (open) recompute(); }, [open]);

  useEffect(() => {
    if (!open) return;
    const onMove = () => recompute();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
    };
    const onClickOutside = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (triggerRef.current?.contains(t)) return;
      const popover = document.querySelector('[data-chip-select-popover="open"]');
      if (popover && popover.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClickOutside);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClickOutside);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => !disabled && setOpen(o => !o)}
        className={[
          'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-2xs font-medium max-w-full',
          tone,
          disabled ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-80 cursor-pointer',
          className ?? '',
        ].join(' ')}
        title={ariaLabel}
      >
        <span className="truncate">{label}</span>
        {!disabled && <ChevronDownIcon size={9} className="shrink-0" />}
      </button>
      {mounted && open && pos && createPortal(
        <ul
          data-chip-select-popover="open"
          role="listbox"
          aria-label={ariaLabel}
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            minWidth: pos.width,
          }}
          className="z-popover bg-surface border border-border rounded-md shadow-lg py-1 max-h-[280px] overflow-y-auto"
        >
          {options.map((o) => {
            const isSelected = o.value === value;
            return (
              <li key={o.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => { onChange(o.value); setOpen(false); }}
                  className={[
                    'w-full text-left px-2 py-1 text-sm flex items-center gap-2',
                    isSelected ? 'bg-brand-50 text-brand-800' : 'hover:bg-surface-alt',
                  ].join(' ')}
                >
                  <span className="flex-1 truncate">{o.label}</span>
                  {isSelected && <CheckIcon size={11} className="shrink-0 text-brand-700" />}
                </button>
              </li>
            );
          })}
        </ul>,
        document.body,
      )}
    </>
  );
}
