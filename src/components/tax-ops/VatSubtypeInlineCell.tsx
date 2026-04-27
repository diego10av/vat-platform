'use client';

// ════════════════════════════════════════════════════════════════════════
// VatSubtypeInlineCell — stint 48.F1.A
//
// Clickable chip in the VAT annual matrix Subtype column. Click → modal
// with confirmation → POST to /api/tax-ops/obligations/[id]/change-vat-subtype
// → refetch.
//
// Diego: "el switch es permanente hasta el día que se cambie. Hay
// veces que las entidades cambian de régimen." Modal forces a confirm
// because the change is fiscal — past filings keep their subtype, but
// future-year matrices render under the new one.
// ════════════════════════════════════════════════════════════════════════

import { useState } from 'react';
import { useToast } from '@/components/Toaster';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

interface Props {
  entityName: string;
  obligationId: string | null;
  current: 'standard' | 'simplified';
  onChanged: () => void;
}

export function VatSubtypeInlineCell({ entityName, obligationId, current, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const target: 'standard' | 'simplified' = current === 'standard' ? 'simplified' : 'standard';

  const chipClass = current === 'simplified'
    ? 'bg-brand-50 text-brand-700 border-brand-200'
    : 'bg-surface-alt text-ink-soft border-border';

  async function commit() {
    if (!obligationId || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/tax-ops/obligations/${obligationId}/change-vat-subtype`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_subtype: target }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b?.error ?? `HTTP ${res.status}`);
      }
      toast.success(`${entityName} switched to ${target}`);
      setOpen(false);
      onChanged();
    } catch (e) {
      toast.error(`Switch failed: ${String(e instanceof Error ? e.message : e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => obligationId && setOpen(true)}
        disabled={!obligationId}
        title={
          obligationId
            ? `Click to switch to ${target} regime`
            : 'No obligation — cannot switch'
        }
        className={[
          'inline-flex items-center px-1.5 py-0.5 rounded-full text-2xs border hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-opacity',
          chipClass,
        ].join(' ')}
      >
        {current}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Switch VAT subtype">
        <div className="space-y-3 text-sm">
          <p>
            Switch <strong>{entityName}</strong> from{' '}
            <span className="font-mono">{current}</span> to{' '}
            <span className="font-mono">{target}</span>?
          </p>
          <p className="text-ink-muted text-xs">
            Past filings keep their subtype in their audit trail. Future-year
            matrices render this entity under the new regime. The change is
            permanent until the next switch — entities can flip back and forth
            as needed (e.g. when revenue thresholds cross). Audit-logged.
          </p>
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={() => void commit()} loading={busy}>
              Switch to {target}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
