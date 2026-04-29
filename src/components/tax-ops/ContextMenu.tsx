'use client';

// ════════════════════════════════════════════════════════════════════════
// ContextMenu — stint 64.O F4
//
// Right-click popup for matrix rows. Excel + Notion pattern: point at a
// row, hit secondary-click, get a small list of fast actions without
// having to open the detail drawer. Big4 partners use this dozens of
// times a day — it's the difference between "this tool feels modern"
// and "this tool feels like a 2008 spreadsheet view".
//
// Usage:
//   const cm = useContextMenu();
//   <tr onContextMenu={cm.openAt} onClick={...}>...</tr>
//   {cm.render({ items: [
//     { label: 'Open entity', onClick: () => router.push(...) },
//     { label: 'Copy name',   onClick: () => navigator.clipboard.writeText(name) },
//   ]})}
//
// The popup is portaled to body so it isn't clipped by overflow:auto
// ancestors (e.g. the matrix wrapper). Closes on:
//   • click outside the popup
//   • ESC key
//   • selecting an item
// ════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface ContextMenuItem {
  label: string;
  /** Optional icon component (e.g. lucide-react). */
  icon?: ReactNode;
  /** Disabled items render greyed and don't fire onClick. */
  disabled?: boolean;
  /** Marks dangerous items (red text) — e.g. "Delete row". */
  danger?: boolean;
  onClick: () => void;
}

interface MenuState {
  open: boolean;
  x: number;
  y: number;
}

export function useContextMenu() {
  const [state, setState] = useState<MenuState>({ open: false, x: 0, y: 0 });

  const openAt = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setState({ open: true, x: e.clientX, y: e.clientY });
  }, []);

  const close = useCallback(() => {
    setState(prev => prev.open ? { ...prev, open: false } : prev);
  }, []);

  // ESC + click-outside.
  useEffect(() => {
    if (!state.open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    const onClickAnywhere = () => close();
    window.addEventListener('keydown', onKey);
    // Use mousedown so the click that selects the item registers BEFORE
    // close fires — without this we'd close on the same mousedown that
    // would have triggered the item.
    window.addEventListener('mousedown', onClickAnywhere);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClickAnywhere);
    };
  }, [state.open, close]);

  const render = useCallback(
    ({ items }: { items: ContextMenuItem[] }) => {
      if (!state.open || typeof document === 'undefined' || items.length === 0) return null;
      // Clamp to viewport — keep the menu away from the right/bottom
      // edge so a click at e.g. (innerWidth - 40, ...) doesn't render
      // half off-screen.
      const W = 220, H = items.length * 32 + 8;
      const left = Math.min(state.x, window.innerWidth  - W - 4);
      const top  = Math.min(state.y, window.innerHeight - H - 4);
      return createPortal(
        <div
          role="menu"
          // Stop the global mousedown listener from closing on the
          // very click that should select an item.
          onMouseDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
          className="fixed z-popover bg-surface border border-border rounded-md shadow-lg overflow-hidden min-w-[200px] py-1"
          style={{ left, top }}
        >
          {items.map((item, i) => (
            <button
              key={i}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                if (item.disabled) return;
                item.onClick();
                close();
              }}
              className={[
                'w-full text-left px-3 py-1.5 text-sm flex items-center gap-2',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                item.danger
                  ? 'text-danger-700 hover:bg-danger-50'
                  : 'text-ink hover:bg-surface-alt',
              ].join(' ')}
            >
              {item.icon && <span className="shrink-0 inline-flex w-4 h-4 items-center justify-center text-ink-soft">{item.icon}</span>}
              <span className="flex-1 truncate">{item.label}</span>
            </button>
          ))}
        </div>,
        document.body,
      );
    },
    [state, close],
  );

  return { openAt, close, render, isOpen: state.open };
}
