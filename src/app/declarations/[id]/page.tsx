'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { TREATMENT_CODES, INCOMING_TREATMENTS, OUTGOING_TREATMENTS, type TreatmentCode } from '@/config/treatment-codes';
import { useToast } from '@/components/Toaster';
import { describeApiError } from '@/lib/ui-errors';
import { Breadcrumbs } from '@/components/ui/Breadcrumbs';
import { LifecycleStepper } from '@/components/ui/LifecycleStepper';
import { Tabs, type TabDef } from '@/components/ui/Tabs';
import { FileTextIcon, ClipboardCheckIcon, DownloadCloudIcon, FolderArchiveIcon, RefreshCwIcon, CheckCircle2Icon, RotateCcwIcon, SparklesIcon, ShareIcon } from 'lucide-react';
import { ValidatorPanel } from '@/components/validator/ValidatorPanel';

// ───── extracted modules (2026-04-18 refactor) ─────
import type {
  InvoiceLine, DocumentRec, DeclarationData, PreviewTarget,
} from './_types';
import { formatDate, fmtEUR } from './_helpers';
import {
  Stat, SummaryStat, SectionHeader, EmptyBlock, Spinner, ManualIcon,
} from './_atoms';
import { PreviewPanel } from './PreviewPanel';
import { OutputsPanel } from './OutputsPanel';
import { DeclarationNotes, FilingPanel } from './FilingPanel';
import { ShareLinkModal } from './ShareLinkModal';
import { DocRow, StatusBadge, TriageTag, FileIcon } from './DocRow';
import { TreatmentBadge } from './TreatmentBadge';

// ═══════════════════════════════════════════════════════════════
// Page
// ═══════════════════════════════════════════════════════════════
export default function DeclarationDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const toast = useToast();

  const [data, setData] = useState<DeclarationData | null>(null);
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const [fillingFx, setFillingFx] = useState(false);
  const [uploadingPrecedents, setUploadingPrecedents] = useState(false);
  // Legacy inline toast (kept for precedent report messages). New actions use the global toaster.
  const [precedentToast, setPrecedentToast] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [editingLine, setEditingLine] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<PreviewTarget>(null);
  const [previewWidth, setPreviewWidth] = useState(50);
  const [isDraggingDivider, setIsDraggingDivider] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);

  // New: active job progress + bulk selection
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState<{ total: number; processed: number; current: string | null; status: string; message?: string | null } | null>(null);
  const [selectedLineIds, setSelectedLineIds] = useState<Set<string>>(new Set());
  const [justCreatedLineId, setJustCreatedLineId] = useState<string | null>(null);

  // Tab + side-panel state. These MUST live above the `if (!data) return`
  // early return below, or React throws "Rendered more hooks than during
  // the previous render" when data transitions from null to an object.
  // Rules of Hooks: same hooks, same order, every render.
  const [activeTab, setActiveTab] = useState<'documents' | 'review' | 'filing' | 'outputs'>('review');
  const [validatorOpen, setValidatorOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const fileInput = useRef<HTMLInputElement>(null);
  const precedentInput = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const loadData = useCallback(async () => {
    const res = await fetch(`/api/declarations/${id}`);
    if (res.ok) setData(await res.json());
  }, [id]);

  useEffect(() => { loadData(); }, [loadData]);

  // Pick the smart default tab the FIRST time data loads for a given
  // declaration. Runs once per decl id — subsequent state changes
  // (e.g. adding a document) do not clobber the reviewer's active
  // tab. Logic:
  //   - nothing yet → Documents (upload zones)
  //   - approved/filed/paid → Filing (next action is filing-side)
  //   - otherwise → Review (the default work surface)
  const didPickDefaultTabRef = useRef<string | null>(null);
  useEffect(() => {
    if (!data) return;
    if (didPickDefaultTabRef.current === data.id) return;
    didPickDefaultTabRef.current = data.id;
    const activeCount = (data.lines || []).filter(l => l.state !== 'deleted').length;
    const smart =
      activeCount === 0 && (data.documents || []).length === 0 ? 'documents'
        : ['approved', 'filed', 'paid'].includes(data.status) ? 'filing'
        : 'review';
    setActiveTab(smart);
  }, [data]);

  // When a line is freshly created (via Add outgoing), scroll it into view
  // once the data has been reloaded.
  useEffect(() => {
    if (!justCreatedLineId) return;
    const row = document.getElementById(`row-${justCreatedLineId}`);
    if (row) {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Try to focus the first editable input in the row
      setTimeout(() => {
        const input = row.querySelector('input, textarea, select') as HTMLElement | null;
        input?.focus();
      }, 300);
      // Clear the marker so we don't re-scroll on unrelated re-renders
      setJustCreatedLineId(null);
    }
  }, [justCreatedLineId, data]);

  // On first load and whenever we see an active job anywhere on the page,
  // start a 1.5s poll that updates the progress bar.
  useEffect(() => {
    let stopped = false;
    async function tick() {
      const res = await fetch(`/api/declarations/${id}/active-job`);
      if (!res.ok) return;
      const job = await res.json();
      if (job && !stopped) {
        setActiveJobId(job.id);
        setJobProgress({
          total: job.total,
          processed: job.processed,
          current: job.current_item,
          status: job.status,
          message: job.message,
        });
        if (job.status !== 'running') {
          setTimeout(() => { setJobProgress(null); setActiveJobId(null); }, 2000);
          await loadData();
        }
      } else if (!stopped) {
        if (activeJobId) setActiveJobId(null);
        if (jobProgress) setJobProgress(null);
      }
    }
    tick();
    const int = setInterval(tick, 1500);
    return () => { stopped = true; clearInterval(int); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // ── Upload / Extract / Classify ──
  async function handleUpload(files: FileList | File[]) {
    if (!files.length) return;
    setUploading(true);
    const form = new FormData();
    form.set('declaration_id', id);
    for (const f of Array.from(files)) form.append('files', f);
    await fetch('/api/documents/upload', { method: 'POST', body: form });
    setUploading(false);
    loadData();
  }

  async function handlePrecedentUpload(files: FileList | File[]) {
    if (!files.length || !data) return;
    setUploadingPrecedents(true);
    setPrecedentToast(null);
    const form = new FormData();
    form.set('entity_id', data.entity_id);
    form.set('file', files[0]);
    const res = await fetch('/api/precedents/upload', { method: 'POST', body: form });
    const result = await res.json();
    if (res.ok) {
      setPrecedentToast(`Imported ${result.imported} precedent${result.imported === 1 ? '' : 's'} (${result.skipped} skipped).`);
      await handleClassify(); // re-run classification to apply precedents
    } else {
      setPrecedentToast(`Error: ${result.error || 'upload failed'}`);
    }
    setUploadingPrecedents(false);
    setTimeout(() => setPrecedentToast(null), 5000);
  }

  async function withPending(key: string, fn: () => Promise<void>) {
    if (pendingAction) return;
    setPendingAction(key);
    try { await fn(); } finally { setPendingAction(null); }
  }

  async function handleRetryDocument(docId: string) {
    await withPending(`retry-${docId}`, async () => {
      await fetch(`/api/documents/${docId}/retry`, { method: 'POST' });
      await loadData();
    });
  }
  async function handleIncludeAsInvoice(docId: string) {
    await withPending(`include-${docId}`, async () => {
      await fetch(`/api/documents/${docId}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force_triage_as: 'invoice' }),
      });
      await handleExtract();
    });
  }
  async function handleExtract() {
    setExtracting(true);
    await fetch(`/api/declarations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'extracting' }),
    });
    try {
      const res = await fetch(`/api/agents/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ declaration_id: id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const e = await describeApiError(res, 'Extraction failed');
        toast.error(e.message, e.hint);
        return;
      }
      if (body.job_id) setActiveJobId(body.job_id);
      if (body.documents_claimed === 0) {
        toast.info('No new documents to extract.');
      } else {
        toast.success('Extraction finished.');
      }
    } finally {
      setExtracting(false);
      setActiveJobId(null);
      setJobProgress(null);
      await loadData();
    }
  }
  async function handleCancelJob() {
    if (!activeJobId) return;
    await fetch(`/api/jobs/${activeJobId}`, { method: 'POST' });
    toast.info('Cancel requested — the current document will finish.');
  }

  async function handleBulkAction(action: string, value?: string) {
    const ids = Array.from(selectedLineIds);
    if (ids.length === 0) return;
    const res = await fetch('/api/invoice-lines/bulk', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, action, value }),
    });
    if (!res.ok) {
      const e = await describeApiError(res);
      toast.error(e.message, e.hint);
      return;
    }
    const body = await res.json();
    toast.success(`${body.changed} line${body.changed === 1 ? '' : 's'} updated.`);
    setSelectedLineIds(new Set());
    await loadData();
  }
  async function handleClassify() {
    setClassifying(true);
    try {
      const res = await fetch(`/api/agents/classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ declaration_id: id }),
      });
      if (!res.ok) {
        const e = await describeApiError(res, 'Classification failed');
        toast.error(e.message, e.hint);
        return;
      }
      const report = await res.json();
      const changes = Number(report.changes || 0);
      if (changes === 0) {
        toast.info('Rules re-run — no classifications changed.');
      } else {
        const samples = (report.change_samples || []).slice(0, 3)
          .map((c: { provider: string; from: string; to: string }) => `${c.provider.slice(0, 20)}: ${c.from} → ${c.to}`)
          .join(', ');
        toast.success(`${changes} line${changes === 1 ? '' : 's'} reclassified.`, samples || undefined);
      }
    } finally {
      setClassifying(false);
      await loadData();
    }
  }
  async function handleFillFx() {
    setFillingFx(true);
    try {
      const res = await fetch(`/api/declarations/${id}/fill-fx`, { method: 'POST' });
      const r = await res.json();
      if (res.ok) {
        setPrecedentToast(
          r.updated > 0
            ? `ECB rates fetched: ${r.updated} invoice(s) updated, ${r.skipped} skipped.`
            : 'No FX invoices needed updating.'
        );
        setTimeout(() => setPrecedentToast(null), 6000);
      }
    } finally {
      setFillingFx(false);
      await loadData();
    }
  }

  async function handleLineUpdate(lineId: string, updates: Record<string, unknown>) {
    // Optimistic: patch local state immediately for instant UI feedback.
    setData(d => {
      if (!d) return d;
      return {
        ...d,
        lines: d.lines.map(l => l.id === lineId ? { ...l, ...updates } : l),
      };
    });

    const res = await fetch(`/api/invoice-lines/${lineId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!res.ok) {
      const e = await describeApiError(res, 'Update failed');
      toast.error(e.message, e.hint);
      // Revert by reloading fresh server state
      loadData();
      return;
    }
    // Server may have normalised values (e.g. VAT cleaned). Reconcile.
    const updated = await res.json();
    setData(d => {
      if (!d) return d;
      return {
        ...d,
        lines: d.lines.map(l => l.id === lineId ? { ...l, ...updated } : l),
      };
    });
  }

  async function handleMoveLine(lineId: string, target: 'incoming' | 'outgoing' | 'excluded') {
    await withPending(`move-${lineId}`, async () => {
      await fetch(`/api/invoice-lines/${lineId}/move`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target }),
      });
      await loadData();
    });
  }

  async function handleStatusChange(newStatus: string, extra?: Record<string, unknown>) {
    const res = await fetch(`/api/declarations/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus, ...(extra || {}) }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(`Could not change status: ${err.error || 'unknown error'}`);
      return;
    }
    const result = await res.json();
    if (result.precedent_report) {
      const r = result.precedent_report;
      setPrecedentToast(
        `Approved. Precedent table updated: ${r.inserted} new + ${r.updated} refreshed (${r.total_lines_considered} lines considered).`
      );
      setTimeout(() => setPrecedentToast(null), 7000);
    }
    loadData();
  }
  async function handleProofUpload(file: File) {
    const form = new FormData();
    form.set('file', file);
    await fetch(`/api/declarations/${id}/proof-of-filing`, { method: 'POST', body: form });
    loadData();
  }
  async function handleAddOutgoing() {
    await withPending('add-outgoing', async () => {
      const res = await fetch('/api/invoices', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ declaration_id: id, direction: 'outgoing' }),
      });
      if (res.ok) {
        const body = await res.json();
        // Open the new line straight in edit mode with auto-focus + scroll.
        if (body.line_id) {
          setJustCreatedLineId(body.line_id);
          setEditingLine(body.line_id);
        }
        toast.success('Outgoing invoice added. Fill in the details.');
      }
      await loadData();
    });
  }

  // ── Preview ──
  function openPreviewForLine(line: InvoiceLine) {
    if (line.document_id) {
      setPreview({ kind: 'document', documentId: line.document_id, rowKey: line.id, filename: line.source_filename || undefined });
    } else {
      setPreview({ kind: 'manual', rowKey: line.id, provider: line.provider || 'Manual entry' });
    }
  }
  function openPreviewForDoc(doc: DocumentRec) {
    setPreview({ kind: 'document', documentId: doc.id, rowKey: `doc-${doc.id}`, filename: doc.filename });
  }

  // ── Keyboard nav ──
  const flatPreviewableRows = useMemo(() => {
    if (!data) return [] as { rowKey: string; line: InvoiceLine | null; doc: DocumentRec | null }[];
    const rows: { rowKey: string; line: InvoiceLine | null; doc: DocumentRec | null }[] = [];
    for (const doc of data.documents.filter(d => d.status !== 'rejected')) rows.push({ rowKey: `doc-${doc.id}`, line: null, doc });
    const active = data.lines.filter(l => l.state !== 'deleted');
    for (const line of active.filter(l => l.direction === 'incoming')) rows.push({ rowKey: line.id, line, doc: null });
    for (const line of active.filter(l => l.direction === 'outgoing')) rows.push({ rowKey: line.id, line, doc: null });
    for (const doc of data.documents.filter(d => d.status === 'rejected')) rows.push({ rowKey: `doc-${doc.id}`, line: null, doc });
    return rows;
  }, [data]);

  useEffect(() => {
    if (!preview) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); setPreview(null); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      const idx = flatPreviewableRows.findIndex(r => r.rowKey === preview.rowKey);
      const next = e.key === 'ArrowDown' ? idx + 1 : idx - 1;
      if (next < 0 || next >= flatPreviewableRows.length) return;
      const n = flatPreviewableRows[next];
      if (n.line) openPreviewForLine(n.line);
      else if (n.doc) openPreviewForDoc(n.doc);
      requestAnimationFrame(() => {
        document.getElementById(`row-${n.rowKey}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [preview, flatPreviewableRows]);

  // ── Resizable divider ──
  useEffect(() => {
    if (!isDraggingDivider) return;
    const onMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const fromRight = rect.right - e.clientX;
      const pct = Math.min(70, Math.max(25, (fromRight / rect.width) * 100));
      setPreviewWidth(pct);
    };
    const onUp = () => setIsDraggingDivider(false);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isDraggingDivider]);

  if (!data) return <div className="text-center py-12 text-ink-muted">Loading...</div>;

  const activeLines = data.lines.filter(l => l.state !== 'deleted');
  const deletedLines = data.lines.filter(l => l.state === 'deleted');
  const incomingLines = activeLines.filter(l => l.direction === 'incoming');
  const outgoingLines = activeLines.filter(l => l.direction === 'outgoing');
  const excludedDocs = data.documents.filter(d => d.status === 'rejected');
  const pendingDocs = data.documents.filter(d => d.status !== 'rejected');

  const totalExVat = incomingLines.reduce((s, l) => s + Number(l.amount_eur || 0), 0);
  const totalLuxVat = incomingLines.filter(l => l.treatment?.startsWith('LUX_')).reduce((s, l) => s + Number(l.vat_applied || 0), 0);
  const totalRC = incomingLines.filter(l => l.treatment?.startsWith('RC_')).reduce((s, l) => s + Number(l.rc_amount || 0), 0);
  const icAcqBase = incomingLines.filter(l => l.treatment === 'IC_ACQ').reduce((s, l) => s + Number(l.amount_eur || 0), 0);
  const icAcqVat = icAcqBase * 0.17;
  const totalDue = totalRC + icAcqVat;
  const unclassified = activeLines.filter(l => !l.treatment).length;
  const flagged = activeLines.filter(l => Boolean(l.flag) && !Boolean(l.flag_acknowledged)).length;

  const locked = ['approved', 'filed', 'paid'].includes(data.status);
  const hasFx = Boolean(data.has_fx);
  const previewOpen = !!preview;

  // activeTab + validatorOpen hooks are declared at the top of the
  // component (above the `if (!data) return` early return), per Rules
  // of Hooks. Here we just compute the smart default for first display.
  const tabs: TabDef[] = [
    { id: 'documents', label: 'Documents', icon: <FolderArchiveIcon size={14} />,
      badge: data.documentStats.errors > 0 ? data.documentStats.errors : undefined,
      badgeTone: 'warning' },
    { id: 'review',    label: 'Review',    icon: <FileTextIcon size={14} />,
      badge: unclassified + flagged > 0 ? unclassified + flagged : undefined,
      badgeTone: 'warning' },
    { id: 'filing',    label: 'Filing',    icon: <ClipboardCheckIcon size={14} /> },
    { id: 'outputs',   label: 'Outputs',   icon: <DownloadCloudIcon size={14} />,
      badge: activeLines.length > 0 ? undefined : undefined },
  ];

  return (
    <div ref={containerRef} className="flex w-full" style={{ minHeight: 'calc(100vh - 80px)' }}>
      {/* ─────────── LEFT COLUMN ─────────── */}
      <div
        className="flex flex-col min-w-0"
        style={{
          width: validatorOpen ? 'calc(100% - 440px)'
            : previewOpen ? `${100 - previewWidth}%`
            : '100%',
        }}
      >
        <div className="pr-3">
          {/* ─── Breadcrumbs ─── */}
          <Breadcrumbs
            crumbs={[
              { label: 'Declarations', href: '/declarations' },
              { label: data.entity_name, href: `/entities/${data.entity_id}` },
              { label: `${data.year} ${data.period}` },
            ]}
          />

          {/* ─── Page header ─── */}
          <header className="flex flex-wrap items-start justify-between gap-4 mb-5">
            <div className="min-w-0">
              <h1 className="text-[24px] font-bold text-ink tracking-tight leading-tight" style={{ letterSpacing: '-0.02em' }}>
                {data.entity_name}
              </h1>
              <div className="flex items-center gap-2 mt-1.5 text-[12.5px] text-ink-muted flex-wrap">
                <span className="font-medium text-ink-soft">{data.year} {data.period}</span>
                <span className="text-ink-faint">·</span>
                <span className="capitalize">{data.regime}</span>
                <span className="text-ink-faint">·</span>
                <span className="tabular-nums">{data.vat_number}</span>
                <StatusBadge status={data.status} />
              </div>
            </div>
            <div className="flex flex-wrap gap-2 items-center shrink-0">
              {hasFx && activeLines.length > 0 && !locked && (
                <button
                  onClick={handleFillFx}
                  disabled={fillingFx}
                  className="h-8 px-3 rounded-md border border-border text-[12.5px] font-medium text-ink-soft hover:bg-surface-alt hover:border-border-strong transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer inline-flex items-center gap-1.5"
                  title="Fetch ECB reference rates for non-EUR invoices"
                >
                  {fillingFx ? <Spinner small /> : <RefreshCwIcon size={13} />}
                  {fillingFx ? 'Fetching…' : 'Fetch FX'}
                </button>
              )}
              {activeLines.length > 0 && !locked && (
                <button
                  onClick={handleClassify}
                  disabled={classifying}
                  className="h-8 px-3 rounded-md border border-border text-[12.5px] font-medium text-ink-soft hover:bg-surface-alt hover:border-border-strong transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer inline-flex items-center gap-1.5"
                >
                  {classifying ? <Spinner small /> : <RefreshCwIcon size={13} />}
                  {classifying ? 'Classifying…' : 'Re-run rules'}
                </button>
              )}
              {activeLines.length > 0 && (
                <button
                  onClick={() => setValidatorOpen(v => !v)}
                  className={`h-8 px-3 rounded-md border text-[12.5px] font-medium transition-all duration-150 cursor-pointer inline-flex items-center gap-1.5 ${
                    validatorOpen
                      ? 'border-brand-500 bg-brand-50 text-brand-700'
                      : 'border-border text-ink-soft hover:bg-brand-50 hover:border-brand-300 hover:text-brand-700'
                  }`}
                  title="Opus second-opinion review (€0.05-0.15 per run)"
                >
                  <SparklesIcon size={13} />
                  Second opinion
                </button>
              )}
              {data.status === 'review' && (
                <button
                  onClick={() => setShareOpen(true)}
                  disabled={unclassified > 0 || flagged > 0}
                  className="h-8 px-3 rounded-md border border-border-strong text-[12.5px] font-medium text-ink-soft hover:bg-surface-alt hover:border-gray-400 transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer inline-flex items-center gap-1.5"
                  title={unclassified > 0 || flagged > 0 ? 'Resolve all issues before sharing for client approval' : 'Share a signed link with the fund manager for approval'}
                >
                  <ShareIcon size={13} />
                  Share for approval
                </button>
              )}
              {data.status === 'review' && (
                <button
                  onClick={() => handleStatusChange('approved')}
                  disabled={unclassified > 0 || flagged > 0}
                  className="h-8 px-4 rounded-md bg-success-500 text-white text-[12.5px] font-semibold hover:bg-success-700 transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer inline-flex items-center gap-1.5 shadow-xs"
                  title={unclassified > 0 || flagged > 0 ? `Cannot approve: ${unclassified} unclassified, ${flagged} unacknowledged flags` : 'Approve'}
                >
                  <CheckCircle2Icon size={13} />
                  Approve
                </button>
              )}
              {data.status === 'approved' && (
                <button
                  onClick={() => handleStatusChange('review')}
                  className="h-8 px-3 rounded-md border border-warning-500/40 text-[12.5px] font-medium text-warning-700 hover:bg-warning-50 transition-all duration-150 cursor-pointer inline-flex items-center gap-1.5"
                >
                  <RotateCcwIcon size={13} />
                  Reopen
                </button>
              )}
            </div>
          </header>

          {/* ─── Lifecycle stepper ─── */}
          <div className="mb-6 px-2 py-4 bg-surface border border-border rounded-xl shadow-xs">
            <LifecycleStepper status={data.status} />
          </div>

          {/* ─── Always-visible meta ─── */}
          {/* Job progress */}
          {jobProgress && (
            <JobProgressBar
              progress={jobProgress}
              onCancel={activeJobId && jobProgress.status === 'running' ? handleCancelJob : undefined}
            />
          )}

          <DeclarationNotes declarationId={id} initial={data.notes} />

          {precedentToast && (
            <div className="mb-4 px-3 py-2 rounded-md border border-success-500/30 bg-success-50 text-success-700 text-[12px] flex items-center gap-2 animate-fadeIn">
              <CheckCircle2Icon size={14} />
              {precedentToast}
            </div>
          )}

          {/* ─── Tabs ─── */}
          <div className="mb-5">
            <Tabs
              tabs={tabs}
              activeId={activeTab}
              onChange={(id) => setActiveTab(id as typeof activeTab)}
            />
          </div>

          {/* ─── TAB: Review ─── */}
          {activeTab === 'review' && (
            <>
              {/* Reconciliation card */}
              <div className="bg-surface border border-border rounded-xl p-4 mb-4 shadow-xs">
                <div className="grid grid-cols-3 md:grid-cols-6 gap-4">
                  <Stat label="Uploaded" value={data.documentStats.total} />
                  <Stat label="Invoices" value={data.documentStats.invoices} color="text-info-700" />
                  <Stat label="Excluded" value={excludedDocs.length + deletedLines.length} color="text-ink-faint" />
                  <Stat label="Errors" value={data.documentStats.errors} color={data.documentStats.errors > 0 ? 'text-danger-700' : 'text-ink-faint'} />
                  <Stat label="Lines" value={activeLines.length} />
                  <Stat label="Total EUR" value={totalExVat.toLocaleString('en-LU', { minimumFractionDigits: 2 })} small />
                </div>
              </div>
            </>
          )}

          {/* ─── TAB: Documents ─── */}
          {activeTab === 'documents' && (
            <div className="grid grid-cols-3 md:grid-cols-6 gap-4 bg-surface border border-border rounded-xl p-4 mb-4 shadow-xs">
              <Stat label="Uploaded" value={data.documentStats.total} />
              <Stat label="Invoices" value={data.documentStats.invoices} color="text-info-700" />
              <Stat label="Excluded" value={excludedDocs.length + deletedLines.length} color="text-ink-faint" />
              <Stat label="Errors" value={data.documentStats.errors} color={data.documentStats.errors > 0 ? 'text-danger-700' : 'text-ink-faint'} />
              <Stat label="Lines" value={activeLines.length} />
              <Stat label="Total EUR" value={totalExVat.toLocaleString('en-LU', { minimumFractionDigits: 2 })} small />
            </div>
          )}

          {/* Upload zones — only in Documents tab */}
          {activeTab === 'documents' && ['created', 'uploading', 'review'].includes(data.status) && (
            <div className="grid grid-cols-2 gap-3 mb-4">
              {/* Invoice upload */}
              <div
                className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-all duration-150 ${
                  dragOver ? 'border-[#1a1a2e] bg-blue-50' : 'border-border-strong bg-surface hover:border-gray-400 hover:bg-surface-alt'
                }`}
                onClick={() => fileInput.current?.click()}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => { e.preventDefault(); setDragOver(false); handleUpload(e.dataTransfer.files); }}
              >
                <input ref={fileInput} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.docx,.doc"
                  className="hidden" onChange={e => e.target.files && handleUpload(e.target.files)} />
                <div className="text-[11px] text-ink-faint uppercase tracking-wide font-semibold mb-1">Invoices</div>
                <div className="text-[12px] text-ink-soft">
                  {uploading ? 'Uploading…' : 'Drop PDFs here or click to browse'}
                </div>
              </div>

              {/* Precedents upload */}
              <div
                className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-all duration-150 border-border-strong bg-surface hover:border-gray-400 hover:bg-surface-alt"
                onClick={() => precedentInput.current?.click()}
              >
                <input ref={precedentInput} type="file" accept=".xlsx,.xls"
                  className="hidden" onChange={e => e.target.files && handlePrecedentUpload(e.target.files)} />
                <div className="text-[11px] text-ink-faint uppercase tracking-wide font-semibold mb-1">Prior-year appendix</div>
                <div className="text-[12px] text-ink-soft">
                  {uploadingPrecedents ? 'Parsing Excel…' : 'Upload .xlsx to seed precedents'}
                </div>
                {precedentToast && (
                  <div className="mt-2 text-[11px] text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1">{precedentToast}</div>
                )}
              </div>
            </div>
          )}

          {/* Pending documents — Documents tab only */}
          {activeTab === 'documents' && pendingDocs.length > 0 && (
            <div className="bg-surface border border-border rounded-lg mb-4 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border flex items-center justify-between bg-surface-alt">
                <h3 className="text-[13px] font-semibold text-ink">Documents ({pendingDocs.length})</h3>
                {pendingDocs.some(d => d.status === 'uploaded' || d.status === 'error') && (
                  <button
                    onClick={handleExtract}
                    disabled={extracting}
                    className="h-7 px-3 rounded bg-brand-500 text-white text-[11px] font-semibold hover:bg-brand-600 transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center gap-1.5"
                  >
                    {extracting && <Spinner small />}
                    {extracting ? 'Extracting…' : pendingDocs.some(d => d.status === 'error') ? 'Retry all errors' : 'Extract all'}
                  </button>
                )}
              </div>
              <div className="max-h-64 overflow-y-auto">
                {pendingDocs.map(doc => (
                  <DocRow
                    key={doc.id}
                    doc={doc}
                    selected={preview?.rowKey === `doc-${doc.id}`}
                    loading={pendingAction === `retry-${doc.id}`}
                    onSelect={() => openPreviewForDoc(doc)}
                    onRetry={() => handleRetryDocument(doc.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* ─── Review tab body ─── */}
          {activeTab === 'review' && (<>
          <SectionHeader title="Services Received" count={incomingLines.length} />
          {selectedLineIds.size > 0 && (
            <BulkActionBar
              count={selectedLineIds.size}
              onClear={() => setSelectedLineIds(new Set())}
              onAction={handleBulkAction}
              direction="incoming"
            />
          )}
          {incomingLines.length === 0 ? (
            <EmptyBlock>No incoming invoices yet.</EmptyBlock>
          ) : (
            <ReviewTable
              lines={incomingLines} direction="incoming" hasFx={hasFx}
              compact={previewOpen}
              editingLine={editingLine} setEditingLine={setEditingLine}
              onUpdate={handleLineUpdate} onMove={handleMoveLine}
              onOpenPreview={openPreviewForLine}
              selectedRowKey={preview?.rowKey}
              pendingAction={pendingAction}
              isLocked={locked}
              selectedIds={selectedLineIds}
              onSelectionChange={setSelectedLineIds}
            />
          )}

          {/* Services Rendered */}
          <div className="flex items-center justify-between mt-6 mb-2">
            <SectionHeader title="Services Rendered — Overall Turnover" count={outgoingLines.length} inline />
            {!locked && (
              <button
                onClick={handleAddOutgoing}
                disabled={pendingAction === 'add-outgoing'}
                className="h-7 px-2.5 rounded border border-border-strong text-[11px] font-medium text-ink-soft hover:bg-surface-alt hover:border-gray-400 transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                + Add outgoing invoice
              </button>
            )}
          </div>
          {outgoingLines.length === 0 ? (
            <EmptyBlock>
              No outgoing invoices. Click &quot;Add outgoing invoice&quot; to manually enter a management fee or consulting invoice issued by this entity.
            </EmptyBlock>
          ) : (
            <ReviewTable
              lines={outgoingLines} direction="outgoing" hasFx={hasFx}
              compact={previewOpen}
              editingLine={editingLine} setEditingLine={setEditingLine}
              onUpdate={handleLineUpdate} onMove={handleMoveLine}
              onOpenPreview={openPreviewForLine}
              selectedRowKey={preview?.rowKey}
              pendingAction={pendingAction}
              isLocked={locked}
              selectedIds={selectedLineIds}
              onSelectionChange={setSelectedLineIds}
            />
          )}

          {/* Excluded */}
          <div className="mt-6 mb-2">
            <SectionHeader title="Excluded — Review Required" count={excludedDocs.length + (showDeleted ? deletedLines.length : deletedLines.length)} />
          </div>
          {excludedDocs.length === 0 && deletedLines.length === 0 ? (
            <EmptyBlock>No excluded items.</EmptyBlock>
          ) : (
            <div className="bg-surface border border-border rounded-lg overflow-hidden">
              <table className="w-full text-[12px]">
                <thead className="bg-surface-alt text-ink-soft border-b border-border">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Source</th>
                    <th className="px-3 py-2 text-left font-medium">Reason</th>
                    <th className="px-3 py-2 text-right font-medium">Amount</th>
                    <th className="px-3 py-2 text-left font-medium w-44">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {excludedDocs.map(doc => {
                    const loading = pendingAction === `include-${doc.id}`;
                    return (
                      <tr
                        key={doc.id} id={`row-doc-${doc.id}`}
                        onClick={() => openPreviewForDoc(doc)}
                        className={`border-b border-divider last:border-0 transition-colors duration-150 cursor-pointer ${
                          preview?.rowKey === `doc-${doc.id}` ? 'bg-blue-50' : 'hover:bg-surface-alt'
                        }`}
                      >
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <FileIcon type={doc.file_type} />
                            <span className="truncate max-w-xs">{doc.filename}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2"><TriageTag triage={doc.triage_result} /></td>
                        <td className="px-3 py-2 text-right text-ink-faint">—</td>
                        <td className="px-3 py-2">
                          {!locked && (
                            <button
                              disabled={loading}
                              onClick={e => { e.stopPropagation(); handleIncludeAsInvoice(doc.id); }}
                              className="text-[11px] font-medium text-blue-600 hover:underline disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center gap-1"
                            >
                              {loading && <Spinner small />}
                              Include as invoice
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {deletedLines.map(line => (
                    <tr
                      key={line.id} id={`row-${line.id}`}
                      onClick={() => openPreviewForLine(line)}
                      className={`border-b border-divider last:border-0 transition-colors duration-150 cursor-pointer ${
                        preview?.rowKey === line.id ? 'bg-blue-50' : 'hover:bg-surface-alt'
                      }`}
                    >
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          {line.document_id ? <FileIcon type="pdf" /> : <ManualIcon />}
                          <span className="truncate max-w-xs">{line.provider || line.source_filename || 'Deleted line'}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-ink-muted">{line.deleted_reason || 'deleted'}</td>
                      <td className="px-3 py-2 text-right font-mono text-ink-muted">{fmtEUR(line.amount_eur)}</td>
                      <td className="px-3 py-2">
                        {!locked && (
                          <MoveDropdown
                            currentSection="excluded"
                            loading={pendingAction === `move-${line.id}`}
                            onMove={t => handleMoveLine(line.id, t)}
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {deletedLines.length > 0 && (
            <button
              onClick={() => setShowDeleted(!showDeleted)}
              className="text-[11px] text-ink-faint hover:text-ink-soft mt-2 cursor-pointer transition-colors duration-150"
            >
              {showDeleted ? 'Hide' : 'Show'} full deleted-line history
            </button>
          )}

          {/* Summary */}
          {activeLines.length > 0 && (
            <div className="bg-surface border border-border rounded-xl p-4 mt-6 mb-4 shadow-xs">
              <h3 className="text-[13px] font-semibold text-ink mb-3">Summary</h3>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-6 text-[13px]">
                <SummaryStat label="Lux VAT" value={`€${fmtEUR(totalLuxVat)}`} />
                <SummaryStat label="Reverse Charge VAT" value={`€${fmtEUR(totalRC)}`} />
                <SummaryStat label="IC Acq. VAT" value={`€${fmtEUR(icAcqVat)}`} />
                <SummaryStat label="Total Due (simplified)" value={`€${fmtEUR(totalDue)}`} bold />
                <SummaryStat
                  label="Blockers"
                  value={`${unclassified} uncls · ${flagged} flagged`}
                  color={unclassified > 0 || flagged > 0 ? 'text-danger-700' : 'text-success-700'}
                />
              </div>
            </div>
          )}
          </>)}
          {/* ─── /Review tab ─── */}

          {/* ─── Filing tab body ─── */}
          {activeTab === 'filing' && (
            <>
              {['approved', 'filed', 'paid'].includes(data.status) ? (
                <FilingPanel
                  data={data}
                  onMarkFiled={(filing_ref) => handleStatusChange('filed', { filing_ref })}
                  onMarkPaid={(payment_ref) => handleStatusChange('paid', payment_ref ? { payment_ref } : undefined)}
                  onReopen={() => handleStatusChange('review')}
                  onUploadProof={handleProofUpload}
                />
              ) : (
                <div className="bg-surface border border-border rounded-xl p-8 text-center shadow-xs">
                  <div className="w-12 h-12 rounded-full bg-brand-50 border border-brand-100 text-brand-500 inline-flex items-center justify-center mb-3">
                    <ClipboardCheckIcon size={20} />
                  </div>
                  <h3 className="text-[14px] font-semibold text-ink">Filing locked until approval</h3>
                  <p className="text-[12.5px] text-ink-muted mt-1.5 max-w-md mx-auto">
                    Approve the declaration first (use the green Approve button above). After approval you can record the AED filing reference, upload the proof of filing and confirm payment from here.
                  </p>
                </div>
              )}
            </>
          )}

          {/* ─── Outputs tab body ─── */}
          {activeTab === 'outputs' && (
            <>
              {activeLines.length > 0 ? (
                <OutputsPanel declarationId={id} />
              ) : (
                <div className="bg-surface border border-border rounded-xl p-8 text-center shadow-xs">
                  <div className="w-12 h-12 rounded-full bg-brand-50 border border-brand-100 text-brand-500 inline-flex items-center justify-center mb-3">
                    <DownloadCloudIcon size={20} />
                  </div>
                  <h3 className="text-[14px] font-semibold text-ink">No outputs yet</h3>
                  <p className="text-[12.5px] text-ink-muted mt-1.5 max-w-md mx-auto">
                    The appendix Excel, front-page PDF, eCDF XML and client email become available once at least one invoice line has been classified. Start in Documents or Review.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ─────────── DIVIDER ─────────── */}
      {previewOpen && (
        <div
          onMouseDown={e => { e.preventDefault(); setIsDraggingDivider(true); }}
          className="w-1 bg-gray-200 hover:bg-brand-500 transition-colors duration-150 cursor-col-resize relative group shrink-0"
          title="Drag to resize"
        >
          {/* Grab handle (visible on hover) */}
          <div className="absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 w-1 h-10 rounded bg-gray-300 group-hover:bg-brand-500 transition-colors duration-150" />
        </div>
      )}

      {/* ─────────── PREVIEW ─────────── */}
      {previewOpen && !validatorOpen && (
        <div style={{ width: `${previewWidth}%` }} className="min-w-[360px] pl-2">
          <PreviewPanel preview={preview} onClose={() => setPreview(null)} />
        </div>
      )}

      {/* ─────────── VALIDATOR PANEL ─────────── */}
      {validatorOpen && (
        <div className="w-[440px] min-w-[380px] pl-2 shrink-0">
          <div className="sticky top-4">
            <ValidatorPanel
              declarationId={id}
              isLocked={locked}
              onClose={() => setValidatorOpen(false)}
            />
          </div>
        </div>
      )}

      {/* ─────────── SHARE LINK MODAL ─────────── */}
      {shareOpen && (
        <ShareLinkModal declarationId={id} onClose={() => setShareOpen(false)} />
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════
// Review Table
// ═══════════════════════════════════════════════════════════════
function ReviewTable({
  lines, direction, hasFx, compact, editingLine, setEditingLine, onUpdate, onMove, onOpenPreview,
  selectedRowKey, pendingAction, isLocked, selectedIds, onSelectionChange,
}: {
  lines: InvoiceLine[];
  direction: 'incoming' | 'outgoing';
  hasFx: boolean;
  compact: boolean;
  editingLine: string | null;
  setEditingLine: (id: string | null) => void;
  onUpdate: (id: string, updates: Record<string, unknown>) => void;
  onMove: (id: string, target: 'incoming' | 'outgoing' | 'excluded') => void;
  onOpenPreview: (line: InvoiceLine) => void;
  selectedRowKey: string | undefined;
  pendingAction: string | null;
  isLocked: boolean;
  selectedIds?: Set<string>;
  onSelectionChange?: (next: Set<string>) => void;
}) {
  const treatments = direction === 'incoming' ? INCOMING_TREATMENTS : OUTGOING_TREATMENTS;
  const selectable = !isLocked && !!selectedIds && !!onSelectionChange;
  const allSelected = selectable && lines.length > 0 && lines.every(l => selectedIds!.has(l.id));
  const someSelected = selectable && !allSelected && lines.some(l => selectedIds!.has(l.id));

  function toggleAll() {
    if (!selectable) return;
    const next = new Set(selectedIds!);
    if (allSelected) {
      lines.forEach(l => next.delete(l.id));
    } else {
      lines.forEach(l => next.add(l.id));
    }
    onSelectionChange!(next);
  }
  function toggleOne(id: string) {
    if (!selectable) return;
    const next = new Set(selectedIds!);
    if (next.has(id)) next.delete(id); else next.add(id);
    onSelectionChange!(next);
  }

  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-[12px] border-collapse">
          <thead>
            <tr className="bg-surface-alt text-ink-soft border-b border-border">
              {selectable && (
                <Th width={32}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={el => { if (el) el.indeterminate = someSelected; }}
                    onChange={toggleAll}
                    className="cursor-pointer"
                  />
                </Th>
              )}
              <Th width={32}></Th>
              <Th>Provider</Th>
              {!compact && <Th>Country</Th>}
              <Th>Description</Th>
              {!compact && <Th>Date</Th>}
              {!compact && <Th>Inv. #</Th>}
              <Th right>Amount</Th>
              <Th right>Rate</Th>
              {!compact && <Th right>VAT</Th>}
              {!compact && <Th right>RC</Th>}
              {!compact && <Th right>Total</Th>}
              {hasFx && !compact && <Th right>Ccy</Th>}
              {hasFx && !compact && <Th right>FX Amt</Th>}
              {hasFx && !compact && <Th right>ECB</Th>}
              <Th>Treatment</Th>
              {!compact && <Th center>Flag</Th>}
              {!isLocked && <Th width={32}></Th>}
            </tr>
          </thead>
          <tbody>
            {lines.map(line => (
              <TableRow
                key={line.id}
                line={line}
                treatments={treatments}
                selectable={selectable}
                selected={!!(selectedIds && selectedIds.has(line.id))}
                onToggleSelect={() => toggleOne(line.id)}
                hasFx={hasFx}
                compact={compact}
                isEditing={editingLine === line.id}
                onEditToggle={() => setEditingLine(editingLine === line.id ? null : line.id)}
                onUpdate={onUpdate}
                onMove={onMove}
                onOpenPreview={onOpenPreview}
                isSelected={selectedRowKey === line.id}
                moveLoading={pendingAction === `move-${line.id}`}
                isLocked={isLocked}
                direction={direction}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children, right, center, width }: { children?: React.ReactNode; right?: boolean; center?: boolean; width?: number }) {
  return (
    <th
      style={width ? { width } : undefined}
      className={`px-2 py-2 font-medium text-[11px] uppercase tracking-wide text-ink-muted ${right ? 'text-right' : center ? 'text-center' : 'text-left'} whitespace-nowrap`}
    >
      {children}
    </th>
  );
}

// ═══════════════════════════════════════════════════════════════
// Table Row
// ═══════════════════════════════════════════════════════════════
function TableRow({
  line, treatments, hasFx, compact, isEditing, onEditToggle, onUpdate, onMove, onOpenPreview,
  isSelected, moveLoading, isLocked, direction,
  selectable, selected, onToggleSelect,
}: {
  line: InvoiceLine;
  treatments: readonly TreatmentCode[];
  hasFx: boolean;
  compact: boolean;
  isEditing: boolean;
  onEditToggle: () => void;
  onUpdate: (id: string, updates: Record<string, unknown>) => void;
  onMove: (id: string, target: 'incoming' | 'outgoing' | 'excluded') => void;
  onOpenPreview: (line: InvoiceLine) => void;
  isSelected: boolean;
  moveLoading: boolean;
  isLocked: boolean;
  direction: 'incoming' | 'outgoing';
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const flagAck = Boolean(line.flag_acknowledged);
  const isFlagged = Boolean(line.flag);
  const isInference = line.treatment_source === 'inference';
  const isPrecedent = line.treatment_source === 'precedent';

  const rowClass = [
    'border-b border-divider transition-colors duration-150',
    line.state === 'deleted' ? 'bg-surface-alt text-ink-faint line-through' : '',
    isSelected ? 'bg-blue-50' : !isLocked ? 'hover:bg-surface-alt/70' : '',
    isInference ? 'bg-amber-50/50' : '',
    isPrecedent && !isSelected ? 'bg-blue-50/40' : '',
    !line.treatment && !isSelected ? 'bg-red-50/30' : '',
  ].filter(Boolean).join(' ');

  const editCellProps = () => ({
    onClick: (e: React.MouseEvent) => {
      if (!isEditing && !isLocked) { e.stopPropagation(); onEditToggle(); }
    },
    className: 'px-2 py-1.5 ' + (isLocked ? 'cursor-default' : 'cursor-pointer'),
  });

  return (
    <tr id={`row-${line.id}`} className={rowClass}>
      {selectable && (
        <td className="px-2 py-1.5 text-center">
          <input
            type="checkbox"
            checked={!!selected}
            onChange={() => onToggleSelect?.()}
            onClick={e => e.stopPropagation()}
            className="cursor-pointer"
          />
        </td>
      )}
      {/* Preview icon */}
      <td className="px-1 py-1.5 text-center">
        <button
          onClick={e => { e.stopPropagation(); onOpenPreview(line); }}
          className="inline-flex w-6 h-6 items-center justify-center rounded text-ink-faint hover:text-brand-600 hover:bg-surface-alt transition-all duration-150 cursor-pointer"
          title={line.document_id ? `Preview: ${line.source_filename}` : 'No source document (manual)'}
        >
          {line.document_id ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          ) : (
            <ManualIcon />
          )}
        </button>
      </td>

      {/* Provider */}
      <td {...editCellProps()}>
        {isEditing && !isLocked ? (
          <input autoFocus className="w-full border border-border-strong rounded px-1.5 py-0.5 text-[12px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            defaultValue={line.provider}
            onClick={e => e.stopPropagation()}
            onBlur={e => onUpdate(line.id, { provider: e.target.value })} />
        ) : (
          <span className="font-medium text-ink block truncate max-w-[180px]">{line.provider || '—'}</span>
        )}
      </td>

      {!compact && (
        <td {...editCellProps()}>
          {isEditing && !isLocked ? (
            <input className="w-14 border border-border-strong rounded px-1.5 py-0.5 text-[12px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              defaultValue={line.country}
              onClick={e => e.stopPropagation()}
              onBlur={e => onUpdate(line.id, { country: e.target.value })} />
          ) : <span className="text-ink-soft">{line.country || '—'}</span>}
        </td>
      )}

      <td {...editCellProps()} title={line.description}>
        {isEditing && !isLocked ? (
          <input className="w-full border border-border-strong rounded px-1.5 py-0.5 text-[12px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            defaultValue={line.description}
            onClick={e => e.stopPropagation()}
            onBlur={e => onUpdate(line.id, { description: e.target.value })} />
        ) : (
          <span className="text-ink-soft block truncate max-w-[220px]">{line.description || '—'}</span>
        )}
      </td>

      {!compact && (
        <td {...editCellProps()}>
          {isEditing && !isLocked ? (
            <input type="date" className="border border-border-strong rounded px-1 py-0.5 text-[12px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              defaultValue={line.invoice_date}
              onClick={e => e.stopPropagation()}
              onBlur={e => onUpdate(line.id, { invoice_date: e.target.value })} />
          ) : <span className="text-ink-soft whitespace-nowrap">{formatDate(line.invoice_date)}</span>}
        </td>
      )}

      {!compact && (
        <td {...editCellProps()}>
          {isEditing && !isLocked ? (
            <input className="w-20 border border-border-strong rounded px-1.5 py-0.5 text-[12px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              defaultValue={line.invoice_number}
              onClick={e => e.stopPropagation()}
              onBlur={e => onUpdate(line.id, { invoice_number: e.target.value })} />
          ) : <span className="text-ink-soft">{line.invoice_number || '—'}</span>}
        </td>
      )}

      <td {...editCellProps()} className="px-2 py-1.5 text-right font-mono cursor-pointer tabular-nums">
        {isEditing && !isLocked ? (
          <input className="w-24 border border-border-strong rounded px-1.5 py-0.5 text-[12px] text-right focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            type="number" step="0.01" defaultValue={line.amount_eur}
            onClick={e => e.stopPropagation()}
            onBlur={e => onUpdate(line.id, { amount_eur: parseFloat(e.target.value) })} />
        ) : <span className="text-ink">{fmtEUR(line.amount_eur)}</span>}
      </td>

      <td className="px-2 py-1.5 text-right tabular-nums text-ink-muted">
        {line.vat_rate != null ? `${(Number(line.vat_rate) * 100).toFixed(0)}%` : '—'}
      </td>

      {!compact && <td className="px-2 py-1.5 text-right font-mono tabular-nums text-ink-soft">{fmtEUR(line.vat_applied)}</td>}
      {!compact && <td className="px-2 py-1.5 text-right font-mono tabular-nums text-ink-soft">{fmtEUR(line.rc_amount)}</td>}
      {!compact && <td className="px-2 py-1.5 text-right font-mono tabular-nums text-ink-muted">{fmtEUR(line.amount_incl)}</td>}

      {hasFx && !compact && (
        <>
          <td className="px-2 py-1.5 text-right text-ink-muted">{line.currency || '—'}</td>
          <td className="px-2 py-1.5 text-right font-mono tabular-nums text-ink-muted">{line.currency_amount ? fmtEUR(line.currency_amount) : '—'}</td>
          <td className="px-2 py-1.5 text-right text-ink-muted">{line.ecb_rate || '—'}</td>
        </>
      )}

      {/* Treatment */}
      <td {...editCellProps()}>
        {isEditing && !isLocked ? (
          <select
            className="border border-border-strong rounded px-1.5 py-0.5 text-[11px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            value={line.treatment || ''}
            onClick={e => e.stopPropagation()}
            onChange={e => onUpdate(line.id, { treatment: e.target.value || null, treatment_source: 'manual' })}
          >
            <option value="">Unclassified</option>
            {treatments.map(t => (
              <option key={t} value={t}>{t} — {TREATMENT_CODES[t].label}</option>
            ))}
          </select>
        ) : (
          <TreatmentBadge
            treatment={line.treatment}
            source={line.treatment_source}
            rule={line.classification_rule}
            flagReason={line.flag_reason}
          />
        )}
      </td>

      {!compact && (
        <td className="px-2 py-1.5 text-center">
          {isFlagged ? (
            <button
              className={`inline-flex w-6 h-6 items-center justify-center rounded transition-colors duration-150 cursor-pointer ${
                flagAck ? 'text-ink-faint hover:text-ink-faint' : 'text-amber-600 hover:text-amber-700 hover:bg-amber-100'
              }`}
              title={line.flag_reason || 'Flagged'}
              onClick={e => {
                e.stopPropagation();
                if (!flagAck && !isLocked) onUpdate(line.id, { flag_acknowledged: true });
              }}
            >
              {flagAck ? '✓' : '⚠'}
            </button>
          ) : <span className="text-gray-200">·</span>}
        </td>
      )}

      {!isLocked && (
        <td className="px-2 py-1.5 text-center">
          <MoveDropdown
            currentSection={direction === 'incoming' ? 'incoming' : 'outgoing'}
            loading={moveLoading}
            onMove={t => onMove(line.id, t)}
          />
        </td>
      )}
    </tr>
  );
}

// ═══════════════════════════════════════════════════════════════
// Move Dropdown
// ═══════════════════════════════════════════════════════════════
function MoveDropdown({
  currentSection, loading, onMove,
}: {
  currentSection: 'incoming' | 'outgoing' | 'excluded';
  loading?: boolean;
  onMove: (target: 'incoming' | 'outgoing' | 'excluded') => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [open]);

  const targets: { key: 'incoming' | 'outgoing' | 'excluded'; label: string; danger?: boolean }[] = [
    ...(currentSection !== 'incoming' ? [{ key: 'incoming' as const, label: 'Move to Services Received' }] : []),
    ...(currentSection !== 'outgoing' ? [{ key: 'outgoing' as const, label: 'Move to Services Rendered' }] : []),
    ...(currentSection !== 'excluded' ? [{ key: 'excluded' as const, label: 'Move to Excluded', danger: true }] : []),
  ];

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        disabled={loading}
        className="inline-flex w-6 h-6 items-center justify-center rounded text-ink-faint hover:text-brand-600 hover:bg-surface-alt transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        title="Move to another section"
      >
        {loading ? (
          <Spinner small />
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
          </svg>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 bg-surface border border-border rounded-md shadow-lg min-w-[210px] py-1 animate-fadeIn">
          {targets.map(t => (
            <button
              key={t.key}
              onClick={e => { e.stopPropagation(); setOpen(false); onMove(t.key); }}
              className={`block w-full text-left px-3 py-1.5 text-[12px] transition-colors duration-150 cursor-pointer ${
                t.danger ? 'text-red-600 hover:bg-red-50' : 'text-ink-soft hover:bg-surface-alt'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// (atoms + helpers + types have been extracted to _atoms.tsx / _helpers.ts
// / _types.ts — imports at top of file. Duplicate definitions removed.)



// ═══════════════════════════════════════════════════════════════
// Bulk action bar — shown above the review table when lines are selected.
// ═══════════════════════════════════════════════════════════════
function BulkActionBar({
  count, onClear, onAction, direction,
}: {
  count: number;
  onClear: () => void;
  onAction: (action: string, value?: string) => void;
  direction: 'incoming' | 'outgoing';
}) {
  const [treatmentOpen, setTreatmentOpen] = useState(false);
  const [confirmExcluded, setConfirmExcluded] = useState(false);
  const treatments = direction === 'incoming' ? INCOMING_TREATMENTS : OUTGOING_TREATMENTS;

  return (
    <div className="sticky top-0 z-10 mb-2 bg-brand-500 text-white rounded-lg px-3 py-2 flex items-center gap-2 text-[12px] animate-fadeIn">
      <span className="font-semibold">{count} selected</span>
      <span className="text-white/40 mx-1">·</span>
      <button
        onClick={() => onAction('mark_reviewed')}
        className="h-7 px-2.5 rounded bg-white/10 hover:bg-white/20 transition-colors cursor-pointer"
      >
        Mark reviewed
      </button>
      <button
        onClick={() => onAction('acknowledge_flag')}
        className="h-7 px-2.5 rounded bg-white/10 hover:bg-white/20 transition-colors cursor-pointer"
      >
        Acknowledge flags
      </button>
      <div className="relative">
        <button
          onClick={() => setTreatmentOpen(o => !o)}
          className="h-7 px-2.5 rounded bg-white/10 hover:bg-white/20 transition-colors cursor-pointer"
        >
          Set treatment ▾
        </button>
        {treatmentOpen && (
          <div className="absolute top-full left-0 mt-1 bg-surface text-ink border border-border rounded-md shadow-lg min-w-[240px] max-h-[300px] overflow-y-auto z-20">
            {treatments.map(t => (
              <button
                key={t}
                onClick={() => { setTreatmentOpen(false); onAction('set_treatment', t); }}
                className="block w-full text-left px-3 py-1.5 text-[11.5px] hover:bg-surface-alt cursor-pointer border-b border-divider last:border-0"
              >
                <span className="font-mono font-semibold mr-2">{t}</span>
                <span className="text-ink-soft">{TREATMENT_CODES[t].label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {confirmExcluded ? (
        <>
          <span className="text-white/70 ml-2">Are you sure?</span>
          <button
            onClick={() => { onAction('move_to_excluded'); setConfirmExcluded(false); }}
            className="h-7 px-2.5 rounded bg-red-500 hover:bg-red-600 transition-colors cursor-pointer font-semibold"
          >
            Yes, move to excluded
          </button>
          <button
            onClick={() => setConfirmExcluded(false)}
            className="h-7 px-2.5 rounded bg-white/10 hover:bg-white/20 transition-colors cursor-pointer"
          >
            Cancel
          </button>
        </>
      ) : (
        <button
          onClick={() => setConfirmExcluded(true)}
          className="h-7 px-2.5 rounded bg-white/10 hover:bg-red-500/80 transition-colors cursor-pointer"
        >
          Move to excluded
        </button>
      )}
      <div className="flex-1" />
      <button
        onClick={onClear}
        className="h-7 px-2.5 rounded bg-white/10 hover:bg-white/20 transition-colors cursor-pointer"
      >
        Clear
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Job progress bar — shown when extract / classify / fill_fx is running.
// Polled from the parent.
// ═══════════════════════════════════════════════════════════════
function JobProgressBar({
  progress, onCancel,
}: {
  progress: { total: number; processed: number; current: string | null; status: string; message?: string | null };
  onCancel?: () => void;
}) {
  const pct = progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0;
  const isRunning = progress.status === 'running';
  const isCancelled = progress.status === 'cancelled';
  const isError = progress.status === 'error';
  const isDone = progress.status === 'done';

  const bg =
    isDone ? 'bg-emerald-50 border-emerald-200'
    : isError ? 'bg-red-50 border-red-200'
    : isCancelled ? 'bg-amber-50 border-amber-200'
    : 'bg-blue-50 border-blue-200';

  const barColor =
    isDone ? 'bg-emerald-500'
    : isError ? 'bg-red-500'
    : isCancelled ? 'bg-amber-500'
    : 'bg-blue-500';

  const label =
    isRunning ? `Processing ${progress.processed}/${progress.total}`
    : isDone ? 'Finished'
    : isCancelled ? 'Cancelled'
    : isError ? 'Failed'
    : progress.status;

  return (
    <div className={`${bg} border rounded-lg p-3 mb-4 animate-fadeIn`}>
      <div className="flex items-center justify-between mb-2 gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {isRunning && <Spinner small />}
          <span className="text-[12px] font-semibold text-ink">{label}</span>
          {progress.current && isRunning && (
            <span className="text-[11px] text-ink-muted truncate">· {progress.current}</span>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-[11px] tabular-nums text-ink-soft">{pct}%</span>
          {onCancel && (
            <button
              onClick={onCancel}
              className="h-7 px-2.5 rounded border border-border-strong text-[11px] font-medium text-ink-soft hover:bg-surface hover:border-gray-400 cursor-pointer transition-all duration-150"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
      <div className="h-1.5 bg-white/70 rounded overflow-hidden">
        <div className={`h-full ${barColor} transition-all duration-300`} style={{ width: `${pct}%` }} />
      </div>
      {progress.message && !isRunning && (
        <div className="mt-2 text-[11px] text-ink-soft">{progress.message}</div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Notes (collapsible, auto-saving). Shown above the reconciliation card.
// Uses the existing notes column on declarations.
// ═══════════════════════════════════════════════════════════════


// (KeyBox + treatmentColorClass extracted to _atoms.tsx / _helpers.ts)

