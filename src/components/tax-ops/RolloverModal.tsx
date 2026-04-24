'use client';

// ════════════════════════════════════════════════════════════════════════
// RolloverModal — "Open year N+1" flow.
//
// Solves Diego's annual pain: he used to copy the previous year's Excel,
// rename tabs, reset every status cell by hand, and forget entities
// liquidated mid-year. The DB version is a single POST:
//   1. Preview — POST ?mode=preview&year=N+1 → counts per tax_type
//   2. Confirm — POST ?mode=commit&year=N+1  → inserts, audit-logged
//
// Idempotent: if some filings for that year already exist (e.g. Diego
// created a few by hand), ON CONFLICT DO NOTHING leaves them alone.
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { CheckIcon, AlertTriangleIcon } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';

interface PreviewResponse {
  year: number;
  filings_to_create: number;
  by_tax_type: Record<string, number>;
  obligations_skipped_adhoc: number;
  already_existing: number;
}

interface CommitResponse {
  year: number;
  inserted: number;
  planned: number;
}

function humanTaxType(t: string): string {
  return t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function RolloverModal({
  open, year, onClose,
}: {
  open: boolean;
  year: number;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [committed, setCommitted] = useState<CommitResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'preview' | 'commit' | null>(null);

  useEffect(() => {
    if (!open) {
      setPreview(null); setCommitted(null); setError(null); setBusy(null);
      return;
    }
    let cancelled = false;
    setBusy('preview');
    setError(null);
    (async () => {
      try {
        const res = await fetch(`/api/tax-ops/rollover?mode=preview&year=${year}`, { method: 'POST' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json() as PreviewResponse;
        if (!cancelled) setPreview(body);
      } catch (e) {
        if (!cancelled) setError(String(e instanceof Error ? e.message : e));
      } finally {
        if (!cancelled) setBusy(null);
      }
    })();
    return () => { cancelled = true; };
  }, [open, year]);

  async function commit() {
    setBusy('commit'); setError(null);
    try {
      const res = await fetch(`/api/tax-ops/rollover?mode=commit&year=${year}`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as CommitResponse;
      setCommitted(body);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Open ${year}`}
      subtitle="Replicate every active obligation into new filings for the coming year."
      size="md"
      footer={
        committed ? (
          <button
            onClick={onClose}
            className="px-3 py-2 text-[12.5px] font-medium rounded-md bg-brand-500 hover:bg-brand-600 text-white"
          >
            Done
          </button>
        ) : (
          <>
            <button
              onClick={onClose}
              className="px-3 py-2 text-[12.5px] font-medium rounded-md border border-border hover:bg-surface-alt"
            >
              Cancel
            </button>
            <button
              onClick={commit}
              disabled={busy !== null || !preview || preview.filings_to_create === 0}
              className="px-3 py-2 text-[12.5px] font-medium rounded-md bg-brand-500 hover:bg-brand-600 text-white disabled:opacity-50"
            >
              {busy === 'commit' ? 'Creating…' : `Create ${preview?.filings_to_create ?? '…'} filings`}
            </button>
          </>
        )
      }
    >
      <div className="space-y-3 text-[12.5px] text-ink">
        {busy === 'preview' && <div className="text-ink-muted italic">Computing preview…</div>}

        {error && (
          <div className="rounded-md border border-danger-400 bg-danger-50/50 p-3 flex items-start gap-2">
            <AlertTriangleIcon size={14} className="mt-0.5 text-danger-700 shrink-0" />
            <div className="text-[12px] text-danger-800">{error}</div>
          </div>
        )}

        {preview && !committed && (
          <>
            <p>
              We&apos;ll create <strong>{preview.filings_to_create}</strong> new
              filings across your active obligations. Deadlines auto-compute from
              the rules. Ad-hoc obligations aren&apos;t rolled ({preview.obligations_skipped_adhoc} skipped).
              {preview.already_existing > 0 && <> Already-existing filings for {year} ({preview.already_existing}) stay untouched.</>}
            </p>
            <div className="rounded-md border border-border overflow-hidden">
              <table className="w-full text-[12px]">
                <thead className="bg-surface-alt text-ink-muted text-left">
                  <tr>
                    <th className="px-2.5 py-1.5 font-medium">Tax type</th>
                    <th className="px-2.5 py-1.5 font-medium text-right">Filings</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(preview.by_tax_type)
                    .sort((a, b) => b[1] - a[1])
                    .map(([k, v]) => (
                      <tr key={k} className="border-t border-border">
                        <td className="px-2.5 py-1.5">{humanTaxType(k)}</td>
                        <td className="px-2.5 py-1.5 text-right tabular-nums">{v}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {committed && (
          <div className="rounded-md border border-green-400 bg-green-50/50 p-3 flex items-start gap-2">
            <CheckIcon size={14} className="mt-0.5 text-green-700 shrink-0" />
            <div>
              <div className="font-semibold text-green-800">
                Created {committed.inserted} filings for {committed.year}.
              </div>
              {committed.inserted < committed.planned && (
                <div className="text-[11.5px] text-green-700 mt-0.5">
                  {committed.planned - committed.inserted} were already present and left untouched.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
