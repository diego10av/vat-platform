'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { TREATMENT_CODES, INCOMING_TREATMENTS, OUTGOING_TREATMENTS, type TreatmentCode } from '@/config/treatment-codes';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════
interface InvoiceLine {
  id: string;
  invoice_id: string;
  declaration_id: string;
  description: string;
  amount_eur: number;
  vat_rate: number;
  vat_applied: number;
  rc_amount: number;
  amount_incl: number;
  treatment: string | null;
  treatment_source: string | null;
  ai_confidence: number | null;
  classification_rule: string | null;
  flag: number | boolean;
  flag_reason: string | null;
  flag_acknowledged: number | boolean;
  reviewed: number | boolean;
  note: string | null;
  state: string;
  sort_order: number;
  provider: string;
  provider_vat: string;
  country: string;
  invoice_date: string;
  invoice_number: string;
  direction: string;
  currency: string | null;
  currency_amount: number | null;
  ecb_rate: number | null;
  document_id: string | null;
  extraction_source: string | null;
  source_filename: string | null;
  deleted_reason?: string | null;
}
interface DocumentRec {
  id: string;
  filename: string;
  file_type: string;
  file_size: number;
  status: string;
  triage_result: string | null;
  triage_confidence: number | null;
  error_message: string | null;
}
interface DeclarationData {
  id: string;
  entity_id: string;
  entity_name: string;
  year: number;
  period: string;
  status: string;
  regime: string;
  frequency: string;
  has_fx: number | boolean;
  has_outgoing: number | boolean;
  vat_number: string;
  matricule: string;
  documentStats: { total: number; uploaded: number; invoices: number; non_invoices: number; extracted: number; errors: number };
  documents: DocumentRec[];
  lines: InvoiceLine[];
}
type PreviewTarget =
  | { kind: 'document'; documentId: string; rowKey: string; filename?: string }
  | { kind: 'manual'; rowKey: string; provider: string }
  | null;

// ═══════════════════════════════════════════════════════════════
// Page
// ═══════════════════════════════════════════════════════════════
export default function DeclarationDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [data, setData] = useState<DeclarationData | null>(null);
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const [uploadingPrecedents, setUploadingPrecedents] = useState(false);
  const [precedentToast, setPrecedentToast] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null); // row-level loading
  const [editingLine, setEditingLine] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<PreviewTarget>(null);
  const [previewWidth, setPreviewWidth] = useState(50);
  const [isDraggingDivider, setIsDraggingDivider] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const precedentInput = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const loadData = useCallback(async () => {
    const res = await fetch(`/api/declarations/${id}`);
    if (res.ok) setData(await res.json());
  }, [id]);

  useEffect(() => { loadData(); }, [loadData]);

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
    await fetch(`/api/agents/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ declaration_id: id }),
    });
    setExtracting(false);
    await loadData();
  }
  async function handleClassify() {
    setClassifying(true);
    await fetch(`/api/agents/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ declaration_id: id }),
    });
    setClassifying(false);
    await loadData();
  }

  async function handleLineUpdate(lineId: string, updates: Record<string, unknown>) {
    await fetch(`/api/invoice-lines/${lineId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    loadData();
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

  async function handleStatusChange(newStatus: string) {
    await fetch(`/api/declarations/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
    loadData();
  }
  async function handleAddOutgoing() {
    await withPending('add-outgoing', async () => {
      await fetch('/api/invoices', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ declaration_id: id, direction: 'outgoing' }),
      });
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

  if (!data) return <div className="text-center py-12 text-gray-500">Loading...</div>;

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

  return (
    <div ref={containerRef} className="flex w-full" style={{ minHeight: 'calc(100vh - 80px)' }}>
      {/* ─────────── LEFT COLUMN ─────────── */}
      <div className="flex flex-col min-w-0" style={{ width: previewOpen ? `${100 - previewWidth}%` : '100%' }}>
        <div className="pr-3">
          {/* Header */}
          <header className="flex items-start justify-between mb-5">
            <div>
              <h1 className="text-[20px] font-semibold text-gray-900 tracking-tight">
                {data.entity_name}
                <span className="text-gray-400 font-normal ml-2">— {data.year} {data.period}</span>
              </h1>
              <div className="flex items-center gap-2 mt-1.5 text-[12px] text-gray-500">
                <span className="capitalize">{data.regime}</span>
                <span className="text-gray-300">•</span>
                <span>{data.vat_number}</span>
                <StatusBadge status={data.status} />
              </div>
            </div>
            <div className="flex gap-2 items-center">
              {activeLines.length > 0 && !locked && (
                <button
                  onClick={handleClassify}
                  disabled={classifying}
                  className="h-8 px-3 rounded border border-gray-300 text-xs font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  {classifying ? 'Classifying…' : 'Re-run rules'}
                </button>
              )}
              {data.status === 'review' && (
                <button
                  onClick={() => handleStatusChange('approved')}
                  disabled={unclassified > 0 || flagged > 0}
                  className="h-8 px-4 rounded bg-green-600 text-white text-xs font-semibold hover:bg-green-700 transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  title={unclassified > 0 || flagged > 0 ? `Cannot approve: ${unclassified} unclassified, ${flagged} unacknowledged flags` : 'Approve'}
                >
                  Approve
                </button>
              )}
              {data.status === 'approved' && (
                <button
                  onClick={() => handleStatusChange('review')}
                  className="h-8 px-3 rounded border border-orange-300 text-xs font-medium text-orange-600 hover:bg-orange-50 transition-all duration-150 cursor-pointer"
                >
                  Reopen
                </button>
              )}
            </div>
          </header>

          {/* Reconciliation card */}
          <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4">
            <div className="grid grid-cols-6 gap-4">
              <Stat label="Uploaded" value={data.documentStats.total} />
              <Stat label="Invoices" value={data.documentStats.invoices} color="text-blue-600" />
              <Stat label="Excluded" value={excludedDocs.length + deletedLines.length} color="text-gray-400" />
              <Stat label="Errors" value={data.documentStats.errors} color={data.documentStats.errors > 0 ? 'text-red-600' : 'text-gray-400'} />
              <Stat label="Lines" value={activeLines.length} />
              <Stat label="Total EUR" value={totalExVat.toLocaleString('en-LU', { minimumFractionDigits: 2 })} small />
            </div>
          </div>

          {/* Upload zones */}
          {['created', 'uploading', 'review'].includes(data.status) && (
            <div className="grid grid-cols-2 gap-3 mb-4">
              {/* Invoice upload */}
              <div
                className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-all duration-150 ${
                  dragOver ? 'border-[#1a1a2e] bg-blue-50' : 'border-gray-300 bg-white hover:border-gray-400 hover:bg-gray-50'
                }`}
                onClick={() => fileInput.current?.click()}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => { e.preventDefault(); setDragOver(false); handleUpload(e.dataTransfer.files); }}
              >
                <input ref={fileInput} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.docx,.doc"
                  className="hidden" onChange={e => e.target.files && handleUpload(e.target.files)} />
                <div className="text-[11px] text-gray-400 uppercase tracking-wide font-semibold mb-1">Invoices</div>
                <div className="text-[12px] text-gray-600">
                  {uploading ? 'Uploading…' : 'Drop PDFs here or click to browse'}
                </div>
              </div>

              {/* Precedents upload */}
              <div
                className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-all duration-150 border-gray-300 bg-white hover:border-gray-400 hover:bg-gray-50"
                onClick={() => precedentInput.current?.click()}
              >
                <input ref={precedentInput} type="file" accept=".xlsx,.xls"
                  className="hidden" onChange={e => e.target.files && handlePrecedentUpload(e.target.files)} />
                <div className="text-[11px] text-gray-400 uppercase tracking-wide font-semibold mb-1">Prior-year appendix</div>
                <div className="text-[12px] text-gray-600">
                  {uploadingPrecedents ? 'Parsing Excel…' : 'Upload .xlsx to seed precedents'}
                </div>
                {precedentToast && (
                  <div className="mt-2 text-[11px] text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1">{precedentToast}</div>
                )}
              </div>
            </div>
          )}

          {/* Pending documents */}
          {pendingDocs.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-lg mb-4 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-gray-200 flex items-center justify-between bg-gray-50">
                <h3 className="text-[13px] font-semibold text-gray-900">Documents ({pendingDocs.length})</h3>
                {pendingDocs.some(d => d.status === 'uploaded' || d.status === 'error') && (
                  <button
                    onClick={handleExtract}
                    disabled={extracting}
                    className="h-7 px-3 rounded bg-[#1a1a2e] text-white text-[11px] font-semibold hover:bg-[#2a2a4e] transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center gap-1.5"
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

          {/* Services Received */}
          <SectionHeader title="Services Received" count={incomingLines.length} />
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
            />
          )}

          {/* Services Rendered */}
          <div className="flex items-center justify-between mt-6 mb-2">
            <SectionHeader title="Services Rendered — Overall Turnover" count={outgoingLines.length} inline />
            {!locked && (
              <button
                onClick={handleAddOutgoing}
                disabled={pendingAction === 'add-outgoing'}
                className="h-7 px-2.5 rounded border border-gray-300 text-[11px] font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
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
            />
          )}

          {/* Excluded */}
          <div className="mt-6 mb-2">
            <SectionHeader title="Excluded — Review Required" count={excludedDocs.length + (showDeleted ? deletedLines.length : deletedLines.length)} />
          </div>
          {excludedDocs.length === 0 && deletedLines.length === 0 ? (
            <EmptyBlock>No excluded items.</EmptyBlock>
          ) : (
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-[12px]">
                <thead className="bg-gray-50 text-gray-600 border-b border-gray-200">
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
                        className={`border-b border-gray-100 last:border-0 transition-colors duration-150 cursor-pointer ${
                          preview?.rowKey === `doc-${doc.id}` ? 'bg-blue-50' : 'hover:bg-gray-50'
                        }`}
                      >
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <FileIcon type={doc.file_type} />
                            <span className="truncate max-w-xs">{doc.filename}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2"><TriageTag triage={doc.triage_result} /></td>
                        <td className="px-3 py-2 text-right text-gray-400">—</td>
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
                      className={`border-b border-gray-100 last:border-0 transition-colors duration-150 cursor-pointer ${
                        preview?.rowKey === line.id ? 'bg-blue-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          {line.document_id ? <FileIcon type="pdf" /> : <ManualIcon />}
                          <span className="truncate max-w-xs">{line.provider || line.source_filename || 'Deleted line'}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-gray-500">{line.deleted_reason || 'deleted'}</td>
                      <td className="px-3 py-2 text-right font-mono text-gray-500">{fmtEUR(line.amount_eur)}</td>
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
              className="text-[11px] text-gray-400 hover:text-gray-600 mt-2 cursor-pointer transition-colors duration-150"
            >
              {showDeleted ? 'Hide' : 'Show'} full deleted-line history
            </button>
          )}

          {/* Summary */}
          {activeLines.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-lg p-4 mt-6 mb-4">
              <h3 className="text-[13px] font-semibold text-gray-900 mb-3">Summary</h3>
              <div className="grid grid-cols-5 gap-6 text-[13px]">
                <SummaryStat label="Lux VAT" value={`€${fmtEUR(totalLuxVat)}`} />
                <SummaryStat label="Reverse Charge VAT" value={`€${fmtEUR(totalRC)}`} />
                <SummaryStat label="IC Acq. VAT" value={`€${fmtEUR(icAcqVat)}`} />
                <SummaryStat label="Total Due (simplified)" value={`€${fmtEUR(totalDue)}`} bold />
                <SummaryStat
                  label="Blockers"
                  value={`${unclassified} uncls · ${flagged} flagged`}
                  color={unclassified > 0 || flagged > 0 ? 'text-red-600' : 'text-green-600'}
                />
              </div>
            </div>
          )}

          {/* Outputs — Phase 4 */}
          {activeLines.length > 0 && (
            <OutputsPanel declarationId={id} />
          )}
        </div>
      </div>

      {/* ─────────── DIVIDER ─────────── */}
      {previewOpen && (
        <div
          onMouseDown={e => { e.preventDefault(); setIsDraggingDivider(true); }}
          className="w-1 bg-gray-200 hover:bg-[#1a1a2e] transition-colors duration-150 cursor-col-resize relative group shrink-0"
          title="Drag to resize"
        >
          {/* Grab handle (visible on hover) */}
          <div className="absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 w-1 h-10 rounded bg-gray-300 group-hover:bg-[#1a1a2e] transition-colors duration-150" />
        </div>
      )}

      {/* ─────────── PREVIEW ─────────── */}
      {previewOpen && (
        <div style={{ width: `${previewWidth}%` }} className="min-w-[360px] pl-2">
          <PreviewPanel preview={preview} onClose={() => setPreview(null)} />
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Preview Panel
// ═══════════════════════════════════════════════════════════════
function PreviewPanel({ preview, onClose }: { preview: PreviewTarget; onClose: () => void }) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [filename, setFilename] = useState<string>('');
  const [fileType, setFileType] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<'fit-width' | 'fit-page' | number>('fit-width');

  useEffect(() => {
    if (!preview) return;
    setZoom('fit-width');
    if (preview.kind !== 'document') { setSignedUrl(null); return; }
    setLoading(true); setError(null); setSignedUrl(null);
    fetch(`/api/documents/${preview.documentId}/url`)
      .then(async r => { if (!r.ok) throw new Error((await r.json()).error || 'Failed'); return r.json(); })
      .then(d => { setSignedUrl(d.url); setFilename(d.filename); setFileType(d.file_type); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [preview]);

  if (!preview) return null;

  const pdfSrc = fileType === 'pdf' && signedUrl
    ? `${signedUrl}#view=${zoom === 'fit-page' ? 'FitH' : 'FitH'}&toolbar=1`
    : signedUrl;

  const zoomPct = typeof zoom === 'number' ? zoom : (zoom === 'fit-width' ? 1 : 0.9);

  return (
    <div className="sticky top-2 flex flex-col border border-gray-200 rounded-lg overflow-hidden bg-white shadow-sm" style={{ height: 'calc(100vh - 96px)' }}>
      {/* Toolbar */}
      <div className="px-3 h-10 border-b border-gray-200 flex items-center justify-between bg-white">
        <div className="flex items-center gap-2 min-w-0">
          <FileIcon type={fileType || 'pdf'} />
          <span className="text-[12px] font-medium truncate text-gray-800">
            {preview.kind === 'manual' ? 'No source document' : (filename || 'Loading…')}
          </span>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {(fileType === 'image' || fileType === 'pdf') && signedUrl && (
            <>
              <IconBtn title="Zoom out" onClick={() => setZoom(z => typeof z === 'number' ? Math.max(0.25, z - 0.25) : 0.75)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="8" y1="11" x2="14" y2="11" /></svg>
              </IconBtn>
              <IconBtn title="Zoom in" onClick={() => setZoom(z => typeof z === 'number' ? Math.min(4, z + 0.25) : 1.25)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" /></svg>
              </IconBtn>
              <IconBtn title="Fit width" onClick={() => setZoom('fit-width')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h18"/><path d="M7 8l-4 4 4 4"/><path d="M17 8l4 4-4 4"/></svg>
              </IconBtn>
              <IconBtn title="Fit page" onClick={() => setZoom('fit-page')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
              </IconBtn>
              <div className="w-px h-5 bg-gray-200 mx-1" />
            </>
          )}
          {signedUrl && preview.kind === 'document' && (
            <IconBtn title="Open in new tab" onClick={() => window.open(signedUrl, '_blank', 'noopener')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            </IconBtn>
          )}
          <IconBtn title="Close (Esc)" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </IconBtn>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto bg-gray-100">
        {preview.kind === 'manual' ? (
          <ManualPlaceholder />
        ) : loading ? (
          <div className="flex items-center justify-center h-full"><Spinner /></div>
        ) : error ? (
          <div className="p-4 text-[12px] text-red-600 bg-red-50 border-b border-red-200">Error: {error}</div>
        ) : signedUrl ? (
          fileType === 'image' ? (
            <div className="flex items-start justify-center p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={signedUrl} alt={filename}
                style={{
                  transform: typeof zoom === 'number' ? `scale(${zoom})` : undefined,
                  transformOrigin: 'top center',
                  maxWidth: zoom === 'fit-width' ? '100%' : 'none',
                  maxHeight: zoom === 'fit-page' ? '100%' : 'none',
                }}
                className="bg-white shadow-sm" />
            </div>
          ) : fileType === 'pdf' ? (
            <iframe src={pdfSrc!} className="w-full h-full bg-white" title={filename} />
          ) : (
            <div className="p-4 text-[12px] text-gray-600">
              <a href={signedUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Download to preview</a>.
            </div>
          )
        ) : null}
      </div>

      {/* Footer hint */}
      <div className="px-3 h-7 border-t border-gray-200 text-[10px] text-gray-400 flex items-center justify-between bg-gray-50">
        <span>↑/↓ to navigate · Esc to close{typeof zoom === 'number' ? ` · zoom ${Math.round(zoomPct * 100)}%` : ''}</span>
        {preview.kind === 'document' && signedUrl && (
          <a href={signedUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
            Open full size ↗
          </a>
        )}
      </div>
    </div>
  );
}

function ManualPlaceholder() {
  return (
    <div className="flex items-center justify-center h-full bg-gray-50 p-8 text-center">
      <div>
        <div className="w-12 h-12 mx-auto rounded-full bg-gray-200 flex items-center justify-center mb-3">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
        </div>
        <div className="text-[13px] font-medium text-gray-700">No source document</div>
        <div className="text-[11px] text-gray-500 mt-1 max-w-[260px] mx-auto">
          This entry was added manually — it is an outgoing invoice issued by the entity.
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Review Table
// ═══════════════════════════════════════════════════════════════
function ReviewTable({
  lines, direction, hasFx, compact, editingLine, setEditingLine, onUpdate, onMove, onOpenPreview,
  selectedRowKey, pendingAction, isLocked,
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
}) {
  const treatments = direction === 'incoming' ? INCOMING_TREATMENTS : OUTGOING_TREATMENTS;

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-[12px] border-collapse">
          <thead>
            <tr className="bg-gray-50 text-gray-600 border-b border-gray-200">
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
      className={`px-2 py-2 font-medium text-[11px] uppercase tracking-wide text-gray-500 ${right ? 'text-right' : center ? 'text-center' : 'text-left'} whitespace-nowrap`}
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
}) {
  const flagAck = Boolean(line.flag_acknowledged);
  const isFlagged = Boolean(line.flag);
  const isInference = line.treatment_source === 'inference';
  const isPrecedent = line.treatment_source === 'precedent';

  const rowClass = [
    'border-b border-gray-100 transition-colors duration-150',
    line.state === 'deleted' ? 'bg-gray-50 text-gray-400 line-through' : '',
    isSelected ? 'bg-blue-50' : !isLocked ? 'hover:bg-gray-50/70' : '',
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
      {/* Preview icon */}
      <td className="px-1 py-1.5 text-center">
        <button
          onClick={e => { e.stopPropagation(); onOpenPreview(line); }}
          className="inline-flex w-6 h-6 items-center justify-center rounded text-gray-400 hover:text-[#1a1a2e] hover:bg-gray-100 transition-all duration-150 cursor-pointer"
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
          <input autoFocus className="w-full border border-gray-300 rounded px-1.5 py-0.5 text-[12px] focus:border-[#1a1a2e] focus:outline-none focus:ring-1 focus:ring-[#1a1a2e]"
            defaultValue={line.provider}
            onClick={e => e.stopPropagation()}
            onBlur={e => onUpdate(line.id, { provider: e.target.value })} />
        ) : (
          <span className="font-medium text-gray-900 block truncate max-w-[180px]">{line.provider || '—'}</span>
        )}
      </td>

      {!compact && (
        <td {...editCellProps()}>
          {isEditing && !isLocked ? (
            <input className="w-14 border border-gray-300 rounded px-1.5 py-0.5 text-[12px] focus:border-[#1a1a2e] focus:outline-none focus:ring-1 focus:ring-[#1a1a2e]"
              defaultValue={line.country}
              onClick={e => e.stopPropagation()}
              onBlur={e => onUpdate(line.id, { country: e.target.value })} />
          ) : <span className="text-gray-600">{line.country || '—'}</span>}
        </td>
      )}

      <td {...editCellProps()} title={line.description}>
        {isEditing && !isLocked ? (
          <input className="w-full border border-gray-300 rounded px-1.5 py-0.5 text-[12px] focus:border-[#1a1a2e] focus:outline-none focus:ring-1 focus:ring-[#1a1a2e]"
            defaultValue={line.description}
            onClick={e => e.stopPropagation()}
            onBlur={e => onUpdate(line.id, { description: e.target.value })} />
        ) : (
          <span className="text-gray-700 block truncate max-w-[220px]">{line.description || '—'}</span>
        )}
      </td>

      {!compact && (
        <td {...editCellProps()}>
          {isEditing && !isLocked ? (
            <input type="date" className="border border-gray-300 rounded px-1 py-0.5 text-[12px] focus:border-[#1a1a2e] focus:outline-none focus:ring-1 focus:ring-[#1a1a2e]"
              defaultValue={line.invoice_date}
              onClick={e => e.stopPropagation()}
              onBlur={e => onUpdate(line.id, { invoice_date: e.target.value })} />
          ) : <span className="text-gray-600 whitespace-nowrap">{formatDate(line.invoice_date)}</span>}
        </td>
      )}

      {!compact && (
        <td {...editCellProps()}>
          {isEditing && !isLocked ? (
            <input className="w-20 border border-gray-300 rounded px-1.5 py-0.5 text-[12px] focus:border-[#1a1a2e] focus:outline-none focus:ring-1 focus:ring-[#1a1a2e]"
              defaultValue={line.invoice_number}
              onClick={e => e.stopPropagation()}
              onBlur={e => onUpdate(line.id, { invoice_number: e.target.value })} />
          ) : <span className="text-gray-600">{line.invoice_number || '—'}</span>}
        </td>
      )}

      <td {...editCellProps()} className="px-2 py-1.5 text-right font-mono cursor-pointer tabular-nums">
        {isEditing && !isLocked ? (
          <input className="w-24 border border-gray-300 rounded px-1.5 py-0.5 text-[12px] text-right focus:border-[#1a1a2e] focus:outline-none focus:ring-1 focus:ring-[#1a1a2e]"
            type="number" step="0.01" defaultValue={line.amount_eur}
            onClick={e => e.stopPropagation()}
            onBlur={e => onUpdate(line.id, { amount_eur: parseFloat(e.target.value) })} />
        ) : <span className="text-gray-900">{fmtEUR(line.amount_eur)}</span>}
      </td>

      <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">
        {line.vat_rate != null ? `${(Number(line.vat_rate) * 100).toFixed(0)}%` : '—'}
      </td>

      {!compact && <td className="px-2 py-1.5 text-right font-mono tabular-nums text-gray-700">{fmtEUR(line.vat_applied)}</td>}
      {!compact && <td className="px-2 py-1.5 text-right font-mono tabular-nums text-gray-700">{fmtEUR(line.rc_amount)}</td>}
      {!compact && <td className="px-2 py-1.5 text-right font-mono tabular-nums text-gray-500">{fmtEUR(line.amount_incl)}</td>}

      {hasFx && !compact && (
        <>
          <td className="px-2 py-1.5 text-right text-gray-500">{line.currency || '—'}</td>
          <td className="px-2 py-1.5 text-right font-mono tabular-nums text-gray-500">{line.currency_amount ? fmtEUR(line.currency_amount) : '—'}</td>
          <td className="px-2 py-1.5 text-right text-gray-500">{line.ecb_rate || '—'}</td>
        </>
      )}

      {/* Treatment */}
      <td {...editCellProps()}>
        {isEditing && !isLocked ? (
          <select
            className="border border-gray-300 rounded px-1.5 py-0.5 text-[11px] focus:border-[#1a1a2e] focus:outline-none focus:ring-1 focus:ring-[#1a1a2e]"
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
                flagAck ? 'text-gray-300 hover:text-gray-400' : 'text-amber-600 hover:text-amber-700 hover:bg-amber-100'
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
        className="inline-flex w-6 h-6 items-center justify-center rounded text-gray-400 hover:text-[#1a1a2e] hover:bg-gray-100 transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
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
        <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded-md shadow-lg min-w-[210px] py-1 animate-fadeIn">
          {targets.map(t => (
            <button
              key={t.key}
              onClick={e => { e.stopPropagation(); setOpen(false); onMove(t.key); }}
              className={`block w-full text-left px-3 py-1.5 text-[12px] transition-colors duration-150 cursor-pointer ${
                t.danger ? 'text-red-600 hover:bg-red-50' : 'text-gray-700 hover:bg-gray-50'
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

// ═══════════════════════════════════════════════════════════════
// Treatment Badge
// ═══════════════════════════════════════════════════════════════
function TreatmentBadge({
  treatment, source, rule, flagReason,
}: {
  treatment: string | null; source: string | null; rule: string | null; flagReason: string | null;
}) {
  if (!treatment) {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-700 border border-red-200 tracking-wide">UNCLASSIFIED</span>;
  }
  const code = treatment as TreatmentCode;
  const spec = TREATMENT_CODES[code];
  const colors = treatmentColorClass(code, source);
  const labelParts = [];
  if (rule === 'PRECEDENT') labelParts.push('Precedent match (prior year)');
  else if (rule?.startsWith('INFERENCE')) labelParts.push(`${rule} — proposed`);
  else if (rule && rule !== 'NO_MATCH') labelParts.push(`Classified by ${rule}`);
  if (spec?.label) labelParts.push(spec.label);
  if (source) labelParts.push(`source: ${source}`);
  if (flagReason) labelParts.push(`⚠ ${flagReason}`);
  const tooltip = labelParts.join(' • ');

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold tracking-wide ${colors}`} title={tooltip}>
      {treatment}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════
// Doc row
// ═══════════════════════════════════════════════════════════════
function DocRow({
  doc, selected, loading, onSelect, onRetry,
}: {
  doc: DocumentRec; selected: boolean; loading: boolean;
  onSelect: () => void; onRetry: () => void;
}) {
  return (
    <div
      id={`row-doc-${doc.id}`}
      onClick={onSelect}
      className={`px-4 py-2 border-b border-gray-100 last:border-0 text-[12px] cursor-pointer transition-colors duration-150 ${selected ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <FileIcon type={doc.file_type} />
          <span className="truncate">{doc.filename}</span>
          <span className="text-[10px] text-gray-400 shrink-0">{(doc.file_size / 1024).toFixed(0)} KB</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <TriageTag triage={doc.triage_result} />
          <DocStatusTag status={doc.status} />
        </div>
      </div>
      {doc.status === 'error' && doc.error_message && (
        <div onClick={e => e.stopPropagation()}
          className="mt-1 ml-6 text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1 break-words flex items-start justify-between gap-2">
          <div className="flex-1"><span className="font-semibold">Error:</span> {doc.error_message}</div>
          <button
            disabled={loading}
            onClick={onRetry}
            className="text-blue-600 hover:underline shrink-0 font-semibold disabled:opacity-40 cursor-pointer flex items-center gap-1"
          >
            {loading && <Spinner small />}Retry
          </button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Small components
// ═══════════════════════════════════════════════════════════════
function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    created: 'bg-gray-100 text-gray-700',
    uploading: 'bg-blue-100 text-blue-700',
    extracting: 'bg-purple-100 text-purple-700',
    classifying: 'bg-yellow-100 text-yellow-700',
    review: 'bg-orange-100 text-orange-700',
    approved: 'bg-green-100 text-green-700',
    filed: 'bg-emerald-100 text-emerald-800',
    paid: 'bg-teal-100 text-teal-800',
  };
  return <span className={`text-[10px] px-2 py-0.5 rounded font-semibold uppercase tracking-wide ${colors[status] || 'bg-gray-100'}`}>{status}</span>;
}
function DocStatusTag({ status }: { status: string }) {
  const colors: Record<string, string> = {
    uploaded: 'bg-gray-100 text-gray-600',
    triaging: 'bg-purple-100 text-purple-600',
    triaged: 'bg-blue-100 text-blue-600',
    extracting: 'bg-yellow-100 text-yellow-600',
    extracted: 'bg-green-100 text-green-600',
    rejected: 'bg-orange-100 text-orange-600',
    error: 'bg-red-100 text-red-600',
  };
  return <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${colors[status] || 'bg-gray-100'}`}>{status}</span>;
}
function TriageTag({ triage }: { triage: string | null }) {
  if (!triage) return <span className="text-[10px] text-gray-400">—</span>;
  const colors: Record<string, string> = {
    invoice: 'bg-blue-100 text-blue-700',
    credit_note: 'bg-purple-100 text-purple-700',
    wrong_entity: 'bg-orange-100 text-orange-700',
    receipt: 'bg-yellow-100 text-yellow-700',
    aed_letter: 'bg-red-100 text-red-700',
    expense_claim: 'bg-pink-100 text-pink-700',
    duplicate: 'bg-gray-100 text-gray-600',
    other: 'bg-gray-100 text-gray-600',
  };
  return <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${colors[triage] || 'bg-gray-100'}`}>{triage}</span>;
}
function FileIcon({ type }: { type: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400 shrink-0">
      {type === 'image' ? (
        <>
          <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
        </>
      ) : (
        <>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
        </>
      )}
    </svg>
  );
}
function ManualIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-300">
      <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
    </svg>
  );
}
function IconBtn({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title: string }) {
  return (
    <button onClick={onClick} title={title}
      className="inline-flex w-7 h-7 items-center justify-center rounded text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors duration-150 cursor-pointer">
      {children}
    </button>
  );
}
function Stat({ label, value, color, small }: { label: string; value: string | number; color?: string; small?: boolean }) {
  return (
    <div>
      <div className="text-[10px] text-gray-500 uppercase tracking-wide font-semibold">{label}</div>
      <div className={`font-semibold mt-1 tabular-nums ${color || 'text-gray-900'} ${small ? 'text-sm' : 'text-lg'}`}>{value}</div>
    </div>
  );
}
function SummaryStat({ label, value, color, bold }: { label: string; value: string; color?: string; bold?: boolean }) {
  return (
    <div>
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className={`tabular-nums mt-0.5 ${bold ? 'font-bold text-[15px]' : 'font-semibold text-[13px]'} ${color || 'text-gray-900'}`}>{value}</div>
    </div>
  );
}
function SectionHeader({ title, count, inline }: { title: string; count: number; inline?: boolean }) {
  return (
    <h3 className={`text-[13px] font-semibold text-gray-900 ${inline ? '' : 'mb-2'}`}>
      {title} <span className="text-gray-400 font-normal ml-1">({count})</span>
    </h3>
  );
}
function EmptyBlock({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6 text-center text-[12px] text-gray-400">
      {children}
    </div>
  );
}
function Spinner({ small }: { small?: boolean }) {
  const size = small ? 12 : 18;
  return (
    <svg className="animate-spin text-current" width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25"/>
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════
function formatDate(d: string | null): string {
  if (!d) return '—';
  const parts = d.split('-');
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return d;
}
function fmtEUR(v: number | null | string): string {
  if (v == null || v === '') return '—';
  const n = Number(v);
  if (isNaN(n)) return '—';
  return n.toLocaleString('en-LU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
// ═══════════════════════════════════════════════════════════════
// Outputs Panel — Phase 4 (eCDF boxes, payment ref, Excel download)
// ═══════════════════════════════════════════════════════════════
interface BoxResult {
  box: string;
  label: string;
  section: string;
  value: number;
  computation: 'sum' | 'formula' | 'manual';
  formula?: string;
  manual?: boolean;
}
interface ECDFReport {
  regime: 'simplified' | 'ordinary';
  year: number;
  period: string;
  form_version: string;
  boxes: BoxResult[];
  box_values: Record<string, number>;
  totals: { vat_due: number; payable: number; credit: number };
  manual_boxes_pending: string[];
  warnings: string[];
}
interface Payment {
  reference: string;
  iban: string;
  bic: string;
  beneficiary: string;
  amount: number;
}
interface OutputsResponse {
  ecdf: ECDFReport;
  payment: Payment | null;
  payment_error: string | null;
  declaration: { year: number; period: string; status: string; entity_name: string };
}

function OutputsPanel({ declarationId }: { declarationId: string }) {
  const [data, setData] = useState<OutputsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedRef, setCopiedRef] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/declarations/${declarationId}/outputs`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [declarationId]);

  useEffect(() => { load(); }, [load]);

  function copyReference() {
    if (!data?.payment?.reference) return;
    navigator.clipboard.writeText(data.payment.reference).then(() => {
      setCopiedRef(true);
      setTimeout(() => setCopiedRef(false), 1500);
    });
  }

  if (loading && !data) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-8 flex items-center gap-2 text-[12px] text-gray-500">
        <Spinner small /> Computing outputs…
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white border border-red-200 rounded-lg p-4 mb-8 text-[12px] text-red-700">
        Error computing outputs: {error}
      </div>
    );
  }

  if (!data) return null;

  const boxesBySection: Record<string, BoxResult[]> = {};
  for (const b of data.ecdf.boxes) {
    if (!boxesBySection[b.section]) boxesBySection[b.section] = [];
    boxesBySection[b.section].push(b);
  }
  const sectionOrder = ['A', 'B', 'D', 'F', 'I', 'III', 'IV'];
  const sections = sectionOrder.filter(s => boxesBySection[s]);

  const download = (path: string) => () => {
    window.location.href = `/api/declarations/${declarationId}/${path}`;
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg mb-8 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
        <div>
          <h3 className="text-[13px] font-semibold text-gray-900">Outputs</h3>
          <div className="text-[11px] text-gray-500 mt-0.5">
            {data.ecdf.regime === 'simplified' ? 'Simplified return' : 'Ordinary return'} ·{' '}
            {data.ecdf.year} {data.ecdf.period} · form {data.ecdf.form_version}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={download('excel')}
            className="h-8 px-3 rounded bg-[#1a1a2e] text-white text-[11px] font-semibold hover:bg-[#2a2a4e] transition-all duration-150 cursor-pointer flex items-center gap-1.5"
          >
            <DownloadIcon /> Excel
          </button>
          <button
            onClick={download('xml')}
            className="h-8 px-3 rounded border border-gray-300 text-[11px] font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition-all duration-150 cursor-pointer flex items-center gap-1.5"
          >
            <DownloadIcon /> eCDF XML
          </button>
          <button
            onClick={() => setEmailOpen(true)}
            className="h-8 px-3 rounded border border-gray-300 text-[11px] font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition-all duration-150 cursor-pointer flex items-center gap-1.5"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
            Draft email
          </button>
          <button
            onClick={() => setExpanded(!expanded)}
            className="h-8 px-3 rounded border border-gray-300 text-[11px] font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition-all duration-150 cursor-pointer"
          >
            {expanded ? 'Hide boxes' : 'All boxes'}
          </button>
        </div>
      </div>
      {emailOpen && <EmailDrafterModal declarationId={declarationId} onClose={() => setEmailOpen(false)} />}

      <div className="p-4">
        {/* Totals row */}
        <div className="grid grid-cols-3 gap-4 mb-4 pb-4 border-b border-gray-200">
          <KeyBox
            label={`VAT due (box ${data.ecdf.regime === 'simplified' ? '076' : '097'})`}
            value={fmtEUR(data.ecdf.totals.vat_due)}
            bold
          />
          <KeyBox
            label="Payable to AED"
            value={`€${fmtEUR(data.ecdf.totals.payable)}`}
            color={data.ecdf.totals.payable > 0 ? 'text-gray-900' : 'text-gray-400'}
          />
          <KeyBox
            label="Credit"
            value={`€${fmtEUR(data.ecdf.totals.credit)}`}
            color={data.ecdf.totals.credit > 0 ? 'text-green-600' : 'text-gray-400'}
          />
        </div>

        {/* Payment instructions */}
        {data.payment ? (
          <div className="mb-4">
            <h4 className="text-[11px] uppercase tracking-wide font-semibold text-gray-500 mb-2">Payment instructions</h4>
            <div className="bg-gray-50 border border-gray-200 rounded-md p-3">
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="font-mono text-[13px] font-semibold text-gray-900 tracking-tight break-all">
                  {data.payment.reference}
                </div>
                <button
                  onClick={copyReference}
                  className="shrink-0 h-7 px-2.5 rounded border border-gray-300 text-[11px] font-medium text-gray-700 hover:bg-white hover:border-gray-400 transition-all duration-150 cursor-pointer flex items-center gap-1"
                >
                  {copiedRef ? '✓ Copied' : 'Copy reference'}
                </button>
              </div>
              <div className="grid grid-cols-3 gap-4 text-[11.5px]">
                <div>
                  <div className="text-gray-500 uppercase tracking-wide text-[10px] font-semibold">Beneficiary</div>
                  <div className="text-gray-900 font-medium mt-0.5">{data.payment.beneficiary}</div>
                </div>
                <div>
                  <div className="text-gray-500 uppercase tracking-wide text-[10px] font-semibold">IBAN</div>
                  <div className="text-gray-900 font-mono mt-0.5">{data.payment.iban}</div>
                </div>
                <div>
                  <div className="text-gray-500 uppercase tracking-wide text-[10px] font-semibold">BIC</div>
                  <div className="text-gray-900 font-mono mt-0.5">{data.payment.bic}</div>
                </div>
              </div>
            </div>
          </div>
        ) : data.payment_error ? (
          <div className="mb-4 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            Payment reference unavailable — {data.payment_error}. Add the matricule on the Entity page.
          </div>
        ) : null}

        {/* Warnings */}
        {data.ecdf.warnings.length > 0 && (
          <div className="mb-4 text-[11.5px] text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
            {data.ecdf.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
          </div>
        )}
        {data.ecdf.manual_boxes_pending.length > 0 && (
          <div className="mb-4 text-[11.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            Manual input required for box{data.ecdf.manual_boxes_pending.length === 1 ? '' : 'es'}{' '}
            {data.ecdf.manual_boxes_pending.join(', ')} (ordinary-regime pro-rata).
          </div>
        )}

        {/* Box list */}
        {expanded && (
          <div className="space-y-4 mt-4">
            {sections.map(section => (
              <div key={section}>
                <h4 className="text-[11px] uppercase tracking-wide font-semibold text-gray-500 mb-1.5">Section {section}</h4>
                <div className="border border-gray-200 rounded-md overflow-hidden">
                  <table className="w-full text-[12px]">
                    <tbody>
                      {boxesBySection[section].map((b, i) => (
                        <tr key={b.box} className={`border-b border-gray-100 last:border-0 ${i % 2 === 1 ? 'bg-gray-50/60' : ''}`}>
                          <td className="px-3 py-1.5 font-mono text-gray-500 w-14">{b.box}</td>
                          <td className="px-3 py-1.5 text-gray-700">
                            {b.label}
                            {b.manual && <span className="ml-2 text-[10px] text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 uppercase tracking-wide font-semibold">manual</span>}
                            {b.formula && <span className="ml-2 text-[10px] text-gray-400 font-mono">= {b.formula}</span>}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono tabular-nums text-gray-900 w-32">
                            {fmtEUR(b.value)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DownloadIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
  );
}

// ─── Email Drafter Modal ───
function EmailDrafterModal({ declarationId, onClose }: { declarationId: string; onClose: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ subject: string; body: string; model: string } | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [expertNotes, setExpertNotes] = useState('');
  const [copied, setCopied] = useState(false);

  async function generate() {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/agents/draft-email', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ declaration_id: declarationId, expert_notes: expertNotes || null }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      const d = await res.json();
      setDraft(d);
      setSubject(d.subject);
      setBody(d.body);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function copyAll() {
    const full = `Subject: ${subject}\n\n${body}`;
    navigator.clipboard.writeText(full).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  function openInMail() {
    const url = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = url;
  }

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 animate-fadeIn">
      <div className="bg-white rounded-lg w-full max-w-3xl shadow-2xl flex flex-col" style={{ maxHeight: '90vh' }}>
        <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h3 className="text-[14px] font-semibold text-gray-900">Draft client email</h3>
            <div className="text-[11px] text-gray-500 mt-0.5">Generated by Claude — review carefully before sending.</div>
          </div>
          <IconBtn title="Close (Esc)" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </IconBtn>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {!draft && !loading && (
            <div>
              <label className="block text-[11px] uppercase tracking-wide font-semibold text-gray-500 mb-1.5">
                Expert notes (optional)
              </label>
              <textarea
                value={expertNotes}
                onChange={e => setExpertNotes(e.target.value)}
                rows={4}
                placeholder="Specific legal observations, position changes, AED considerations… these will be quoted verbatim in the email."
                className="w-full border border-gray-300 rounded px-3 py-2 text-[12px] focus:border-[#1a1a2e] focus:outline-none focus:ring-1 focus:ring-[#1a1a2e]"
              />
              <button
                onClick={generate}
                className="mt-3 h-9 px-4 rounded bg-[#1a1a2e] text-white text-[12px] font-semibold hover:bg-[#2a2a4e] transition-all duration-150 cursor-pointer"
              >
                Generate draft
              </button>
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center py-10 text-[12px] text-gray-500 gap-2">
              <Spinner /> Drafting with Claude (Opus)…
            </div>
          )}

          {error && (
            <div className="text-[12px] text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
              {error}
            </div>
          )}

          {draft && (
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] uppercase tracking-wide font-semibold text-gray-500 mb-1.5">Subject</label>
                <input
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-[12px] font-medium focus:border-[#1a1a2e] focus:outline-none focus:ring-1 focus:ring-[#1a1a2e]"
                />
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-wide font-semibold text-gray-500 mb-1.5">Body</label>
                <textarea
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  rows={18}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-[12px] font-mono leading-relaxed focus:border-[#1a1a2e] focus:outline-none focus:ring-1 focus:ring-[#1a1a2e]"
                />
              </div>
              <div className="text-[10px] text-gray-400">Generated by {draft.model}</div>
            </div>
          )}
        </div>

        {draft && (
          <div className="px-5 py-3 border-t border-gray-200 bg-gray-50 flex items-center justify-end gap-2">
            <button
              onClick={generate}
              className="h-8 px-3 rounded border border-gray-300 text-[11px] font-medium text-gray-700 hover:bg-white hover:border-gray-400 transition-all duration-150 cursor-pointer"
            >
              Re-generate
            </button>
            <button
              onClick={copyAll}
              className="h-8 px-3 rounded border border-gray-300 text-[11px] font-medium text-gray-700 hover:bg-white hover:border-gray-400 transition-all duration-150 cursor-pointer"
            >
              {copied ? '✓ Copied' : 'Copy'}
            </button>
            <button
              onClick={openInMail}
              className="h-8 px-3 rounded bg-[#1a1a2e] text-white text-[11px] font-semibold hover:bg-[#2a2a4e] transition-all duration-150 cursor-pointer"
            >
              Open in mail client
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function KeyBox({ label, value, color, bold }: { label: string; value: string | number; color?: string; bold?: boolean }) {
  return (
    <div>
      <div className="text-[10px] text-gray-500 uppercase tracking-wide font-semibold">{label}</div>
      <div className={`tabular-nums mt-1 ${bold ? 'font-bold text-[16px]' : 'font-semibold text-[14px]'} ${color || 'text-gray-900'}`}>{value}</div>
    </div>
  );
}

function treatmentColorClass(code: TreatmentCode | null, source: string | null): string {
  // Inference-sourced classifications get an amber tint to signal "needs confirmation"
  if (source === 'inference') return 'bg-amber-100 text-amber-800 border border-amber-200';
  if (source === 'precedent') return 'bg-blue-100 text-blue-800 border border-blue-300';
  if (!code) return 'bg-gray-100 text-gray-600 border border-gray-200';
  if (code.startsWith('LUX_')) return 'bg-sky-100 text-sky-800 border border-sky-200';
  if (code.startsWith('RC_EU')) return 'bg-purple-100 text-purple-800 border border-purple-200';
  if (code.startsWith('RC_NONEU')) return 'bg-fuchsia-100 text-fuchsia-800 border border-fuchsia-200';
  if (code === 'IC_ACQ') return 'bg-indigo-100 text-indigo-800 border border-indigo-200';
  if (code === 'EXEMPT_44') return 'bg-emerald-100 text-emerald-800 border border-emerald-200';
  if (code === 'OUT_SCOPE') return 'bg-slate-100 text-slate-700 border border-slate-200';
  if (code.startsWith('OUT_')) return 'bg-teal-100 text-teal-800 border border-teal-200';
  return 'bg-gray-100 text-gray-700 border border-gray-200';
}
