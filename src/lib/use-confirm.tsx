'use client';

// ════════════════════════════════════════════════════════════════════════
// useConfirm — promise-based wrapper around <ConfirmModal>.
//
// window.confirm() is functional but renders the native browser dialog,
// which clashes with cifra's design system (no danger tone, no consistent
// typography, no animation). This hook keeps the same one-liner ergonomics
// as window.confirm() while rendering the Modal primitive.
//
// Usage:
//
//   const { confirm, confirmModal } = useConfirm();
//
//   async function handleDelete() {
//     if (!await confirm({
//       title: 'Delete Acme Capital SARL?',
//       description: 'This is permanent and cannot be undone.',
//       tone: 'danger',
//       confirmLabel: 'Delete',
//     })) return;
//     await fetch(...);
//   }
//
//   return (
//     <>
//       <button onClick={handleDelete}>Archive</button>
//       {confirmModal}
//     </>
//   );
// ════════════════════════════════════════════════════════════════════════

import { useCallback, useState } from 'react';
import { ConfirmModal } from '@/components/ui/Modal';

interface ConfirmOptions {
  title: string;
  description?: string;
  tone?: 'default' | 'danger';
  confirmLabel?: string;
  cancelLabel?: string;
}

interface PendingState extends ConfirmOptions {
  resolve: (confirmed: boolean) => void;
}

export function useConfirm(): {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  confirmModal: React.ReactNode;
} {
  const [pending, setPending] = useState<PendingState | null>(null);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise(resolve => {
      setPending({ ...opts, resolve });
    });
  }, []);

  const confirmModal = pending ? (
    <ConfirmModal
      open={true}
      title={pending.title}
      description={pending.description}
      tone={pending.tone ?? 'default'}
      confirmLabel={pending.confirmLabel ?? 'Confirm'}
      cancelLabel={pending.cancelLabel ?? 'Cancel'}
      onClose={() => {
        pending.resolve(false);
        setPending(null);
      }}
      onConfirm={() => {
        pending.resolve(true);
        setPending(null);
      }}
    />
  ) : null;

  return { confirm, confirmModal };
}
