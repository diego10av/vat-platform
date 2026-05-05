'use client';

// ════════════════════════════════════════════════════════════════════════
// Modal — shared primitive for every dialog in the app. Standardises:
//   - ESC closes (unless `dismissable={false}`)
//   - Click on backdrop closes
//   - Body scroll locked while open
//   - Initial focus moves to first focusable element
//   - `role="dialog"` + `aria-modal` + `aria-labelledby` wired
//   - Consistent z-index / backdrop / shadow / rounded corners
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { XIcon } from 'lucide-react';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Controls the max-width. Defaults to 'md' (520px). */
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  /** Optional footer slot — laid out with flex justify-end. */
  footer?: React.ReactNode;
  /** When false, ESC + backdrop click do NOT dismiss. Default true. */
  dismissable?: boolean;
  /** Hide the built-in header (title + close). Used by custom layouts. */
  hideHeader?: boolean;
  children: React.ReactNode;
}

const SIZE_MAP: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'max-w-[380px]',
  md: 'max-w-[520px]',
  lg: 'max-w-[720px]',
  xl: 'max-w-[960px]',
  full: 'max-w-[min(1200px,95vw)]',
};

export function Modal({
  open, onClose, title, subtitle,
  size = 'md',
  footer, dismissable = true, hideHeader = false,
  children,
}: ModalProps) {
  const titleId = useId();
  const modalRef = useRef<HTMLDivElement>(null);

  // ESC + body scroll lock.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissable) onClose();
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, dismissable]);

  // Move focus into the modal when it opens.
  useEffect(() => {
    if (!open) return;
    const el = modalRef.current;
    if (!el) return;
    const firstFocusable = el.querySelector<HTMLElement>(
      'button, [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    (firstFocusable ?? el).focus();
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  const sizeClass = SIZE_MAP[size];

  return createPortal(
    <div
      className="fixed inset-0 z-modal flex items-center justify-center px-4 py-8"
      onMouseDown={e => {
        if (!dismissable) return;
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? titleId : undefined}
    >
      {/* Backdrop — heavier opacity + blur than the previous ink/60 +
          2px blur. Diego (2026-05-05) reported that the lighter backdrop
          made it feel like the modal content was floating over a
          half-readable table, "as if the modal text was overlapping the
          table behind it". Bumping to ink/75 + 6px blur kills the
          illusion: backdrop reads as a clear modal-mode separator. */}
      <div className="absolute inset-0 bg-ink/75 backdrop-blur-[6px] animate-fadeIn" aria-hidden />

      {/* Panel */}
      <div
        ref={modalRef}
        tabIndex={-1}
        className={`relative w-full ${sizeClass} max-h-[calc(100vh-4rem)] bg-surface rounded-xl shadow-2xl flex flex-col overflow-hidden animate-fadeInScale`}
      >
        {!hideHeader && (title || dismissable) && (
          <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-divider shrink-0">
            <div className="flex-1 min-w-0">
              {title && (
                <h2 id={titleId} className="text-base font-semibold text-ink leading-snug">
                  {title}
                </h2>
              )}
              {subtitle && (
                <div className="text-sm text-ink-muted mt-0.5 leading-relaxed">
                  {subtitle}
                </div>
              )}
            </div>
            {dismissable && (
              <button
                onClick={onClose}
                className="shrink-0 w-8 h-8 -mr-1 -mt-1 inline-flex items-center justify-center rounded-md text-ink-muted hover:bg-surface-alt hover:text-ink transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                aria-label="Close"
              >
                <XIcon size={15} />
              </button>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {children}
        </div>

        {footer && (
          <div className="px-5 py-3 border-t border-divider bg-surface-alt/60 shrink-0 flex items-center justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Convenience: a confirmation dialog with a danger / default tone +
 * optional destructive styling. Used for Reopen, Delete, Un-file, etc.
 *
 * Controlled externally via `open`; the caller owns state.
 */
export function ConfirmModal({
  open, onClose, onConfirm,
  title, description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  busy = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  busy?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      dismissable={!busy}
      footer={
        <>
          <button
            onClick={onClose}
            disabled={busy}
            className="h-9 px-3.5 rounded-md border border-border-strong text-sm font-medium text-ink-muted hover:text-ink disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={[
              'h-9 px-3.5 rounded-md text-white text-sm font-semibold disabled:opacity-50',
              tone === 'danger'
                ? 'bg-danger-600 hover:bg-danger-700'
                : 'bg-brand-500 hover:bg-brand-600',
            ].join(' ')}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      {description && (
        <div className="text-sm text-ink-soft leading-relaxed whitespace-pre-wrap">
          {description}
        </div>
      )}
    </Modal>
  );
}
