'use client';

// ════════════════════════════════════════════════════════════════════════
// VatLetterUpload — upload the AED VAT-registration letter, extract via
// Haiku, return the structured fields for the caller to apply to its
// form state.
//
// Stint 14 (2026-04-20) — first version, extraction only.
// Stint 15 (2026-04-20) — caller can now receive the raw File so it
// can persist the letter via POST /api/entities/:id/official-documents
// after the entity is created (for /entities/new) or immediately
// (for re-uploads on /entities/:id).
// 2026-04-21 — drag-and-drop support per Diego's ask. The non-compact
// variant renders a full drop zone; the compact variant stays as a
// pill button (no drop zone — too much visual weight for an inline
// toolbar, and the file-picker button still works).
//
// Per Diego: "esa carta se guardara, porque está bien tenerla a mano
// para poder verificar…"
// ════════════════════════════════════════════════════════════════════════

import { useRef, useState } from 'react';
import { UploadCloudIcon, SparklesIcon, Loader2Icon, AlertTriangleIcon } from 'lucide-react';

export interface ExtractedVatLetter {
  name: string | null;
  legal_form: string | null;
  vat_number: string | null;
  matricule: string | null;
  rcs_number: string | null;
  address: string | null;
  regime: 'simplified' | 'ordinary' | null;
  frequency: 'monthly' | 'quarterly' | 'yearly' | null;
  entity_type: string | null;
  effective_date: string | null;
  warnings: string[];
}

const ACCEPTED_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const ACCEPTED_EXT = /\.(pdf|jpe?g|png|webp)$/i;

function isAcceptedFile(file: File): boolean {
  if (ACCEPTED_MIME.includes(file.type)) return true;
  return ACCEPTED_EXT.test(file.name);
}

export function VatLetterUpload({
  onExtracted,
  compact,
  label,
}: {
  /**
   * Called with the extracted fields AND the raw File the user picked.
   * The caller can stash the File and upload it to the official-documents
   * endpoint once an entity id exists (the /entities/new flow), or upload
   * immediately on an existing entity.
   */
  onExtracted: (fields: ExtractedVatLetter, file: File) => void;
  /** When true, render as a slim inline button (for use inside a form header). */
  compact?: boolean;
  /** Override the button label; useful on the entity detail page where
   *  the wording is "Replace letter" rather than "Auto-fill". */
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [preview, setPreview] = useState<ExtractedVatLetter | null>(null);
  const [dragActive, setDragActive] = useState(false);

  async function handleFile(file: File) {
    if (!isAcceptedFile(file)) {
      setError('Only PDF or image files (PDF / JPG / PNG / WEBP) are accepted.');
      return;
    }
    setBusy(true);
    setError(null);
    setWarnings([]);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/entities/extract-vat-letter', {
        method: 'POST',
        body: fd,
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error?.message ?? body?.error ?? 'Extraction failed.');
        return;
      }
      const fields = body.fields as ExtractedVatLetter;
      setPreview(fields);
      setWarnings(fields.warnings ?? []);
      onExtracted(fields, file);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setBusy(false);
    }
  }

  const idleLabel =
    label ??
    (compact ? 'Auto-fill from VAT letter' : 'Drop a VAT registration letter here, or click to pick a file');

  // Shared hidden file input used by both compact + full variants.
  const hiddenInput = (
    <input
      ref={inputRef}
      type="file"
      accept="application/pdf,image/*"
      className="hidden"
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) handleFile(f);
        e.target.value = '';
      }}
    />
  );

  const statusPanels = (
    <>
      {error && (
        <div className="mt-2 text-[11.5px] text-danger-700 bg-danger-50 border border-danger-200 rounded px-3 py-1.5 inline-flex items-center gap-1.5">
          <AlertTriangleIcon size={11} /> {error}
        </div>
      )}

      {preview && warnings.length === 0 && (
        <div className="mt-2 text-[11.5px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-3 py-1.5">
          Filled {countFilled(preview)} field{countFilled(preview) === 1 ? '' : 's'} from the letter.
          Review before saving — the reviewer is the final authority.
        </div>
      )}

      {warnings.length > 0 && (
        <div className="mt-2 text-[11.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-1.5">
          <div className="font-semibold inline-flex items-center gap-1.5">
            <AlertTriangleIcon size={11} /> {warnings.length} field{warnings.length === 1 ? '' : 's'} couldn&apos;t be read
          </div>
          <ul className="mt-1 ml-4 list-disc text-[10.5px]">
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}
    </>
  );

  // ── Compact variant: inline pill button, no drop zone (keeps toolbar slim).
  if (compact) {
    return (
      <div className="inline-block">
        {hiddenInput}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className={[
            'inline-flex items-center gap-2 rounded-md font-medium transition-colors',
            'h-8 px-3 text-[12px] border border-border-strong bg-surface text-ink-soft hover:text-ink hover:bg-surface-alt',
            busy ? 'opacity-60 cursor-not-allowed' : '',
          ].join(' ')}
        >
          {busy ? <Loader2Icon size={14} className="animate-spin" /> : <SparklesIcon size={14} />}
          {busy ? 'Reading letter…' : idleLabel}
        </button>
        {statusPanels}
      </div>
    );
  }

  // ── Full variant: drop zone with click-to-browse fallback.
  const dropzoneClasses = [
    'w-full rounded-lg border-2 border-dashed px-5 py-6 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors',
    dragActive
      ? 'border-brand-500 bg-brand-50'
      : busy
        ? 'border-brand-300 bg-brand-50/60 cursor-wait'
        : 'border-brand-300 bg-brand-50/30 hover:bg-brand-50 hover:border-brand-400',
  ].join(' ');

  return (
    <div>
      {hiddenInput}
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload VAT registration letter — click or drop file"
        onClick={() => !busy && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !busy) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!busy) setDragActive(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!busy) setDragActive(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragActive(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragActive(false);
          if (busy) return;
          const f = e.dataTransfer.files?.[0];
          if (f) handleFile(f);
        }}
        className={dropzoneClasses}
      >
        <div className={`inline-flex items-center justify-center w-9 h-9 rounded-full ${busy ? 'bg-brand-100 text-brand-700' : 'bg-brand-100 text-brand-600'}`}>
          {busy
            ? <Loader2Icon size={16} className="animate-spin" />
            : <UploadCloudIcon size={18} />}
        </div>
        <div className="text-[13px] font-medium text-brand-800">
          {busy ? 'Reading letter…' : idleLabel}
        </div>
        {!busy && (
          <div className="text-[11px] text-ink-muted">
            <SparklesIcon size={11} className="inline-block mr-1 align-text-top" />
            PDF or image · auto-fills name, VAT no., matricule, RCS, regime, frequency, address
          </div>
        )}
      </div>
      {statusPanels}
    </div>
  );
}

function countFilled(fields: ExtractedVatLetter): number {
  let n = 0;
  if (fields.name) n++;
  if (fields.legal_form) n++;
  if (fields.vat_number) n++;
  if (fields.matricule) n++;
  if (fields.rcs_number) n++;
  if (fields.address) n++;
  if (fields.regime) n++;
  if (fields.frequency) n++;
  if (fields.entity_type) n++;
  if (fields.effective_date) n++;
  return n;
}
