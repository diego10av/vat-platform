'use client';

// ════════════════════════════════════════════════════════════════════════
// FrequencyChangeModal — manual "change filing frequency" flow.
//
// Complements the VAT-letter diff modal:
//   - Diff modal triggers automatically when a NEW VAT registration
//     letter is uploaded and the extractor spots a frequency change.
//   - This modal handles the other path: the letter that justifies
//     the change is NOT a VAT registration letter (e.g. AED
//     "changement de régime", engagement letter revision, or plainly
//     captured by email), so no extractor runs.
//
// Input:
//   - Entity id + current frequency + current regime
//   - Optional list of already-uploaded documents for this entity, so
//     the user can pick one to link as the source of the change.
//   - Optional pre-selected source document id (when the user just
//     uploaded a letter and clicked "Does this letter change the
//     frequency?").
//
// Audit log: per-column change entries PLUS a single 'frequency_change'
// entry with the full context (source_document_id, effective_from,
// notes). Makes audit-trail PDFs legible.
//
// Stint 15 follow-up (2026-04-20). Per Diego: "quiero que se pueda
// hacer también cuando la carta no es la VAT registration letter".
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import {
  CheckIcon, Loader2Icon, CalendarIcon, FileTextIcon,
  ArrowRightIcon, AlertTriangleIcon,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/Toaster';

type Frequency = 'monthly' | 'quarterly' | 'annual';
type Regime = 'simplified' | 'ordinary';

export interface LinkableDoc {
  id: string;
  kind: string;
  filename: string;
  uploaded_at: string;
}

export function FrequencyChangeModal({
  open,
  onClose,
  entityId,
  entityName,
  currentFrequency,
  currentRegime,
  availableDocs,
  initialDocId,
  onApplied,
}: {
  open: boolean;
  onClose: () => void;
  entityId: string;
  entityName: string;
  currentFrequency: string;         // 'monthly' | 'quarterly' | 'annual' (or legacy 'yearly')
  currentRegime: string;             // 'simplified' | 'ordinary'
  availableDocs: LinkableDoc[];
  initialDocId?: string | null;
  onApplied: () => void;
}) {
  const toast = useToast();
  const normalizedCurrent: Frequency =
    currentFrequency === 'yearly' ? 'annual'
    : currentFrequency === 'monthly' || currentFrequency === 'quarterly' || currentFrequency === 'annual'
    ? currentFrequency
    : 'annual';

  const [newFrequency, setNewFrequency] = useState<Frequency>(normalizedCurrent);
  const [newRegime, setNewRegime] = useState<Regime | ''>('');   // '' = don't change
  const [effectiveFrom, setEffectiveFrom] = useState<string>('');
  const [sourceDocId, setSourceDocId] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Reset form when the modal re-opens.
  useEffect(() => {
    if (!open) return;
    setNewFrequency(normalizedCurrent);
    setNewRegime('');
    setEffectiveFrom(new Date().toISOString().slice(0, 10));
    setSourceDocId(initialDocId ?? '');
    setNotes('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialDocId]);

  const frequencyActuallyChanges = newFrequency !== normalizedCurrent;
  const regimeActuallyChanges = !!newRegime && newRegime !== currentRegime;
  const canSubmit = frequencyActuallyChanges || regimeActuallyChanges;

  async function submit() {
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = { frequency: newFrequency };
      if (newRegime) body.regime = newRegime;
      if (effectiveFrom) body.effective_from = effectiveFrom;
      if (sourceDocId) body.source_document_id = sourceDocId;
      if (notes.trim()) body.notes = notes.trim();

      const res = await fetch(`/api/entities/${entityId}/frequency-change`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error?.message ?? 'Could not update frequency.', data?.error?.hint);
        return;
      }
      if (!data.changed || data.changed.length === 0) {
        toast.info('Nothing to update — the entity already matches.');
      } else {
        const parts: string[] = [];
        if (data.changed.includes('frequency')) {
          parts.push(`frequency → ${data.to_frequency}`);
        }
        if (data.changed.includes('regime')) parts.push('regime updated');
        toast.success(`Applied: ${parts.join(' · ')}.`);
      }
      onApplied();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Change filing frequency"
      subtitle={`Record a frequency change for ${entityName}. Past filings keep their original period type; only future ones follow the new frequency.`}
      size="lg"
      footer={
        <div className="flex items-center justify-between w-full">
          <div className="text-[11px] text-ink-muted">
            {!canSubmit && 'Pick a different frequency or regime to continue.'}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={submitting}
              className="h-8 px-3 rounded border border-border-strong text-[12px] text-ink-muted hover:text-ink"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={!canSubmit || submitting}
              className="h-8 px-4 rounded bg-amber-600 text-white text-[12px] font-semibold hover:bg-amber-700 disabled:opacity-50 inline-flex items-center gap-1"
            >
              {submitting ? <Loader2Icon size={12} className="animate-spin" /> : <CheckIcon size={12} />}
              Apply change
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Frequency change visualiser */}
        <div className="rounded-md border border-amber-200 bg-amber-50/60 p-3">
          <div className="text-[10.5px] uppercase tracking-wide font-semibold text-amber-900 mb-1.5">
            Filing frequency
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="text-[12px] text-ink-muted">
              <span className="block text-[9.5px] uppercase">Current</span>
              <span className="font-semibold text-ink-soft">{normalizedCurrent}</span>
            </div>
            <ArrowRightIcon size={14} className="text-amber-700" />
            <div>
              <span className="block text-[9.5px] uppercase text-ink-muted">New</span>
              <div className="flex gap-1.5 mt-0.5">
                {(['monthly', 'quarterly', 'annual'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setNewFrequency(f)}
                    className={[
                      'h-8 px-3 rounded border text-[11.5px] font-medium transition-colors',
                      newFrequency === f
                        ? 'border-amber-400 bg-amber-100 text-amber-900'
                        : 'border-border bg-surface text-ink-soft hover:bg-surface-alt',
                    ].join(' ')}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Regime (optional) */}
        <div>
          <div className="text-[10.5px] uppercase tracking-wide font-semibold text-ink-muted mb-1">
            Regime (optional)
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11.5px] text-ink-muted">
              Currently <strong className="text-ink-soft">{currentRegime}</strong>.
            </span>
            <select
              value={newRegime}
              onChange={(e) => setNewRegime(e.target.value as Regime | '')}
              className="border border-border-strong rounded px-2 py-1.5 text-[12.5px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="">Don&apos;t change</option>
              <option value="simplified">Change to simplified</option>
              <option value="ordinary">Change to ordinary</option>
            </select>
          </div>
        </div>

        {/* Effective from */}
        <div>
          <label className="block">
            <div className="text-[10.5px] uppercase tracking-wide font-semibold text-ink-muted mb-1 flex items-center gap-1.5">
              <CalendarIcon size={10} /> Effective from
            </div>
            <input
              type="date"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
              className="border border-border-strong rounded px-2 py-1.5 text-[12.5px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
            <div className="text-[10.5px] text-ink-muted mt-0.5">
              The date this change takes effect per the letter. Declarations filed before this date keep their historical period type.
            </div>
          </label>
        </div>

        {/* Linked document */}
        <div>
          <div className="text-[10.5px] uppercase tracking-wide font-semibold text-ink-muted mb-1 flex items-center gap-1.5">
            <FileTextIcon size={10} /> Linked document (optional)
          </div>
          {availableDocs.length === 0 ? (
            <div className="text-[11.5px] text-ink-muted italic">
              No documents uploaded yet. You can still apply the change and attach a letter later via the Official documents card.
            </div>
          ) : (
            <select
              value={sourceDocId}
              onChange={(e) => setSourceDocId(e.target.value)}
              className="w-full border border-border-strong rounded px-2 py-1.5 text-[12.5px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="">— No link —</option>
              {availableDocs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.filename} · {d.kind.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Notes */}
        <div>
          <label className="block">
            <div className="text-[10.5px] uppercase tracking-wide font-semibold text-ink-muted mb-1">
              Notes (optional)
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="e.g. Turnover threshold crossed Q3 2025; AED letter confirms monthly from 2026-01-01."
              className="w-full border border-border-strong rounded px-2 py-1.5 text-[12.5px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </label>
        </div>

        {/* Impact reminder */}
        <div className="rounded-md border border-ink-faint/30 bg-surface-alt/40 px-3 py-2 flex items-start gap-2">
          <AlertTriangleIcon size={12} className="text-ink-muted mt-0.5 shrink-0" />
          <div className="text-[10.5px] text-ink-muted leading-relaxed">
            The change is logged in the entity&apos;s audit trail with the new
            frequency, effective date and linked document. Past filings aren&apos;t touched.
          </div>
        </div>
      </div>
    </Modal>
  );
}
