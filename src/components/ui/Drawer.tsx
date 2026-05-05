'use client';

// ════════════════════════════════════════════════════════════════════════
// Drawer — stint 47.F3.1
//
// Right-side slide-in panel with backdrop, focus trap, ESC + click-outside
// close, scroll lock. Single canonical primitive — replaces the four
// ad-hoc drawers Diego built (FilingEditDrawer, EntityEditCard,
// BulkEditModal panel, etc.) which each rolled their own overlay,
// dismiss handlers, and z-index dance.
//
// Usage:
//   <Drawer
//     open={open}
//     onClose={() => setOpen(false)}
//     title="Edit filing"
//     subtitle="VAT Q1 2025 · Acme SARL"
//     width="md"
//     footer={<Button>Save</Button>}
//   >
//     <Field label="Status">…</Field>
//   </Drawer>
//
// Width is `sm` (320px) / `md` (480px, default) / `lg` (640px) / `xl`
// (820px). All cap at 90vw on small screens.
//
// ARIA: role="dialog", aria-modal, aria-labelledby pointing at title.
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, type ReactNode } from 'react';
import { XIcon } from 'lucide-react';

type Width = 'sm' | 'md' | 'lg' | 'xl';

const WIDTH_PX: Record<Width, string> = {
  sm: '320px',
  md: '480px',
  lg: '640px',
  xl: '820px',
};

interface Props {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Right-aligned actions in the header (e.g. "Open in full page" link). */
  headerActions?: ReactNode;
  /** Content rendered in a sticky footer (e.g. Save / Cancel). */
  footer?: ReactNode;
  width?: Width;
  /** When true, clicking the backdrop closes. Default: true. ESC always closes. */
  dismissOnBackdropClick?: boolean;
  /** When true, prevents the dismiss-by-ESC. Useful for unsaved-form guards
   *  (consumer can show its own confirm and then call onClose). */
  preventEscape?: boolean;
  children: ReactNode;
  /** Optional extra class on the panel. */
  className?: string;
}

export function Drawer({
  open, onClose,
  title, subtitle, headerActions, footer,
  width = 'md',
  dismissOnBackdropClick = true,
  preventEscape = false,
  children,
  className = '',
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previousActiveRef = useRef<Element | null>(null);

  // ESC closes
  useEffect(() => {
    if (!open || preventEscape) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose, preventEscape]);

  // Scroll lock + focus management
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    previousActiveRef.current = document.activeElement;
    // Defer focus to after the panel is in the DOM
    requestAnimationFrame(() => {
      const focusable = panelRef.current?.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      focusable?.focus();
    });
    return () => {
      document.body.style.overflow = previousOverflow;
      const prev = previousActiveRef.current;
      if (prev instanceof HTMLElement) prev.focus();
    };
  }, [open]);

  if (!open) return null;

  const titleId = 'drawer-title';

  return (
    <div
      className="fixed inset-0 z-modal flex justify-end"
      onClick={dismissOnBackdropClick ? onClose : undefined}
    >
      {/* Backdrop — heavier than the previous ink/20 (almost invisible)
          for the same reason as the Modal primitive: backdrop should
          read as a clear modal-mode separator from the page underneath. */}
      <div className="absolute inset-0 bg-ink/50 backdrop-blur-[3px] animate-fadeIn" aria-hidden="true" />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        className={[
          'relative bg-surface border-l border-border h-full overflow-auto shadow-lg flex flex-col animate-slideInRight',
          className,
        ].join(' ')}
        style={{ width: WIDTH_PX[width], maxWidth: '90vw' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        {(title || subtitle || headerActions) && (
          <div className="sticky top-0 bg-surface border-b border-border px-4 py-2.5 flex items-center gap-2 z-sticky">
            <div className="flex-1 min-w-0">
              {title && (
                <div id={titleId} className="text-sm font-semibold text-ink truncate">
                  {title}
                </div>
              )}
              {subtitle && (
                <div className="text-xs text-ink-muted truncate">{subtitle}</div>
              )}
            </div>
            {headerActions}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close drawer"
              className="shrink-0 w-7 h-7 inline-flex items-center justify-center rounded-md text-ink-muted hover:bg-surface-alt hover:text-ink"
            >
              <XIcon size={14} />
            </button>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 px-4 py-3 overflow-y-auto">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="sticky bottom-0 bg-surface border-t border-border px-4 py-2.5">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
