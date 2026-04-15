'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { TREATMENT_CODES, INCOMING_TREATMENTS, OUTGOING_TREATMENTS, type TreatmentCode } from '@/config/treatment-codes';

// ────────────────────────── Types ──────────────────────────
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
}

interface Document {
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
  documents: Document[];
  lines: InvoiceLine[];
}

type PreviewTarget =
  | { kind: 'document'; documentId: string; rowKey: string; filename?: string }
  | { kind: 'manual'; rowKey: string; provider: string }
  | null;

// ────────────────────────── Page ──────────────────────────
export default function DeclarationDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [data, setData] = useState<DeclarationData | null>(null);
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [editingLine, setEditingLine] = useState<string | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<PreviewTarget>(null);
  const [previewWidth, setPreviewWidth] = useState(50); // percent
  const [isDraggingDivider, setIsDraggingDivider] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const loadData = useCallback(async () => {
    const res = await fetch(`/api/declarations/${id}`);
    if (res.ok) setData(await res.json());
  }, [id]);

  useEffect(() => { loadData(); }, [loadData]);

  // ───── Upload / Extract / Classify ─────
  async function handleUpload(files: FileList | File[]) {
    if (!files.length) return;
    setUploading(true);
    const formData = new FormData();
    formData.set('declaration_id', id);
    for (const file of Array.from(files)) formData.append('files', file);
    await fetch('/api/documents/upload', { method: 'POST', body: formData });
    setUploading(false);
    loadData();
  }
  async function handleRetryDocument(docId: string) {
    await fetch(`/api/documents/${docId}/retry`, { method: 'POST' });
    loadData();
  }
  async function handleIncludeAsInvoice(docId: string) {
    await fetch(`/api/documents/${docId}/retry`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force_triage_as: 'invoice' }),
    });
    await handleExtract();
  }
  async function handleExtract() {
    setExtracting(true);
    await fetch(`/api/declarations/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'extracting' }),
    });
    await fetch(`/api/agents/extract`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ declaration_id: id }),
    });
    setExtracting(false);
    loadData();
  }
  async function handleClassify() {
    await fetch(`/api/agents/classify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ declaration_id: id }),
    });
    loadData();
  }

  // ───── Line updates ─────
  async function handleLineUpdate(lineId: string, updates: Record<string, unknown>) {
    await fetch(`/api/invoice-lines/${lineId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    loadData();
  }
  async function handleMoveLine(lineId: string, target: 'incoming' | 'outgoing' | 'excluded') {
    await fetch(`/api/invoice-lines/${lineId}/move`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target }),
    });
    loadData();
  }
  async function handleStatusChange(newStatus: string) {
    await fetch(`/api/declarations/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
    loadData();
  }
  async function handleAddOutgoing() {
    await fetch('/api/invoices', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ declaration_id: id, direction: 'outgoing' }),
    });
    loadData();
  }

  // ───── Preview selection ─────
  function openPreviewForLine(line: InvoiceLine) {
    if (line.document_id) {
      setPreview({ kind: 'document', documentId: line.document_id, rowKey: line.id, filename: line.source_filename || undefined });
    } else {
      setPreview({ kind: 'manual', rowKey: line.id, provider: line.provider || 'Manual entry' });
    }
  }
  function openPreviewForDoc(doc: Document) {
    setPreview({ kind: 'document', documentId: doc.id, rowKey: `doc-${doc.id}`, filename: doc.filename });
  }

  // ───── Keyboard navigation (arrow up/down when preview is open) ─────
  const flatPreviewableRows = useMemo(() => {
    if (!data) return [] as { rowKey: string; line: InvoiceLine | null; doc: Document | null }[];
    const rows: { rowKey: string; line: InvoiceLine | null; doc: Document | null }[] = [];
    // Pending documents first
    for (const doc of data.documents.filter(d => d.status !== 'rejected')) {
      rows.push({ rowKey: `doc-${doc.id}`, line: null, doc });
    }
    // Active invoice lines (incoming, then outgoing)
    const active = data.lines.filter(l => l.state !== 'deleted');
    for (const line of active.filter(l => l.direction === 'incoming')) {
      rows.push({ rowKey: line.id, line, doc: null });
    }
    for (const line of active.filter(l => l.direction === 'outgoing')) {
      rows.push({ rowKey: line.id, line, doc: null });
    }
    // Excluded docs
    for (const doc of data.documents.filter(d => d.status === 'rejected')) {
      rows.push({ rowKey: `doc-${doc.id}`, line: null, doc });
    }
    return rows;
  }, [data]);

  useEffect(() => {
    if (!preview) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); setPreview(null); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      // Ignore when typing in an input
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      const idx = flatPreviewableRows.findIndex(r => r.rowKey === preview.rowKey);
      const next = e.key === 'ArrowDown' ? idx + 1 : idx - 1;
      if (next < 0 || next >= flatPreviewableRows.length) return;
      const n = flatPreviewableRows[next];
      if (n.line) openPreviewForLine(n.line);
      else if (n.doc) openPreviewForDoc(n.doc);
      // Scroll selected row into view
      requestAnimationFrame(() => {
        document.getElementById(`row-${n.rowKey}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [preview, flatPreviewableRows]);

  // ───── Resizable divider ─────
  useEffect(() => {
    if (!isDraggingDivider) return;
    const onMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const fromRight = rect.right - e.clientX;
      const pct = Math.min(70, Math.max(20, (fromRight / rect.width) * 100));
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

  // Summary calculations
  const totalExVat = incomingLines.reduce((s, l) => s + Number(l.amount_eur || 0), 0);
  const totalLuxVat = incomingLines
    .filter(l => l.treatment?.startsWith('LUX_'))
    .reduce((s, l) => s + Number(l.vat_applied || 0), 0);
  const totalRC = incomingLines
    .filter(l => l.treatment?.startsWith('RC_'))
    .reduce((s, l) => s + Number(l.rc_amount || 0), 0);
  const icAcqBase = incomingLines
    .filter(l => l.treatment === 'IC_ACQ')
    .reduce((s, l) => s + Number(l.amount_eur || 0), 0);
  const icAcqVat = icAcqBase * 0.17;
  const totalDue = totalRC + icAcqVat; // simplified entities have no deduction right
  const unclassified = activeLines.filter(l => !l.treatment).length;
  const flagged = activeLines.filter(l => Boolean(l.flag) && !Boolean(l.flag_acknowledged)).length;

  const locked = data.status === 'approved' || data.status === 'filed' || data.status === 'paid';
  const hasFx = Boolean(data.has_fx);
  const previewOpen = !!preview;

  return (
    <div
      ref={containerRef}
      className="flex w-full"
      style={{ minHeight: 'calc(100vh - 80px)' }}
    >
      {/* ─── Left: main content ─── */}
      <div
        className="flex flex-col min-w-0"
        style={{ width: previewOpen ? `${100 - previewWidth}%` : '100%' }}
      >
        <div className="pr-2">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">
                {data.entity_name} <span className="text-gray-400 font-normal">— {data.year} {data.period}</span>
              </h1>
              <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                <span>{data.regime}</span>
                <span>•</span>
                <span>{data.vat_number}</span>
                <StatusBadge status={data.status} />
              </div>
            </div>
            <div className="flex gap-2">
              {activeLines.length > 0 && !locked && (
                <button onClick={handleClassify}
                  className="border border-gray-300 text-gray-700 px-3 py-1.5 rounded text-xs font-medium hover:bg-gray-50">
                  Re-run rules
                </button>
              )}
              {data.status === 'review' && (
                <button
                  onClick={() => handleStatusChange('approved')}
                  disabled={unclassified > 0 || flagged > 0}
                  className="bg-green-600 text-white px-4 py-1.5 rounded text-xs font-semibold hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed"
                  title={unclassified > 0 || flagged > 0 ? `Cannot approve: ${unclassified} unclassified, ${flagged} unacknowledged flags` : 'Approve'}
                >
                  Approve
                </button>
              )}
              {data.status === 'approved' && (
                <button onClick={() => handleStatusChange('review')}
                  className="border border-orange-300 text-orange-600 px-3 py-1.5 rounded text-xs font-medium hover:bg-orange-50">
                  Reopen
                </button>
              )}
            </div>
          </div>

          {/* Reconciliation */}
          <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4">
            <div className="grid grid-cols-6 gap-4 text-center">
              <Stat label="Uploaded" value={data.documentStats.total} />
              <Stat label="Invoices" value={data.documentStats.invoices} color="text-blue-600" />
              <Stat label="Excluded" value={excludedDocs.length} color="text-gray-400" />
              <Stat label="Errors" value={data.documentStats.errors} color={data.documentStats.errors > 0 ? 'text-red-600' : 'text-gray-400'} />
              <Stat label="Lines" value={activeLines.length} />
              <Stat label="Total EUR" value={totalExVat.toLocaleString('en-LU', { minimumFractionDigits: 2 })} small />
            </div>
          </div>

          {/* Upload */}
          {['created', 'uploading', 'review'].includes(data.status) && (
            <div
              className={`border-2 border-dashed rounded-lg p-5 mb-4 text-center cursor-pointer transition ${
                dragOver ? 'border-[#1a1a2e] bg-blue-50' : 'border-gray-300 bg-white hover:border-gray-400'
              }`}
              onClick={() => fileInput.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); handleUpload(e.dataTransfer.files); }}
            >
              <input ref={fileInput} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.docx,.doc"
                className="hidden" onChange={e => e.target.files && handleUpload(e.target.files)} />
              {uploading ? (
                <span className="text-sm text-gray-500">Uploading...</span>
              ) : (
                <span className="text-sm text-gray-500">
                  Drop PDF/image/Word files here, or click to browse
                </span>
              )}
            </div>
          )}

          {/* Pending documents */}
          {pendingDocs.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-lg mb-4">
              <div className="px-4 py-2.5 border-b border-gray-200 flex items-center justify-between">
                <h3 className="text-sm font-semibold">Documents ({pendingDocs.length})</h3>
                {pendingDocs.some(d => d.status === 'uploaded' || d.status === 'error') && (
                  <button
                    onClick={handleExtract}
                    disabled={extracting}
                    className="bg-[#1a1a2e] text-white px-3 py-1.5 rounded text-xs font-semibold hover:bg-[#2a2a4e] disabled:opacity-40"
                  >
                    {extracting ? 'Extracting...' : pendingDocs.some(d => d.status === 'error') ? 'Retry all errors' : 'Extract all'}
                  </button>
                )}
              </div>
              <div className="max-h-72 overflow-y-auto">
                {pendingDocs.map(doc => (
                  <DocRow
                    key={doc.id}
                    doc={doc}
                    selected={preview?.rowKey === `doc-${doc.id}`}
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
            <EmptyBlock>No incoming invoices yet. Upload PDFs above and click Extract.</EmptyBlock>
          ) : (
            <ReviewTable
              lines={incomingLines}
              direction="incoming"
              hasFx={hasFx}
              compact={previewOpen}
              editingLine={editingLine}
              setEditingLine={setEditingLine}
              onUpdate={handleLineUpdate}
              onMove={handleMoveLine}
              onOpenPreview={openPreviewForLine}
              selectedRowKey={preview?.rowKey}
              isLocked={locked}
            />
          )}

          {/* Services Rendered */}
          <div className="flex items-center justify-between mt-6 mb-2">
            <SectionHeader title="Services Rendered — Overall Turnover" count={outgoingLines.length} inline />
            {!locked && (
              <button onClick={handleAddOutgoing}
                className="text-xs font-medium text-[#1a1a2e] hover:underline">
                + Add outgoing invoice
              </button>
            )}
          </div>
          {outgoingLines.length === 0 ? (
            <EmptyBlock>
              No outgoing invoices. Click &quot;Add outgoing invoice&quot; to manually enter one (e.g. management fees, consulting invoices issued by this entity).
            </EmptyBlock>
          ) : (
            <ReviewTable
              lines={outgoingLines}
              direction="outgoing"
              hasFx={hasFx}
              compact={previewOpen}
              editingLine={editingLine}
              setEditingLine={setEditingLine}
              onUpdate={handleLineUpdate}
              onMove={handleMoveLine}
              onOpenPreview={openPreviewForLine}
              selectedRowKey={preview?.rowKey}
              isLocked={locked}
            />
          )}

          {/* Excluded Documents */}
          <div className="mt-6 mb-2">
            <SectionHeader title="Excluded Documents — Review Required" count={excludedDocs.length + deletedLines.length} />
          </div>
          {excludedDocs.length === 0 && deletedLines.length === 0 ? (
            <EmptyBlock>No excluded items.</EmptyBlock>
          ) : (
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Source</th>
                    <th className="px-3 py-2 text-left font-medium">Reason</th>
                    <th className="px-3 py-2 text-right font-medium">Amount</th>
                    <th className="px-3 py-2 text-left font-medium w-32">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {excludedDocs.map(doc => (
                    <tr
                      key={doc.id}
                      id={`row-doc-${doc.id}`}
                      onClick={() => openPreviewForDoc(doc)}
                      className={`border-t border-gray-100 cursor-pointer hover:bg-gray-50 ${preview?.rowKey === `doc-${doc.id}` ? 'bg-blue-50' : ''}`}
                    >
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <FileIcon type={doc.file_type} />
                          <span className="truncate max-w-xs">{doc.filename}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <TriageTag triage={doc.triage_result} />
                      </td>
                      <td className="px-3 py-2 text-right text-gray-400">—</td>
                      <td className="px-3 py-2">
                        {!locked && (
                          <button
                            onClick={e => { e.stopPropagation(); handleIncludeAsInvoice(doc.id); }}
                            className="text-xs font-medium text-blue-600 hover:underline"
                          >
                            Include as invoice
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {deletedLines.map(line => (
                    <tr
                      key={line.id}
                      id={`row-${line.id}`}
                      onClick={() => openPreviewForLine(line)}
                      className={`border-t border-gray-100 cursor-pointer hover:bg-gray-50 ${preview?.rowKey === line.id ? 'bg-blue-50' : ''}`}
                    >
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          {line.document_id ? <FileIcon type="pdf" /> : <span className="text-gray-300">✎</span>}
                          <span className="truncate max-w-xs">{line.provider || line.source_filename || 'Deleted line'}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-500">
                        {(line as unknown as { deleted_reason?: string }).deleted_reason || 'deleted'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-gray-500">{fmtEUR(line.amount_eur)}</td>
                      <td className="px-3 py-2">
                        {!locked && (
                          <MoveDropdown
                            currentSection="excluded"
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

          {/* Show deleted toggle */}
          {deletedLines.length > 0 && (
            <button onClick={() => setShowDeleted(!showDeleted)}
              className="text-xs text-gray-400 hover:text-gray-600 mt-2">
              {showDeleted ? 'Hide' : 'Show'} full deleted-line history
            </button>
          )}

          {/* Summary */}
          {activeLines.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-lg p-4 mt-6 mb-6">
              <h3 className="text-sm font-semibold mb-3">Summary</h3>
              <div className="grid grid-cols-5 gap-4 text-sm">
                <SummaryStat label="Lux VAT" value={`EUR ${fmtEUR(totalLuxVat)}`} />
                <SummaryStat label="Reverse Charge VAT" value={`EUR ${fmtEUR(totalRC)}`} />
                <SummaryStat label="IC Acq. VAT" value={`EUR ${fmtEUR(icAcqVat)}`} />
                <SummaryStat label="Total Due (simpl.)" value={`EUR ${fmtEUR(totalDue)}`} bold />
                <SummaryStat label="Blockers" value={`${unclassified} uncls · ${flagged} flagged`} color={unclassified > 0 || flagged > 0 ? 'text-red-600' : 'text-green-600'} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ─── Divider ─── */}
      {previewOpen && (
        <div
          onMouseDown={() => setIsDraggingDivider(true)}
          className="w-1.5 bg-gray-100 hover:bg-[#1a1a2e] cursor-col-resize transition-colors"
          title="Drag to resize"
        />
      )}

      {/* ─── Right: preview ─── */}
      {previewOpen && (
        <div style={{ width: `${previewWidth}%` }} className="min-w-[320px]">
          <PreviewPanel
            preview={preview}
            onClose={() => setPreview(null)}
          />
        </div>
      )}
    </div>
  );
}

// ────────────────────────── Preview Panel ──────────────────────────
function PreviewPanel({ preview, onClose }: { preview: PreviewTarget; onClose: () => void }) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [filename, setFilename] = useState<string>('');
  const [fileType, setFileType] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imgZoom, setImgZoom] = useState(1);

  useEffect(() => {
    if (!preview) return;
    setImgZoom(1);
    if (preview.kind !== 'document') { setSignedUrl(null); return; }
    setLoading(true); setError(null); setSignedUrl(null);
    fetch(`/api/documents/${preview.documentId}/url`)
      .then(async r => { if (!r.ok) throw new Error((await r.json()).error || 'Failed'); return r.json(); })
      .then(d => { setSignedUrl(d.url); setFilename(d.filename); setFileType(d.file_type); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [preview]);

  if (!preview) return null;

  return (
    <div className="sticky top-2 flex flex-col border border-gray-200 rounded-lg overflow-hidden bg-white" style={{ height: 'calc(100vh - 80px)' }}>
      {/* Toolbar */}
      <div className="px-3 py-2 border-b border-gray-200 flex items-center justify-between bg-gray-50">
        <div className="flex items-center gap-2 min-w-0">
          <FileIcon type={fileType || 'pdf'} />
          <span className="text-xs font-medium truncate">
            {preview.kind === 'manual' ? 'No source document' : (filename || 'Loading...')}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {fileType === 'image' && signedUrl && (
            <>
              <IconButton title="Zoom out" onClick={() => setImgZoom(z => Math.max(0.2, z - 0.2))}>−</IconButton>
              <span className="text-xs text-gray-500 w-10 text-center">{Math.round(imgZoom * 100)}%</span>
              <IconButton title="Zoom in" onClick={() => setImgZoom(z => Math.min(4, z + 0.2))}>+</IconButton>
              <IconButton title="Fit width" onClick={() => setImgZoom(1)}>Fit</IconButton>
            </>
          )}
          {signedUrl && preview.kind === 'document' && (
            <IconButton title="Open in new tab" onClick={() => window.open(signedUrl, '_blank', 'noopener')}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 7h10v10" /><path d="M7 17L17 7" /></svg>
            </IconButton>
          )}
          <IconButton title="Close (Esc)" onClick={onClose}>×</IconButton>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto bg-gray-100">
        {preview.kind === 'manual' ? (
          <div className="flex items-center justify-center h-full text-sm text-gray-500 p-8 text-center bg-gray-50">
            <div>
              <div className="text-3xl mb-3 opacity-20">✎</div>
              <div className="font-medium text-gray-600 mb-1">No source document</div>
              <div className="text-xs text-gray-400 max-w-xs">This invoice was entered manually — it is an outgoing invoice issued by the entity.</div>
            </div>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center h-full text-xs text-gray-500">Loading preview...</div>
        ) : error ? (
          <div className="p-4 text-xs text-red-600">Error: {error}</div>
        ) : signedUrl ? (
          fileType === 'image' ? (
            <div className="flex items-start justify-center p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={signedUrl} alt={filename}
                style={{ transform: `scale(${imgZoom})`, transformOrigin: 'top center' }}
                className="max-w-full bg-white shadow-sm" />
            </div>
          ) : fileType === 'pdf' ? (
            <iframe src={signedUrl} className="w-full h-full bg-white" title={filename} />
          ) : (
            <div className="p-4 text-xs text-gray-600">
              Word document. <a href={signedUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Download to preview</a>.
            </div>
          )
        ) : null}
      </div>

      {/* Footer hint */}
      <div className="px-3 py-1.5 border-t border-gray-200 text-[10px] text-gray-400 flex items-center justify-between bg-gray-50">
        <span>↑/↓ to navigate · Esc to close</span>
        {preview.kind === 'document' && signedUrl && (
          <a href={signedUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Open full size ↗</a>
        )}
      </div>
    </div>
  );
}

// ────────────────────────── Review Table ──────────────────────────
function ReviewTable({
  lines, direction, hasFx, compact, editingLine, setEditingLine, onUpdate, onMove, onOpenPreview, selectedRowKey, isLocked,
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
  isLocked: boolean;
}) {
  const treatments = direction === 'incoming' ? INCOMING_TREATMENTS : OUTGOING_TREATMENTS;

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-[11.5px] border-collapse">
          <thead>
            <tr className="bg-gray-50 text-gray-600 border-b border-gray-200">
              <th className="px-1 py-2 w-8"></th>
              <th className="px-2 py-2 text-left font-medium">Provider</th>
              {!compact && <th className="px-2 py-2 text-left font-medium">Country</th>}
              <th className="px-2 py-2 text-left font-medium">Description</th>
              {!compact && <th className="px-2 py-2 text-left font-medium whitespace-nowrap">Date</th>}
              {!compact && <th className="px-2 py-2 text-left font-medium">Inv. #</th>}
              <th className="px-2 py-2 text-right font-medium whitespace-nowrap">Amount</th>
              <th className="px-2 py-2 text-right font-medium">Rate</th>
              {!compact && <th className="px-2 py-2 text-right font-medium whitespace-nowrap">VAT</th>}
              {!compact && <th className="px-2 py-2 text-right font-medium whitespace-nowrap">RC</th>}
              {!compact && <th className="px-2 py-2 text-right font-medium whitespace-nowrap">Total</th>}
              {hasFx && !compact && (
                <>
                  <th className="px-2 py-2 text-right font-medium">Ccy</th>
                  <th className="px-2 py-2 text-right font-medium">FX Amt</th>
                  <th className="px-2 py-2 text-right font-medium">ECB</th>
                </>
              )}
              <th className="px-2 py-2 text-left font-medium">Treatment</th>
              {!compact && <th className="px-2 py-2 text-center font-medium">Flag</th>}
              {!isLocked && <th className="px-2 py-2 w-10"></th>}
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

// ────────────────────────── Table Row ──────────────────────────
function TableRow({
  line, treatments, hasFx, compact, isEditing, onEditToggle, onUpdate, onMove, onOpenPreview, isSelected, isLocked, direction,
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
  isLocked: boolean;
  direction: 'incoming' | 'outgoing';
}) {
  const rowClassName = [
    'border-b border-gray-100 group',
    getRowAccent(line),
    isSelected ? 'bg-blue-50' : '',
    !isLocked ? 'hover:bg-gray-50' : '',
  ].filter(Boolean).join(' ');

  const editableCellProps = (editing: boolean) => ({
    onClick: (e: React.MouseEvent) => {
      if (!editing && !isLocked) { e.stopPropagation(); onEditToggle(); }
    },
    className: 'px-2 py-1.5 cursor-pointer',
  });

  const flagAck = Boolean(line.flag_acknowledged);
  const isFlagged = Boolean(line.flag);

  return (
    <tr id={`row-${line.id}`} className={rowClassName}>
      {/* Preview icon */}
      <td className="px-1 py-1.5 text-center">
        <button
          onClick={e => { e.stopPropagation(); onOpenPreview(line); }}
          className="text-gray-300 hover:text-[#1a1a2e] transition-colors"
          title={line.document_id ? `Preview: ${line.source_filename}` : 'No source document (manual entry)'}
        >
          {line.document_id ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          )}
        </button>
      </td>

      {/* Provider */}
      <td {...editableCellProps(isEditing)}>
        {isEditing && !isLocked ? (
          <input className="w-full border border-gray-300 rounded px-1.5 py-0.5 text-xs" defaultValue={line.provider}
            onClick={e => e.stopPropagation()}
            onBlur={e => onUpdate(line.id, { provider: e.target.value })} />
        ) : (
          <span className="font-medium text-gray-900">{line.provider || '—'}</span>
        )}
      </td>

      {/* Country */}
      {!compact && (
        <td {...editableCellProps(isEditing)}>
          {isEditing && !isLocked ? (
            <input className="w-14 border border-gray-300 rounded px-1.5 py-0.5 text-xs" defaultValue={line.country}
              onClick={e => e.stopPropagation()}
              onBlur={e => onUpdate(line.id, { country: e.target.value })} />
          ) : <span className="text-gray-600">{line.country || '—'}</span>}
        </td>
      )}

      {/* Description */}
      <td {...editableCellProps(isEditing)} title={line.description}>
        {isEditing && !isLocked ? (
          <input className="w-full border border-gray-300 rounded px-1.5 py-0.5 text-xs" defaultValue={line.description}
            onClick={e => e.stopPropagation()}
            onBlur={e => onUpdate(line.id, { description: e.target.value })} />
        ) : (
          <span className="text-gray-700 block truncate max-w-[180px]">{line.description || '—'}</span>
        )}
      </td>

      {/* Date */}
      {!compact && (
        <td {...editableCellProps(isEditing)}>
          {isEditing && !isLocked ? (
            <input type="date" className="border border-gray-300 rounded px-1 py-0.5 text-xs" defaultValue={line.invoice_date}
              onClick={e => e.stopPropagation()}
              onBlur={e => onUpdate(line.id, { invoice_date: e.target.value })} />
          ) : <span className="text-gray-600 whitespace-nowrap">{formatDate(line.invoice_date)}</span>}
        </td>
      )}

      {/* Invoice # */}
      {!compact && (
        <td {...editableCellProps(isEditing)}>
          {isEditing && !isLocked ? (
            <input className="w-20 border border-gray-300 rounded px-1.5 py-0.5 text-xs" defaultValue={line.invoice_number}
              onClick={e => e.stopPropagation()}
              onBlur={e => onUpdate(line.id, { invoice_number: e.target.value })} />
          ) : <span className="text-gray-600">{line.invoice_number || '—'}</span>}
        </td>
      )}

      {/* Amount */}
      <td {...editableCellProps(isEditing)} className="px-2 py-1.5 text-right font-mono cursor-pointer">
        {isEditing && !isLocked ? (
          <input className="w-24 border border-gray-300 rounded px-1.5 py-0.5 text-xs text-right" type="number" step="0.01"
            defaultValue={line.amount_eur} onClick={e => e.stopPropagation()}
            onBlur={e => onUpdate(line.id, { amount_eur: parseFloat(e.target.value) })} />
        ) : <span className="text-gray-900">{fmtEUR(line.amount_eur)}</span>}
      </td>

      {/* Rate */}
      <td className="px-2 py-1.5 text-right">
        <span className="text-gray-500">
          {line.vat_rate != null ? `${(Number(line.vat_rate) * 100).toFixed(0)}%` : '—'}
        </span>
      </td>

      {/* VAT, RC, Total (hidden in compact) */}
      {!compact && <td className="px-2 py-1.5 text-right font-mono text-gray-700">{fmtEUR(line.vat_applied)}</td>}
      {!compact && <td className="px-2 py-1.5 text-right font-mono text-gray-700">{fmtEUR(line.rc_amount)}</td>}
      {!compact && <td className="px-2 py-1.5 text-right font-mono text-gray-500">{fmtEUR(line.amount_incl)}</td>}

      {/* FX */}
      {hasFx && !compact && (
        <>
          <td className="px-2 py-1.5 text-right text-gray-500">{line.currency || '—'}</td>
          <td className="px-2 py-1.5 text-right font-mono text-gray-500">{line.currency_amount ? fmtEUR(line.currency_amount) : '—'}</td>
          <td className="px-2 py-1.5 text-right text-gray-500">{line.ecb_rate || '—'}</td>
        </>
      )}

      {/* Treatment */}
      <td {...editableCellProps(isEditing)} className="px-2 py-1.5">
        {isEditing && !isLocked ? (
          <select className="border border-gray-300 rounded px-1.5 py-0.5 text-xs" value={line.treatment || ''}
            onClick={e => e.stopPropagation()}
            onChange={e => onUpdate(line.id, { treatment: e.target.value || null, treatment_source: 'manual' })}>
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
          />
        )}
      </td>

      {/* Flag */}
      {!compact && (
        <td className="px-2 py-1.5 text-center">
          {isFlagged ? (
            <button
              className={flagAck ? 'text-gray-300' : 'text-amber-600 hover:text-amber-700'}
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

      {/* Actions dropdown */}
      {!isLocked && (
        <td className="px-2 py-1.5 text-center">
          <MoveDropdown
            currentSection={direction === 'incoming' ? 'incoming' : 'outgoing'}
            onMove={t => onMove(line.id, t)}
          />
        </td>
      )}
    </tr>
  );
}

// ────────────────────────── Move Dropdown ──────────────────────────
function MoveDropdown({
  currentSection,
  onMove,
}: {
  currentSection: 'incoming' | 'outgoing' | 'excluded';
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
        className="text-gray-300 hover:text-[#1a1a2e] transition-colors px-1"
        title="Move to another section"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="5" r="1.5" />
          <circle cx="12" cy="12" r="1.5" />
          <circle cx="12" cy="19" r="1.5" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded-md shadow-lg min-w-[200px] py-1">
          {targets.map(t => (
            <button
              key={t.key}
              onClick={e => { e.stopPropagation(); setOpen(false); onMove(t.key); }}
              className={`block w-full text-left px-3 py-1.5 text-xs ${t.danger ? 'text-red-600 hover:bg-red-50' : 'text-gray-700 hover:bg-gray-50'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ────────────────────────── Treatment Badge ──────────────────────────
function TreatmentBadge({ treatment, source, rule }: { treatment: string | null; source: string | null; rule: string | null }) {
  if (!treatment) {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-700 border border-red-200">UNCLASSIFIED</span>;
  }
  const code = treatment as TreatmentCode;
  const spec = TREATMENT_CODES[code];
  const colors = treatmentColorClass(code);
  const tooltip = rule && rule !== 'NO_MATCH'
    ? `Classified by ${rule} • ${spec?.label || treatment}${source ? ` • source: ${source}` : ''}`
    : (spec?.label || treatment) + (source ? ` • source: ${source}` : '');
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold ${colors}`}
      title={tooltip}
    >
      {treatment}
    </span>
  );
}

// ────────────────────────── Doc row ──────────────────────────
function DocRow({
  doc, selected, onSelect, onRetry,
}: {
  doc: Document;
  selected: boolean;
  onSelect: () => void;
  onRetry: () => void;
}) {
  return (
    <div
      id={`row-doc-${doc.id}`}
      onClick={onSelect}
      className={`px-4 py-2 border-b border-gray-100 last:border-0 text-xs cursor-pointer transition-colors ${selected ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
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
        <div
          onClick={e => e.stopPropagation()}
          className="mt-1 ml-6 text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1 break-words flex items-start justify-between gap-2"
        >
          <div className="flex-1">
            <span className="font-semibold">Error:</span> {doc.error_message}
          </div>
          <button onClick={onRetry} className="text-blue-600 hover:underline shrink-0 font-semibold">Retry</button>
        </div>
      )}
    </div>
  );
}

// ────────────────────────── Small components ──────────────────────────
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
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded font-semibold uppercase tracking-wide ${colors[status] || 'bg-gray-100'}`}>
      {status}
    </span>
  );
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
    <span className="text-gray-400 shrink-0 text-base leading-none">
      {type === 'pdf' ? '📄' : type === 'image' ? '🖼' : '📝'}
    </span>
  );
}
function IconButton({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title: string }) {
  return (
    <button onClick={onClick} title={title}
      className="w-7 h-7 flex items-center justify-center rounded text-gray-600 hover:bg-gray-200 text-sm transition-colors">
      {children}
    </button>
  );
}
function Stat({ label, value, color, small }: { label: string; value: string | number; color?: string; small?: boolean }) {
  return (
    <div>
      <div className="text-[10px] text-gray-500 uppercase tracking-wide font-semibold">{label}</div>
      <div className={`font-semibold mt-0.5 ${color || 'text-gray-900'} ${small ? 'text-sm' : 'text-lg'}`}>{value}</div>
    </div>
  );
}
function SummaryStat({ label, value, color, bold }: { label: string; value: string; color?: string; bold?: boolean }) {
  return (
    <div>
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className={`${bold ? 'font-bold text-base' : 'font-semibold text-sm'} ${color || 'text-gray-900'}`}>{value}</div>
    </div>
  );
}
function SectionHeader({ title, count, inline }: { title: string; count: number; inline?: boolean }) {
  return (
    <h3 className={`text-sm font-semibold text-gray-900 ${inline ? '' : 'mb-2'}`}>
      {title} <span className="text-gray-400 font-normal ml-1">({count})</span>
    </h3>
  );
}
function EmptyBlock({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6 text-center text-sm text-gray-400">
      {children}
    </div>
  );
}

// ────────────────────────── Helpers ──────────────────────────
function getRowAccent(line: InvoiceLine): string {
  if (line.state === 'deleted') return 'bg-gray-50 line-through text-gray-400';
  if (!line.treatment) return 'bg-red-50/40';
  if (Boolean(line.flag) && !Boolean(line.flag_acknowledged)) return 'bg-amber-50/60';
  return '';
}
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
function treatmentColorClass(code: TreatmentCode | null): string {
  if (!code) return 'bg-gray-100 text-gray-600 border border-gray-200';
  if (code.startsWith('LUX_')) return 'bg-blue-100 text-blue-800 border border-blue-200';
  if (code.startsWith('RC_EU')) return 'bg-purple-100 text-purple-800 border border-purple-200';
  if (code.startsWith('RC_NONEU')) return 'bg-fuchsia-100 text-fuchsia-800 border border-fuchsia-200';
  if (code === 'IC_ACQ') return 'bg-indigo-100 text-indigo-800 border border-indigo-200';
  if (code === 'EXEMPT_44') return 'bg-emerald-100 text-emerald-800 border border-emerald-200';
  if (code === 'OUT_SCOPE') return 'bg-slate-100 text-slate-700 border border-slate-200';
  if (code.startsWith('OUT_')) return 'bg-teal-100 text-teal-800 border border-teal-200';
  return 'bg-gray-100 text-gray-700 border border-gray-200';
}
