'use client';

// ════════════════════════════════════════════════════════════════════════
// AttachmentsModal
//
// Per-invoice supporting documents. The reviewer attaches a contract /
// engagement letter / advisor email that justifies a particular VAT
// treatment, writes a short legal basis note, and optionally asks
// cifra to analyse the attached document (L2/L3).
//
// Everything here ends up in the audit-trail PDF — the compliance
// answer to "why did you classify this as EXEMPT_44 in Q3 2024?".
// ════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PaperclipIcon, XIcon, UploadIcon, FileTextIcon, MailIcon,
  ExternalLinkIcon, SparklesIcon, TrashIcon, Loader2Icon,
  AlertTriangleIcon, ShieldCheckIcon, CheckIcon, BookOpenIcon,
} from 'lucide-react';

type Kind = 'contract' | 'engagement_letter' | 'advisory_email' | 'other';

interface Attachment {
  id: string;
  invoice_id: string;
  kind: Kind;
  filename: string;
  file_size: number;
  file_type: string;
  user_note: string | null;
  legal_basis: string | null;
  ai_analysis: string | null;
  ai_summary: string | null;
  ai_suggested_treatment: string | null;
  ai_citations: Array<{ legal_id: string; quote?: string; reason?: string }> | null;
  ai_analyzed_at: string | null;
  ai_model: string | null;
  created_at: string;
}

export function AttachmentsModal({
  invoiceId, invoiceLabel, aiModeEntity, onClose,
}: {
  invoiceId: string;
  invoiceLabel: string;
  aiModeEntity: 'full' | 'classifier_only';
  onClose: () => void;
}) {
  const [items, setItems] = useState<Attachment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/attachments`);
      const data = await res.json();
      if (!res.ok) { setError(data?.error?.message ?? 'Load failed'); setItems([]); return; }
      setItems(data.attachments as Attachment[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
      setItems([]);
    }
  }, [invoiceId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-modal bg-ink/75 backdrop-blur-[6px] flex items-center justify-center p-4 animate-fadeIn"
      role="presentation" onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog" aria-modal="true" aria-labelledby="att-title"
        className="bg-surface rounded-lg w-full max-w-2xl shadow-2xl max-h-[90vh] flex flex-col"
      >
        {/* Header */}
        <div className="px-5 py-3 border-b border-border flex items-start justify-between shrink-0">
          <div className="flex items-start gap-2">
            <div className="w-8 h-8 rounded-md bg-brand-50 text-brand-700 inline-flex items-center justify-center shrink-0">
              <PaperclipIcon size={14} />
            </div>
            <div>
              <h3 id="att-title" className="text-base font-semibold text-ink leading-tight">
                Supporting documents
              </h3>
              <p className="text-xs text-ink-muted mt-0.5 leading-tight">
                {invoiceLabel} · Attach contracts or advisor notes that justify a VAT treatment. These go into the audit PDF.
              </p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close"
                  className="w-8 h-8 inline-flex items-center justify-center rounded-md hover:bg-surface-alt text-ink-soft">
            <XIcon size={15} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="text-sm text-danger-700 bg-danger-50 border border-danger-200 rounded px-3 py-2">
              {error}
            </div>
          )}

          <UploadForm
            invoiceId={invoiceId}
            onUploaded={load}
            uploading={uploading}
            setUploading={setUploading}
            setError={setError}
          />

          {items === null ? (
            <div className="text-center text-sm text-ink-muted py-6">
              <Loader2Icon className="inline-block animate-spin mr-2" size={14} />
              Loading…
            </div>
          ) : items.length === 0 ? (
            <div className="text-center text-sm text-ink-muted py-4 border border-dashed border-border rounded">
              No supporting documents attached yet.
            </div>
          ) : (
            <div className="space-y-3">
              {items.map(att => (
                <AttachmentRow
                  key={att.id}
                  att={att}
                  invoiceId={invoiceId}
                  aiModeEntity={aiModeEntity}
                  onChanged={load}
                  setError={setError}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border bg-surface-alt flex items-center justify-between shrink-0 gap-3">
          <div className="text-2xs text-ink-faint">
            Attachments are stored privately and included in the declaration&rsquo;s audit PDF.
          </div>
          <button onClick={onClose}
                  className="h-9 px-3 rounded border border-border-strong text-sm font-medium text-ink-soft hover:bg-surface-alt">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────── upload form ──────────────────────────

function UploadForm({
  invoiceId, onUploaded, uploading, setUploading, setError,
}: {
  invoiceId: string;
  onUploaded: () => void;
  uploading: boolean;
  setUploading: (v: boolean) => void;
  setError: (s: string | null) => void;
}) {
  const [kind, setKind] = useState<Kind>('contract');
  const [userNote, setUserNote] = useState('');
  const [legalBasis, setLegalBasis] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function onPick(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('kind', kind);
      if (userNote.trim()) form.append('user_note', userNote.trim());
      if (legalBasis.trim()) form.append('legal_basis', legalBasis.trim());
      const res = await fetch(`/api/invoices/${invoiceId}/attachments`, {
        method: 'POST', body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? 'Upload failed');
        return;
      }
      setUserNote(''); setLegalBasis('');
      onUploaded();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="bg-surface-alt/50 border border-border rounded-lg p-3">
      <div className="flex items-center gap-2 mb-2">
        <UploadIcon size={13} className="text-brand-600" />
        <span className="text-sm font-semibold text-ink">Attach new document</span>
      </div>
      <div className="grid grid-cols-2 gap-2 mb-2">
        <label className="text-xs text-ink-soft">
          <span className="block uppercase tracking-wide font-semibold text-ink-muted mb-1">Kind</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as Kind)}
            className="w-full h-8 px-2 text-sm border border-border-strong rounded bg-surface"
          >
            <option value="contract">Contract</option>
            <option value="engagement_letter">Engagement letter</option>
            <option value="advisory_email">Advisor email</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="text-xs text-ink-soft">
          <span className="block uppercase tracking-wide font-semibold text-ink-muted mb-1">Legal basis (optional)</span>
          <input
            type="text" value={legalBasis}
            onChange={(e) => setLegalBasis(e.target.value)}
            placeholder="e.g. Art. 44§1 d LTVA"
            className="w-full h-8 px-2 text-sm border border-border-strong rounded bg-surface"
          />
        </label>
      </div>
      <label className="block mb-2">
        <span className="block text-xs uppercase tracking-wide font-semibold text-ink-muted mb-1">Note (optional)</span>
        <textarea
          value={userNote}
          onChange={(e) => setUserNote(e.target.value)}
          rows={2}
          placeholder="Why is this document relevant? What does it establish about the VAT treatment?"
          className="w-full px-2 py-1.5 text-sm border border-border-strong rounded bg-surface resize-none"
        />
      </label>
      <div className="flex justify-end">
        <input
          ref={fileRef} type="file" accept=".pdf,.doc,.docx,.eml,.txt"
          className="hidden" onChange={(e) => onPick(e.target.files)}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="h-9 px-3 rounded bg-brand-500 text-white text-sm font-semibold hover:bg-brand-600 disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          {uploading
            ? (<><Loader2Icon size={13} className="animate-spin" /> Uploading…</>)
            : (<><UploadIcon size={13} /> Choose file…</>)}
        </button>
      </div>
    </div>
  );
}

// ────────────────────────── attachment row ──────────────────────────

function AttachmentRow({
  att, invoiceId, aiModeEntity, onChanged, setError,
}: {
  att: Attachment;
  invoiceId: string;
  aiModeEntity: 'full' | 'classifier_only';
  onChanged: () => void;
  setError: (s: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(att.user_note ?? '');
  const [basis, setBasis] = useState(att.legal_basis ?? '');
  const [kind, setKind] = useState<Kind>(att.kind);
  const [analyzing, setAnalyzing] = useState(false);
  const [expanded, setExpanded] = useState(false);

  async function save() {
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/attachments/${att.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_note: note, legal_basis: basis, kind }),
      });
      if (!res.ok) { setError('Save failed'); return; }
      setEditing(false);
      onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : 'Network error'); }
  }

  async function remove() {
    if (!confirm(`Remove "${att.filename}" from this invoice? The file stays in storage but no longer appears here or in the audit PDF.`)) return;
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/attachments/${att.id}`, { method: 'DELETE' });
      if (!res.ok) { setError('Delete failed'); return; }
      onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : 'Network error'); }
  }

  async function download() {
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/attachments/${att.id}/download`);
      const data = await res.json();
      if (res.ok && data.url) window.open(data.url, '_blank');
      else setError(data?.error?.message ?? 'Could not get download URL');
    } catch (e) { setError(e instanceof Error ? e.message : 'Network error'); }
  }

  async function analyze() {
    setError(null);
    setAnalyzing(true);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/attachments/${att.id}/analyze`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? 'Analysis failed');
        return;
      }
      setExpanded(true);
      onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : 'Network error'); }
    finally { setAnalyzing(false); }
  }

  const kindLabel = {
    contract: 'Contract',
    engagement_letter: 'Engagement letter',
    advisory_email: 'Advisor email',
    other: 'Other',
  }[att.kind];

  const kindIcon = att.kind === 'advisory_email' ? <MailIcon size={12} /> : <FileTextIcon size={12} />;

  return (
    <div className="border border-border rounded-lg bg-surface overflow-hidden">
      {/* Summary line */}
      <div className="px-3 py-2.5 flex items-start gap-3">
        <div className="w-8 h-8 rounded-md bg-surface-alt text-ink-soft inline-flex items-center justify-center shrink-0 mt-0.5">
          {kindIcon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={download}
              className="text-sm font-medium text-ink hover:text-brand-700 hover:underline inline-flex items-center gap-1 truncate max-w-full"
            >
              {att.filename} <ExternalLinkIcon size={11} className="shrink-0" />
            </button>
            <span className="text-2xs font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-surface-alt text-ink-soft">
              {kindLabel}
            </span>
            {att.ai_analyzed_at && (
              <span className="text-2xs font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-brand-50 text-brand-700 border border-brand-200 inline-flex items-center gap-1">
                <SparklesIcon size={9} /> analysed
              </span>
            )}
          </div>
          {att.legal_basis && (
            <div className="mt-1 text-xs text-ink-soft">
              <span className="text-ink-muted">Legal basis:</span> <code className="text-xs bg-surface-alt px-1 rounded">{att.legal_basis}</code>
            </div>
          )}
          {att.user_note && (
            <div className="mt-1 text-xs text-ink-soft italic">&ldquo;{att.user_note}&rdquo;</div>
          )}
          {att.ai_summary && (
            <div className="mt-2 text-xs text-ink bg-surface-alt/60 border-l-2 border-brand-400 pl-3 py-1.5 rounded-r">
              <span className="text-2xs uppercase font-semibold tracking-wider text-brand-700">cifra AI summary</span>
              <div className="mt-0.5">{att.ai_summary}</div>
            </div>
          )}
        </div>
        <div className="shrink-0 flex items-center gap-1">
          {!att.ai_analyzed_at && aiModeEntity === 'full' && (
            <button
              onClick={analyze}
              disabled={analyzing}
              className="h-7 px-2 rounded text-xs font-medium bg-brand-50 text-brand-700 hover:bg-brand-100 border border-brand-200 disabled:opacity-50 inline-flex items-center gap-1"
              title="Ask cifra to analyse this document"
            >
              {analyzing
                ? (<><Loader2Icon size={11} className="animate-spin" /> Analysing…</>)
                : (<><SparklesIcon size={11} /> Analyse</>)}
            </button>
          )}
          <button
            onClick={() => setEditing(!editing)}
            className="h-7 px-2 rounded text-xs font-medium text-ink-soft hover:bg-surface-alt"
            title="Edit note"
          >
            Edit
          </button>
          {(att.ai_analysis || att.ai_citations?.length) && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="h-7 px-2 rounded text-xs font-medium text-ink-soft hover:bg-surface-alt"
              title="Show / hide full analysis"
            >
              {expanded ? 'Hide' : 'Details'}
            </button>
          )}
          <button
            onClick={remove}
            className="h-7 w-7 rounded text-ink-faint hover:text-danger-700 hover:bg-danger-50 inline-flex items-center justify-center"
            title="Remove attachment"
          >
            <TrashIcon size={12} />
          </button>
        </div>
      </div>

      {/* Edit panel */}
      {editing && (
        <div className="px-3 py-3 border-t border-divider bg-surface-alt/40 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs">
              <span className="block uppercase tracking-wide font-semibold text-ink-muted mb-1">Kind</span>
              <select value={kind} onChange={e => setKind(e.target.value as Kind)}
                      className="w-full h-8 px-2 text-sm border border-border-strong rounded bg-surface">
                <option value="contract">Contract</option>
                <option value="engagement_letter">Engagement letter</option>
                <option value="advisory_email">Advisor email</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className="text-xs">
              <span className="block uppercase tracking-wide font-semibold text-ink-muted mb-1">Legal basis</span>
              <input value={basis} onChange={e => setBasis(e.target.value)}
                     placeholder="e.g. Art. 44§1 d LTVA"
                     className="w-full h-8 px-2 text-sm border border-border-strong rounded bg-surface" />
            </label>
          </div>
          <label className="block">
            <span className="block text-xs uppercase tracking-wide font-semibold text-ink-muted mb-1">Note</span>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
                      className="w-full px-2 py-1.5 text-sm border border-border-strong rounded bg-surface resize-none" />
          </label>
          <div className="flex justify-end gap-2">
            <button onClick={() => setEditing(false)}
                    className="h-8 px-3 rounded border border-border-strong text-xs font-medium text-ink-soft hover:bg-surface-alt">
              Cancel
            </button>
            <button onClick={save}
                    className="h-8 px-3 rounded bg-brand-500 text-white text-xs font-semibold hover:bg-brand-600 inline-flex items-center gap-1.5">
              <CheckIcon size={12} /> Save
            </button>
          </div>
        </div>
      )}

      {/* Analysis details (L2 + L3) */}
      {expanded && (att.ai_analysis || (att.ai_citations && att.ai_citations.length > 0)) && (
        <div className="px-3 py-3 border-t border-divider bg-brand-50/20 space-y-3">
          {att.ai_suggested_treatment && (
            <div className="flex items-center gap-2 text-sm">
              <ShieldCheckIcon size={12} className="text-brand-700" />
              <span className="text-ink-soft">cifra suggests treatment:</span>
              <code className="px-1.5 py-0.5 rounded bg-brand-50 text-brand-700 font-mono text-xs border border-brand-200 font-semibold">
                {att.ai_suggested_treatment}
              </code>
              <span className="text-2xs text-ink-faint">(you decide)</span>
            </div>
          )}
          {att.ai_analysis && (
            <div className="text-xs text-ink leading-relaxed whitespace-pre-wrap">
              {att.ai_analysis}
            </div>
          )}
          {att.ai_citations && att.ai_citations.length > 0 && (
            <div>
              <div className="text-2xs uppercase tracking-wide font-semibold text-ink-muted mb-1.5 flex items-center gap-1">
                <BookOpenIcon size={10} /> Legal citations
              </div>
              <ul className="space-y-1.5">
                {att.ai_citations.map((c, i) => (
                  <li key={i} className="text-xs bg-surface border border-border rounded px-2 py-1.5">
                    <code className="text-2xs font-mono bg-surface-alt px-1 py-0.5 rounded text-ink font-semibold">
                      {c.legal_id}
                    </code>
                    {c.reason && <span className="ml-2 text-ink-soft">{c.reason}</span>}
                    {c.quote && (
                      <div className="mt-1 italic text-ink-soft text-xs pl-3 border-l-2 border-brand-300">
                        &ldquo;{c.quote}&rdquo;
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {att.ai_analyzed_at && (
            <div className="text-2xs text-ink-faint">
              Analysed {new Date(att.ai_analyzed_at).toLocaleString('en-GB')} · model: <code>{att.ai_model}</code>
            </div>
          )}
        </div>
      )}
      {analyzing && !expanded && (
        <div className="px-3 py-2 border-t border-divider bg-brand-50/20 text-xs text-ink-muted flex items-center gap-2">
          <Loader2Icon size={12} className="animate-spin" />
          cifra is reading the document and matching citations…
        </div>
      )}
      {/* Warn users on classifier-only entities why the Analyse button is absent */}
      {!att.ai_analyzed_at && aiModeEntity === 'classifier_only' && (
        <div className="px-3 py-2 border-t border-divider bg-warning-50/40 text-xs text-warning-800 flex items-center gap-1.5">
          <AlertTriangleIcon size={11} />
          Entity is in classifier-only mode — AI analysis of attachments is disabled. Add your analysis manually in the note.
        </div>
      )}
    </div>
  );
}
