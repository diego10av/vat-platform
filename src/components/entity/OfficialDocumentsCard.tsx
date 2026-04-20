'use client';

// ════════════════════════════════════════════════════════════════════════
// OfficialDocumentsCard — the "VAT letter on file" surface for /entities/[id].
//
// Three jobs:
//   1. Show the current VAT registration letter (filename, uploaded_at,
//      effective_from, warnings from the last extraction).
//   2. Let the user replace it. The API computes a field-by-field diff
//      against the live entity; we show it in a modal and let the user
//      opt in per field before patching the entity.
//   3. Surface the older versions (periodicity history — quarterly
//      letter from 2025, then monthly from 2026 when turnover crossed
//      the threshold, etc.).
//
// Other document kinds (Articles, Engagement Letter, generic "Other")
// live in the same card but skip the diff flow — they're attachments
// only.
//
// Stint 15 (2026-04-20). Per Diego: "esa carta se guardara, porque
// está bien tenerla a mano para poder verificar, yo qué sé, cuál es
// la periodicidad o lo que sea… Y también que se pudiese subir otra
// carta más tarde, porque a veces cambia la periodicidad".
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react';
import {
  FileTextIcon, UploadCloudIcon, Loader2Icon, ExternalLinkIcon,
  HistoryIcon, ClockIcon, AlertTriangleIcon, CalendarClockIcon,
  CheckIcon, Trash2Icon, FileIcon,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/Toaster';
import { FrequencyChangeModal } from '@/components/entity/FrequencyChangeModal';

type Kind = 'vat_registration' | 'articles_of_association' | 'engagement_letter' | 'other';

interface ExtractedFields {
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

interface DocRow {
  id: string;
  entity_id: string;
  kind: Kind;
  filename: string;
  content_type: string | null;
  storage_path: string;
  size_bytes: number | null;
  extracted_fields: ExtractedFields | null;
  effective_from: string | null;
  notes: string | null;
  superseded_by: string | null;
  uploaded_at: string;
}

interface DiffRow {
  field: string;
  before: string | null;
  after: string | null;
  changed: boolean;
}

const KIND_LABELS: Record<Kind, string> = {
  vat_registration: 'VAT registration letter',
  articles_of_association: 'Articles of association',
  engagement_letter: 'Engagement letter',
  other: 'Other document',
};

export function OfficialDocumentsCard({
  entityId,
  entityName,
  currentFrequency,
  currentRegime,
  onEntityPatched,
}: {
  entityId: string;
  entityName: string;
  currentFrequency: string;
  currentRegime: string;
  /**
   * Called after the user applies a VAT-letter diff or a manual
   * frequency change. Parent refetches the entity so read-mode values
   * reflect the apply (frequency changed from quarterly → monthly, etc.).
   */
  onEntityPatched?: () => void;
}) {
  const toast = useToast();
  const [docs, setDocs] = useState<DocRow[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [diffModal, setDiffModal] = useState<{
    docId: string; diff: DiffRow[]; fields: ExtractedFields | null;
  } | null>(null);
  // Manual frequency-change flow — for letters whose `kind` is NOT
  // vat_registration (engagement letter, articles, other, AED
  // "changement de régime", etc.). `initialDocId` pre-links the modal
  // to a just-uploaded document so the paper trail is captured.
  const [freqModal, setFreqModal] = useState<{ initialDocId: string | null } | null>(null);
  // When a non-VAT-letter upload just landed, we nudge the user: "did
  // this letter change the filing frequency?". Dismissable — the nudge
  // never hijacks the main page.
  const [postUploadNudge, setPostUploadNudge] = useState<{
    docId: string; filename: string; kind: Kind;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      const res = await fetch(
        `/api/entities/${entityId}/official-documents?history=${showHistory ? 'true' : 'false'}`,
      );
      const body = await res.json();
      if (res.status === 501 || body?.error?.code === 'migration_required') {
        setMigrationMissing(true);
        setDocs([]);
        return;
      }
      if (!res.ok) {
        toast.error(body?.error?.message ?? 'Could not load documents.');
        setDocs([]);
        return;
      }
      setDocs(body.documents ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Network error.');
      setDocs([]);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId, showHistory]);

  async function openSignedUrl(docId: string) {
    try {
      const res = await fetch(`/api/entities/${entityId}/official-documents/${docId}?action=url`);
      const body = await res.json();
      if (!res.ok) {
        toast.error(body?.error?.message ?? 'Could not open the document.');
        return;
      }
      if (body.url) window.open(body.url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Network error.');
    }
  }

  async function handleUpload(file: File, kind: Kind) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('kind', kind);
      const res = await fetch(`/api/entities/${entityId}/official-documents`, {
        method: 'POST',
        body: fd,
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body?.error?.message ?? 'Upload failed.', body?.error?.hint);
        return;
      }
      toast.success(`${KIND_LABELS[kind]} uploaded.`);
      await load();
      // If the VAT letter produced a diff vs. the current entity fields,
      // open the apply modal so the user can confirm per-field changes.
      if (kind === 'vat_registration' && Array.isArray(body.diff) && body.diff.length > 0) {
        setDiffModal({
          docId: body.document_id,
          diff: body.diff,
          fields: body.extracted_fields ?? null,
        });
      } else if (kind !== 'vat_registration' && body.document_id) {
        // Non-VAT kinds don't trigger the extractor-driven diff flow.
        // But the user may have just uploaded an AED "changement de
        // régime" letter or a revised engagement letter that DOES
        // change the filing cadence. Nudge them.
        setPostUploadNudge({
          docId: body.document_id,
          filename: file.name,
          kind,
        });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setUploading(false);
    }
  }

  async function deleteDoc(docId: string) {
    if (!confirm('Delete this document? This cannot be undone.')) return;
    try {
      const res = await fetch(`/api/entities/${entityId}/official-documents/${docId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        toast.error(body?.error?.message ?? 'Delete failed.');
        return;
      }
      toast.success('Document deleted.');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Network error.');
    }
  }

  if (migrationMissing) {
    return (
      <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50/50 p-4">
        <div className="text-[12.5px] font-semibold text-amber-900 flex items-center gap-1.5">
          <AlertTriangleIcon size={13} /> Migration 017 pending
        </div>
        <div className="text-[11.5px] text-amber-800 mt-1">
          The <code className="text-[10.5px] bg-amber-100 px-1 rounded">entity_official_documents</code> table
          doesn&apos;t exist yet. Apply migration 017 to enable VAT-letter storage + versioning.
        </div>
      </div>
    );
  }

  if (docs === null) {
    return (
      <div className="mb-5 rounded-lg border border-border bg-surface p-4 text-[12px] text-ink-muted flex items-center gap-2">
        <Loader2Icon size={13} className="animate-spin" /> Loading documents…
      </div>
    );
  }

  const current = docs.filter(d => !d.superseded_by);
  const history = docs.filter(d => d.superseded_by);
  const currentVat = current.find(d => d.kind === 'vat_registration') ?? null;
  const currentOther = current.filter(d => d.kind !== 'vat_registration');

  // Slim 1-line affordance when nothing has been uploaded yet, so users
  // who don't have / don't want to upload an AED letter aren't nagged.
  // Matches the EngagedViaCard + BillingCard empty-state pattern.
  // Still exposes "Change frequency" + the FrequencyChangeModal so a
  // user who's been told orally about a periodicity change can record
  // it without a document in hand.
  if (docs.length === 0) {
    return (
      <>
        <div className="mb-5 bg-surface border border-dashed border-border rounded-lg px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-[12px] text-ink-muted min-w-0">
            <FileTextIcon size={13} className="text-ink-faint shrink-0" />
            <span className="truncate">
              <strong className="text-ink-soft">No official documents attached.</strong>{' '}
              Optional — upload the VAT registration letter, articles, or engagement
              letter to keep them one click away.
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => setFreqModal({ initialDocId: null })}
              className="h-7 px-2 rounded border border-amber-300 bg-amber-50 text-[11px] font-medium text-amber-900 hover:bg-amber-100 inline-flex items-center gap-1"
              title="Record a filing-frequency change without attaching a document"
            >
              <CalendarClockIcon size={11} /> Change frequency
            </button>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUpload(f, 'vat_registration');
                e.target.value = '';
              }}
            />
            <button
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="h-7 px-2.5 rounded-md border border-border-strong text-[11.5px] font-medium text-ink-soft hover:text-ink hover:bg-surface-alt disabled:opacity-50 inline-flex items-center gap-1"
            >
              {uploading
                ? <Loader2Icon size={11} className="animate-spin" />
                : <UploadCloudIcon size={11} />}
              Upload VAT letter
            </button>
          </div>
        </div>

        <FrequencyChangeModal
          open={!!freqModal}
          onClose={() => setFreqModal(null)}
          entityId={entityId}
          entityName={entityName}
          currentFrequency={currentFrequency}
          currentRegime={currentRegime}
          availableDocs={[]}
          initialDocId={null}
          onApplied={() => {
            setFreqModal(null);
            onEntityPatched?.();
          }}
        />
      </>
    );
  }

  return (
    <div className="mb-5 bg-surface border border-border rounded-lg">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-divider gap-2 flex-wrap">
        <h3 className="text-[13px] font-semibold text-ink inline-flex items-center gap-2">
          <FileTextIcon size={14} className="text-brand-500" />
          Official documents
        </h3>
        <div className="flex items-center gap-1.5 flex-wrap">
          {history.length > 0 && (
            <button
              onClick={() => setShowHistory(v => !v)}
              className="h-7 px-2 rounded border border-border text-[11px] text-ink-muted hover:text-ink hover:bg-surface-alt inline-flex items-center gap-1"
            >
              <HistoryIcon size={10} /> {showHistory ? 'Hide' : 'Show'} history ({history.length})
            </button>
          )}
          <button
            onClick={() => setFreqModal({ initialDocId: null })}
            className="h-7 px-2 rounded border border-amber-300 bg-amber-50 text-[11px] font-medium text-amber-900 hover:bg-amber-100 inline-flex items-center gap-1"
            title="Record a filing-frequency change (typically driven by an AED letter or turnover threshold)"
          >
            <CalendarClockIcon size={11} /> Change frequency
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleUpload(f, 'vat_registration');
              e.target.value = '';
            }}
          />
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="h-7 px-2.5 rounded border border-brand-300 bg-brand-50 text-[11.5px] font-medium text-brand-800 hover:bg-brand-100 disabled:opacity-50 inline-flex items-center gap-1"
          >
            {uploading
              ? <Loader2Icon size={10} className="animate-spin" />
              : <UploadCloudIcon size={10} />}
            {currentVat ? 'Replace VAT letter' : 'Upload VAT letter'}
          </button>
        </div>
      </div>

      {postUploadNudge && (
        <div className="border-b border-amber-200 bg-amber-50/60 px-4 py-2.5 flex items-start justify-between gap-3">
          <div className="flex items-start gap-2 min-w-0">
            <CalendarClockIcon size={13} className="text-amber-700 mt-0.5 shrink-0" />
            <div className="text-[12px] text-amber-900 min-w-0">
              <span className="font-semibold">Does this letter change the filing frequency?</span>{' '}
              <span className="text-amber-800">
                &ldquo;{postUploadNudge.filename}&rdquo; is stored as {KIND_LABELS[postUploadNudge.kind].toLowerCase()}. If it
                revises your monthly / quarterly / annual schedule, record the change so future declarations use the right cadence.
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => {
                setFreqModal({ initialDocId: postUploadNudge.docId });
                setPostUploadNudge(null);
              }}
              className="h-7 px-2.5 rounded border border-amber-400 bg-amber-100 text-[11.5px] font-semibold text-amber-900 hover:bg-amber-200 inline-flex items-center gap-1"
            >
              Update frequency →
            </button>
            <button
              onClick={() => setPostUploadNudge(null)}
              className="h-7 px-2 rounded text-[11px] text-amber-800 hover:bg-amber-100"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="p-4 space-y-3">
        {/* Current VAT letter (special-case because we care about it most) */}
        {currentVat ? (
          <DocRow doc={currentVat} onOpen={openSignedUrl} onDelete={deleteDoc} highlight />
        ) : (
          <div className="rounded border border-dashed border-border bg-surface-alt/40 px-3 py-2 text-[11.5px] text-ink-muted">
            No VAT registration letter yet — upload one if you want to have it on file.
          </div>
        )}

        {currentOther.length > 0 && (
          <div className="pt-2 border-t border-divider space-y-2">
            {currentOther.map(d => (
              <DocRow key={d.id} doc={d} onOpen={openSignedUrl} onDelete={deleteDoc} />
            ))}
          </div>
        )}

        {showHistory && history.length > 0 && (
          <div className="pt-2 border-t border-divider">
            <div className="text-[10.5px] uppercase tracking-wide font-semibold text-ink-muted mb-1.5">
              Previous versions
            </div>
            <div className="space-y-2">
              {history.map(d => (
                <DocRow key={d.id} doc={d} onOpen={openSignedUrl} onDelete={deleteDoc} dim />
              ))}
            </div>
          </div>
        )}

        {/* Extra upload slots for non-VAT docs — kept low-key so they
            don't compete with the primary "Replace VAT letter" CTA. */}
        <div className="pt-2 border-t border-divider">
          <div className="text-[10.5px] uppercase tracking-wide font-semibold text-ink-muted mb-1.5">
            Other document kinds
          </div>
          <div className="flex flex-wrap gap-2">
            <KindUploadButton
              kind="articles_of_association"
              label="Articles of association"
              onPick={(f) => handleUpload(f, 'articles_of_association')}
              disabled={uploading}
            />
            <KindUploadButton
              kind="engagement_letter"
              label="Engagement letter"
              onPick={(f) => handleUpload(f, 'engagement_letter')}
              disabled={uploading}
            />
            <KindUploadButton
              kind="other"
              label="Other"
              onPick={(f) => handleUpload(f, 'other')}
              disabled={uploading}
            />
          </div>
        </div>
      </div>

      <DiffModal
        open={!!diffModal}
        onClose={() => setDiffModal(null)}
        entityId={entityId}
        docId={diffModal?.docId ?? ''}
        diff={diffModal?.diff ?? []}
        onApplied={() => {
          setDiffModal(null);
          onEntityPatched?.();
        }}
      />

      <FrequencyChangeModal
        open={!!freqModal}
        onClose={() => setFreqModal(null)}
        entityId={entityId}
        entityName={entityName}
        currentFrequency={currentFrequency}
        currentRegime={currentRegime}
        availableDocs={(docs ?? []).map((d) => ({
          id: d.id,
          kind: d.kind,
          filename: d.filename,
          uploaded_at: d.uploaded_at,
        }))}
        initialDocId={freqModal?.initialDocId ?? null}
        onApplied={() => {
          setFreqModal(null);
          onEntityPatched?.();
        }}
      />
    </div>
  );
}

function DocRow({
  doc, onOpen, onDelete, highlight, dim,
}: {
  doc: DocRow;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  highlight?: boolean;
  dim?: boolean;
}) {
  return (
    <div
      className={[
        'flex items-start justify-between gap-3 rounded-md px-3 py-2.5 border',
        highlight ? 'border-brand-200 bg-brand-50/30' : 'border-divider bg-surface',
        dim ? 'opacity-70' : '',
      ].join(' ')}
    >
      <div className="flex items-start gap-2.5 min-w-0 flex-1">
        <FileIcon size={14} className={highlight ? 'text-brand-600 mt-0.5 shrink-0' : 'text-ink-muted mt-0.5 shrink-0'} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[12.5px] font-medium text-ink truncate">{doc.filename}</span>
            <span className="text-[10px] text-ink-muted uppercase tracking-wide">{KIND_LABELS[doc.kind]}</span>
          </div>
          <div className="text-[11px] text-ink-muted mt-0.5 flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1">
              <ClockIcon size={9} /> Uploaded {fmtDate(doc.uploaded_at)}
            </span>
            {doc.size_bytes != null && (
              <>
                <span className="text-ink-faint">·</span>
                <span>{fmtBytes(doc.size_bytes)}</span>
              </>
            )}
            {doc.effective_from && (
              <>
                <span className="text-ink-faint">·</span>
                <span>Effective {doc.effective_from}</span>
              </>
            )}
          </div>
          {doc.extracted_fields?.warnings && doc.extracted_fields.warnings.length > 0 && (
            <div className="mt-1 text-[10.5px] text-amber-800 inline-flex items-start gap-1">
              <AlertTriangleIcon size={9} className="mt-0.5 shrink-0" />
              <span>
                {doc.extracted_fields.warnings.length} extraction warning{doc.extracted_fields.warnings.length === 1 ? '' : 's'}:{' '}
                <span className="text-amber-700">{doc.extracted_fields.warnings[0]}</span>
                {doc.extracted_fields.warnings.length > 1 && ' …'}
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => onOpen(doc.id)}
          className="h-7 px-2 rounded border border-border text-[11px] text-ink-muted hover:text-ink hover:bg-surface-alt inline-flex items-center gap-1"
          title="Open in new tab"
        >
          <ExternalLinkIcon size={10} /> Open
        </button>
        <button
          onClick={() => onDelete(doc.id)}
          className="h-7 px-2 rounded border border-border text-[11px] text-ink-muted hover:text-danger-700 hover:border-danger-200 hover:bg-danger-50 inline-flex items-center gap-1"
          title="Delete"
        >
          <Trash2Icon size={10} />
        </button>
      </div>
    </div>
  );
}

function KindUploadButton({
  kind, label, onPick, disabled,
}: {
  kind: Kind; label: string; onPick: (f: File) => void; disabled: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        onClick={() => ref.current?.click()}
        disabled={disabled}
        className="h-7 px-2.5 rounded border border-border text-[11px] font-medium text-ink-soft hover:text-ink hover:bg-surface-alt disabled:opacity-50 inline-flex items-center gap-1"
        title={`Upload ${label.toLowerCase()}`}
        data-kind={kind}
      >
        <UploadCloudIcon size={10} /> {label}
      </button>
    </>
  );
}

function DiffModal({
  open, onClose, entityId, docId, diff, onApplied,
}: {
  open: boolean;
  onClose: () => void;
  entityId: string;
  docId: string;
  diff: DiffRow[];
  onApplied: () => void;
}) {
  const toast = useToast();
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [applying, setApplying] = useState(false);

  // Pre-select every changed field on open — user can de-select any
  // they don't trust.
  useEffect(() => {
    if (!open) return;
    const next: Record<string, boolean> = {};
    for (const d of diff) next[d.field] = true;
    setSelected(next);
  }, [open, diff]);

  async function apply() {
    const applyFields: Record<string, string | null> = {};
    for (const d of diff) {
      if (selected[d.field]) applyFields[d.field] = d.after;
    }
    if (Object.keys(applyFields).length === 0) {
      toast.info('Pick at least one field to apply, or Cancel to close.');
      return;
    }
    setApplying(true);
    try {
      const res = await fetch(`/api/entities/${entityId}/apply-vat-letter-diff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document_id: docId, apply: applyFields }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body?.error?.message ?? 'Could not apply changes.', body?.error?.hint);
        return;
      }
      const count = body.count ?? Object.keys(applyFields).length;
      toast.success(`Applied ${count} change${count === 1 ? '' : 's'}.`);
      onApplied();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setApplying(false);
    }
  }

  // Surface frequency / regime changes specifically — these are the
  // ones that actually reshape the filing calendar. Sort them to the
  // top and render a banner at the top of the modal so the reviewer
  // can't miss them.
  const criticalFields = new Set(['frequency', 'regime']);
  const sortedDiff = [...diff].sort((a, b) => {
    const aCritical = criticalFields.has(a.field) ? 0 : 1;
    const bCritical = criticalFields.has(b.field) ? 0 : 1;
    return aCritical - bCritical;
  });
  const frequencyDiff = diff.find(d => d.field === 'frequency');
  const regimeDiff = diff.find(d => d.field === 'regime');

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="The new letter changes these fields"
      subtitle="Pick the ones you want to propagate to the entity. Nothing auto-applies."
      size="lg"
      footer={
        <div className="flex items-center justify-between w-full">
          <div className="text-[11px] text-ink-muted">
            {Object.values(selected).filter(Boolean).length} of {diff.length} selected
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={applying}
              className="h-8 px-3 rounded border border-border-strong text-[12px] text-ink-muted hover:text-ink"
            >
              Cancel
            </button>
            <button
              onClick={apply}
              disabled={applying}
              className="h-8 px-4 rounded bg-brand-500 text-white text-[12px] font-semibold hover:bg-brand-600 disabled:opacity-50 inline-flex items-center gap-1"
            >
              {applying ? <Loader2Icon size={12} className="animate-spin" /> : <CheckIcon size={12} />}
              Apply selected
            </button>
          </div>
        </div>
      }
    >
      {/* Critical-change banner — frequency / regime reshape the filing
          calendar. Calling these out explicitly beats having the user
          scan a list of 8 checkboxes. Per Diego: "si cambia la
          periodicidad, se debería actualizar de manera automática o
          manual". Manual + prominent is the safe default. */}
      {(frequencyDiff || regimeDiff) && (
        <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5">
          <div className="flex items-start gap-2">
            <AlertTriangleIcon size={14} className="text-amber-700 mt-0.5 shrink-0" />
            <div className="flex-1 text-[12px] text-amber-900">
              <div className="font-semibold">
                This letter changes how you file going forward.
              </div>
              {frequencyDiff && (
                <div className="mt-0.5">
                  Filing frequency: <strong>{frequencyDiff.before ?? 'unset'}</strong>{' '}
                  → <strong>{frequencyDiff.after ?? 'unset'}</strong>.
                  {' '}Future declarations will follow the new frequency from now on.
                </div>
              )}
              {regimeDiff && (
                <div className="mt-0.5">
                  Regime: <strong>{regimeDiff.before ?? 'unset'}</strong>{' '}
                  → <strong>{regimeDiff.after ?? 'unset'}</strong>.
                </div>
              )}
              <div className="mt-0.5 text-[11px] text-amber-800">
                Already-filed declarations keep their historical period type — only new ones change.
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        {sortedDiff.length === 0 ? (
          <div className="text-[12px] text-ink-muted text-center py-4">
            The new letter matches the entity exactly. Nothing to apply.
          </div>
        ) : (
          sortedDiff.map((d) => {
            const isCritical = criticalFields.has(d.field);
            return (
              <label
                key={d.field}
                className={[
                  'flex items-start gap-3 rounded-md border px-3 py-2.5 cursor-pointer transition-colors',
                  selected[d.field]
                    ? (isCritical ? 'border-amber-400 bg-amber-50/70' : 'border-brand-300 bg-brand-50/40')
                    : 'border-border bg-surface hover:bg-surface-alt/50',
                ].join(' ')}
              >
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={!!selected[d.field]}
                  onChange={(e) => setSelected({ ...selected, [d.field]: e.target.checked })}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-[10.5px] uppercase tracking-wide font-semibold flex items-center gap-1.5">
                    <span className={isCritical ? 'text-amber-900' : 'text-ink-muted'}>
                      {fieldLabel(d.field)}
                    </span>
                    {isCritical && (
                      <span className="inline-flex items-center gap-0.5 text-[9px] bg-amber-200 text-amber-900 px-1 py-0.5 rounded font-bold">
                        RESHAPES FILING
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 grid grid-cols-2 gap-3 text-[12px]">
                    <div className="min-w-0">
                      <div className="text-[9.5px] text-ink-faint uppercase">Current</div>
                      <div className="text-ink-soft truncate" title={d.before ?? ''}>
                        {d.before ?? <span className="italic text-ink-faint">empty</span>}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-[9.5px] text-ink-faint uppercase">From letter</div>
                      <div className="font-semibold text-ink truncate" title={d.after ?? ''}>
                        {d.after ?? <span className="italic text-ink-faint">empty</span>}
                      </div>
                    </div>
                  </div>
                </div>
              </label>
            );
          })
        )}
      </div>
    </Modal>
  );
}

function fieldLabel(field: string): string {
  return (
    {
      name: 'Entity name',
      legal_form: 'Legal form',
      vat_number: 'VAT number',
      matricule: 'Matricule',
      rcs_number: 'RCS number',
      address: 'Address',
      entity_type: 'Entity type',
      regime: 'Regime',
      frequency: 'Filing frequency',
    } as Record<string, string>
  )[field] ?? field;
}

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}
