'use client';

// ════════════════════════════════════════════════════════════════════════
// FilingPanel — closes the lifecycle (APPROVED → FILED → PAID).
// DeclarationNotes — autosaved internal note for a declaration.
// Step / StepDot — shared visual atoms for the 3-step filing timeline.
//
// Extracted from page.tsx during the 2026-04-18 refactor. Verbatim move.
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react';
import type { DeclarationData } from './_types';
import { formatDate } from './_helpers';

export function DeclarationNotes({
  declarationId, initial,
}: { declarationId: string; initial: string | null }) {
  const [open, setOpen] = useState(!!initial);
  const [notes, setNotes] = useState(initial || '');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(async () => {
      setSaving(true);
      try {
        await fetch(`/api/declarations/${declarationId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notes }),
        });
        setSavedAt(new Date());
        setDirty(false);
      } finally { setSaving(false); }
    }, 800);
    return () => clearTimeout(t);
  }, [notes, dirty, declarationId]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mb-4 text-[11px] text-ink-faint hover:text-ink-soft cursor-pointer transition-colors flex items-center gap-1"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
        Add internal note
      </button>
    );
  }

  return (
    <div className="bg-amber-50/60 border border-amber-200 rounded-lg p-3 mb-4">
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-[11px] uppercase tracking-wide font-semibold text-amber-700 flex items-center gap-1.5">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>
          Internal note
        </div>
        <span className="text-[10px] text-ink-faint">
          {saving ? 'Saving…' : savedAt ? `Saved ${savedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}
        </span>
      </div>
      <textarea
        value={notes}
        onChange={e => { setNotes(e.target.value); setDirty(true); }}
        rows={2}
        placeholder="Internal context for this declaration. Not sent to the client."
        className="w-full bg-transparent text-[12px] text-gray-800 focus:outline-none resize-none"
      />
    </div>
  );
}

export function FilingPanel({
  data, onMarkFiled, onMarkPaid, onReopen, onUploadProof,
}: {
  data: DeclarationData;
  onMarkFiled: (filing_ref: string) => void;
  onMarkPaid: (payment_ref?: string) => void;
  onReopen: () => void;
  onUploadProof: (file: File) => void;
}) {
  const [filingRef, setFilingRef] = useState(data.filing_ref || '');
  const [paymentRefInput, setPaymentRefInput] = useState(data.payment_ref || '');
  const [uploadingProof, setUploadingProof] = useState(false);
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const proofInput = useRef<HTMLInputElement>(null);

  const status = data.status;

  useEffect(() => {
    if (!data.proof_of_filing_filename) { setProofUrl(null); return; }
    fetch(`/api/declarations/${data.id}/proof-of-filing`)
      .then(async r => { if (r.ok) return r.json(); throw new Error(); })
      .then(d => setProofUrl(d.url))
      .catch(() => setProofUrl(null));
  }, [data.id, data.proof_of_filing_filename]);

  async function handleProofChange(files: FileList | null) {
    if (!files || !files.length) return;
    setUploadingProof(true);
    try { await onUploadProof(files[0]!); }
    finally { setUploadingProof(false); }
  }

  return (
    <div className="bg-surface border border-border rounded-lg mb-4 overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-surface-alt flex items-center justify-between">
        <div>
          <h3 className="text-[13px] font-semibold text-ink">Filing &amp; payment</h3>
          <div className="text-[11px] text-ink-muted mt-0.5">
            {status === 'approved' && 'Ready to file. Upload the eCDF XML to the AED portal, then record the filing reference here.'}
            {status === 'filed' && 'Filed. Mark as paid once the bank confirms the transfer.'}
            {status === 'paid' && 'Cycle complete.'}
          </div>
        </div>
        <button
          onClick={onReopen}
          className="h-7 px-2.5 rounded border border-orange-300 text-[11px] font-medium text-orange-600 hover:bg-orange-50 transition-all duration-150 cursor-pointer"
          title="Reopen for further changes (lines become editable again)"
        >
          Reopen
        </button>
      </div>

      <div className="p-4 grid grid-cols-3 gap-4">
        {/* Step 1 — Approved */}
        <Step
          number={1}
          title="Approved"
          state="done"
          subtitle={data.payment_ref ? `Payment ref ${data.payment_ref}` : 'Lines frozen, precedents updated'}
        />

        {/* Step 2 — Filed */}
        {status === 'approved' ? (
          <div className="border border-border rounded-md p-3 col-span-2">
            <div className="flex items-center gap-2 mb-2">
              <StepDot active />
              <div className="text-[12px] font-semibold text-ink">Mark as filed</div>
            </div>
            <div className="text-[11px] text-ink-muted mb-2">
              Enter the AED filing reference from the eCDF confirmation page.
            </div>
            <div className="flex gap-2">
              <input
                value={filingRef}
                onChange={e => setFilingRef(e.target.value)}
                placeholder="AED filing reference"
                className="flex-1 border border-border-strong rounded px-2 py-1 text-[12px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              <button
                onClick={() => filingRef.trim() && onMarkFiled(filingRef.trim())}
                disabled={!filingRef.trim()}
                className="h-8 px-3 rounded bg-brand-500 text-white text-[11px] font-semibold hover:bg-brand-600 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-all duration-150"
              >
                Mark as filed
              </button>
            </div>
          </div>
        ) : (
          <Step
            number={2}
            title="Filed"
            state="done"
            subtitle={`Ref ${data.filing_ref || '—'} on ${formatDate(data.filed_at)}`}
          />
        )}

        {/* Step 3 — Paid */}
        {status === 'paid' ? (
          <Step
            number={3}
            title="Paid"
            state="done"
            subtitle={`Confirmed on ${formatDate(data.payment_confirmed_at)}`}
          />
        ) : status === 'filed' ? (
          <div className="border border-border rounded-md p-3 col-span-3">
            <div className="flex items-center gap-2 mb-2">
              <StepDot active />
              <div className="text-[12px] font-semibold text-ink">Mark as paid</div>
            </div>
            <div className="text-[11px] text-ink-muted mb-2">
              Optional: record the bank reference number from the transfer confirmation.
            </div>
            <div className="flex gap-2">
              <input
                value={paymentRefInput}
                onChange={e => setPaymentRefInput(e.target.value)}
                placeholder="Bank transfer reference (optional)"
                className="flex-1 border border-border-strong rounded px-2 py-1 text-[12px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              <button
                onClick={() => onMarkPaid(paymentRefInput.trim() || undefined)}
                className="h-8 px-3 rounded bg-green-600 text-white text-[11px] font-semibold hover:bg-green-700 cursor-pointer transition-all duration-150"
              >
                Mark as paid
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Proof-of-filing upload (visible from FILED onwards) */}
      {['filed', 'paid'].includes(status) && (
        <div className="px-4 pb-4 -mt-2">
          <div className="bg-surface-alt border border-border rounded-md p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-wide font-semibold text-ink-muted mb-0.5">
                  Proof of filing
                </div>
                {data.proof_of_filing_filename ? (
                  <div className="text-[12px] text-ink-soft truncate">
                    {proofUrl ? (
                      <a href={proofUrl} target="_blank" rel="noreferrer" className="hover:underline text-blue-600">
                        {data.proof_of_filing_filename}
                      </a>
                    ) : (
                      data.proof_of_filing_filename
                    )}
                    <span className="text-ink-faint ml-2 text-[11px]">
                      uploaded {formatDate(data.proof_of_filing_uploaded_at)}
                    </span>
                  </div>
                ) : (
                  <div className="text-[12px] text-ink-muted">
                    No file uploaded yet. The proof is the eCDF confirmation screenshot or PDF.
                  </div>
                )}
              </div>
              <input
                ref={proofInput} type="file" accept=".pdf,.png,.jpg,.jpeg" className="hidden"
                onChange={e => handleProofChange(e.target.files)}
              />
              <button
                onClick={() => proofInput.current?.click()}
                disabled={uploadingProof}
                className="shrink-0 h-7 px-2.5 rounded border border-border-strong text-[11px] font-medium text-ink-soft hover:bg-surface hover:border-gray-400 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-all duration-150"
              >
                {uploadingProof ? 'Uploading…' : data.proof_of_filing_filename ? 'Replace' : 'Upload'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ───────────────────────── shared step atoms ─────────────────────────

function Step({
  number, title, state, subtitle,
}: { number: number; title: string; state: 'done' | 'active' | 'pending'; subtitle: string }) {
  const dotColor =
    state === 'done' ? 'bg-emerald-600 text-white' :
    state === 'active' ? 'bg-brand-500 text-white' :
    'bg-gray-200 text-ink-muted';
  return (
    <div className="border border-border rounded-md p-3 flex items-start gap-3">
      <div className={`shrink-0 w-6 h-6 rounded-full text-[11px] font-semibold flex items-center justify-center ${dotColor}`}>
        {state === 'done' ? '✓' : number}
      </div>
      <div className="min-w-0">
        <div className="text-[12px] font-semibold text-ink">{title}</div>
        <div className="text-[11px] text-ink-muted mt-0.5 truncate">{subtitle}</div>
      </div>
    </div>
  );
}

function StepDot({ active }: { active?: boolean }) {
  return <div className={`w-2.5 h-2.5 rounded-full ${active ? 'bg-brand-500' : 'bg-gray-300'}`} />;
}
