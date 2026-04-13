'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import { TREATMENT_CODES, INCOMING_TREATMENTS, OUTGOING_TREATMENTS } from '@/config/treatment-codes';

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
  flag: number;
  flag_reason: string | null;
  flag_acknowledged: number;
  reviewed: number;
  note: string | null;
  state: string;
  sort_order: number;
  // Joined from invoice
  provider: string;
  provider_vat: string;
  country: string;
  invoice_date: string;
  invoice_number: string;
  direction: string;
  currency: string | null;
  currency_amount: number | null;
  ecb_rate: number | null;
  source_filename: string;
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
  has_fx: number;
  has_outgoing: number;
  vat_number: string;
  matricule: string;
  documentStats: {
    total: number;
    uploaded: number;
    invoices: number;
    non_invoices: number;
    extracted: number;
    errors: number;
  };
  documents: Document[];
  lines: InvoiceLine[];
}

export default function DeclarationDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [data, setData] = useState<DeclarationData | null>(null);
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [editingLine, setEditingLine] = useState<string | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const loadData = useCallback(async () => {
    const res = await fetch(`/api/declarations/${id}`);
    if (res.ok) setData(await res.json());
  }, [id]);

  useEffect(() => { loadData(); }, [loadData]);

  async function handleUpload(files: FileList | File[]) {
    if (!files.length) return;
    setUploading(true);
    const formData = new FormData();
    formData.set('declaration_id', id);
    for (const file of Array.from(files)) {
      formData.append('files', file);
    }
    await fetch('/api/documents/upload', { method: 'POST', body: formData });
    setUploading(false);
    loadData();
  }

  async function handleExtract() {
    setExtracting(true);
    // Update status to extracting
    await fetch(`/api/declarations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'extracting' }),
    });
    // Trigger triage + extraction
    await fetch(`/api/agents/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ declaration_id: id }),
    });
    setExtracting(false);
    loadData();
  }

  async function handleLineUpdate(lineId: string, updates: Record<string, unknown>) {
    await fetch(`/api/invoice-lines/${lineId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    loadData();
  }

  async function handleDeleteLine(lineId: string) {
    const reason = prompt('Reason for deletion:\n- not_invoice\n- duplicate\n- wrong_entity\n- wrong_period\n- other');
    if (!reason) return;
    await fetch(`/api/invoice-lines/${lineId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    loadData();
  }

  async function handleStatusChange(newStatus: string) {
    await fetch(`/api/declarations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
    loadData();
  }

  if (!data) return <div className="text-center py-12 text-gray-500">Loading...</div>;

  const activeLines = data.lines.filter(l => l.state !== 'deleted');
  const deletedLines = data.lines.filter(l => l.state === 'deleted');
  const incomingLines = activeLines.filter(l => l.direction === 'incoming');
  const outgoingLines = activeLines.filter(l => l.direction === 'outgoing');

  // Summary calculations
  const totalExVat = incomingLines.reduce((s, l) => s + (l.amount_eur || 0), 0);
  const totalLuxVat = incomingLines.filter(l => l.treatment?.startsWith('LUX_')).reduce((s, l) => s + (l.vat_applied || 0), 0);
  const totalRC = incomingLines.filter(l => l.treatment?.startsWith('RC_')).reduce((s, l) => s + (l.rc_amount || 0), 0);
  const unclassified = activeLines.filter(l => !l.treatment).length;
  const flagged = activeLines.filter(l => l.flag && !l.flag_acknowledged).length;

  return (
    <div>
      {/* Top bar */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold">
            {data.entity_name} — {data.year} {data.period}
          </h1>
          <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
            <span>{data.regime}</span>
            <span>{data.vat_number}</span>
            <StatusBadge status={data.status} />
          </div>
        </div>
        <div className="flex gap-2">
          {data.status === 'review' && (
            <button
              onClick={() => handleStatusChange('approved')}
              disabled={unclassified > 0 || flagged > 0}
              className="bg-green-600 text-white px-4 py-2 rounded text-sm font-semibold hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed"
              title={unclassified > 0 || flagged > 0 ? `Cannot approve: ${unclassified} unclassified, ${flagged} unacknowledged flags` : 'Approve declaration'}
            >
              Approve
            </button>
          )}
          {data.status === 'approved' && (
            <button onClick={() => handleStatusChange('review')}
              className="border border-orange-300 text-orange-600 px-4 py-2 rounded text-sm font-semibold hover:bg-orange-50">
              Reopen
            </button>
          )}
        </div>
      </div>

      {/* Reconciliation panel (PRD 4.10) */}
      <div className="bg-white border rounded-lg p-4 mb-4">
        <div className="grid grid-cols-6 gap-4 text-center">
          <div>
            <div className="text-xs text-gray-500 uppercase font-semibold">Uploaded</div>
            <div className="text-lg font-bold">{data.documentStats.total}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase font-semibold">Invoices</div>
            <div className="text-lg font-bold text-blue-600">{data.documentStats.invoices}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase font-semibold">Non-invoices</div>
            <div className="text-lg font-bold text-gray-400">{data.documentStats.non_invoices}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase font-semibold">Errors</div>
            <div className={`text-lg font-bold ${data.documentStats.errors > 0 ? 'text-red-600' : 'text-gray-400'}`}>
              {data.documentStats.errors}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase font-semibold">Lines</div>
            <div className="text-lg font-bold">{activeLines.length}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase font-semibold">Total EUR</div>
            <div className="text-lg font-bold">{totalExVat.toLocaleString('en-LU', {minimumFractionDigits: 2})}</div>
          </div>
        </div>
      </div>

      {/* File upload area */}
      {['created', 'uploading', 'review'].includes(data.status) && (
        <div
          className={`border-2 border-dashed rounded-lg p-6 mb-4 text-center cursor-pointer transition ${
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

      {/* Documents list */}
      {data.documents.length > 0 && (
        <div className="bg-white border rounded-lg mb-4">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <h3 className="text-sm font-semibold">Documents ({data.documents.length})</h3>
            {data.documents.some(d => d.status === 'uploaded') && (
              <button
                onClick={handleExtract}
                disabled={extracting}
                className="bg-purple-600 text-white px-3 py-1.5 rounded text-xs font-semibold hover:bg-purple-700 disabled:opacity-40"
              >
                {extracting ? 'Extracting...' : 'Extract All'}
              </button>
            )}
          </div>
          <div className="max-h-48 overflow-y-auto">
            {data.documents.map(doc => (
              <div key={doc.id} className="px-4 py-2 border-b last:border-0 flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-gray-400">
                    {doc.file_type === 'pdf' ? '📄' : doc.file_type === 'image' ? '🖼️' : '📝'}
                  </span>
                  <span>{doc.filename}</span>
                  <span className="text-xs text-gray-400">({(doc.file_size / 1024).toFixed(0)} KB)</span>
                </div>
                <div className="flex items-center gap-2">
                  {doc.triage_result && (
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                      doc.triage_result === 'invoice' ? 'bg-blue-100 text-blue-700' :
                      doc.triage_result === 'credit_note' ? 'bg-purple-100 text-purple-700' :
                      'bg-gray-100 text-gray-600'
                    }`}>{doc.triage_result}</span>
                  )}
                  <DocStatus status={doc.status} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Review Table - Services Received (incoming) */}
      {incomingLines.length > 0 && (
        <div className="mb-4">
          <h3 className="text-sm font-semibold mb-2">Services Received ({incomingLines.length})</h3>
          <ReviewTable
            lines={incomingLines}
            direction="incoming"
            hasFx={!!data.has_fx}
            editingLine={editingLine}
            setEditingLine={setEditingLine}
            onUpdate={handleLineUpdate}
            onDelete={handleDeleteLine}
            isLocked={data.status === 'approved' || data.status === 'filed' || data.status === 'paid'}
          />
        </div>
      )}

      {/* Review Table - Overall Turnover (outgoing) */}
      {outgoingLines.length > 0 && (
        <div className="mb-4">
          <h3 className="text-sm font-semibold mb-2">Overall Turnover ({outgoingLines.length})</h3>
          <ReviewTable
            lines={outgoingLines}
            direction="outgoing"
            hasFx={!!data.has_fx}
            editingLine={editingLine}
            setEditingLine={setEditingLine}
            onUpdate={handleLineUpdate}
            onDelete={handleDeleteLine}
            isLocked={data.status === 'approved' || data.status === 'filed' || data.status === 'paid'}
          />
        </div>
      )}

      {/* Deleted lines toggle */}
      {deletedLines.length > 0 && (
        <div className="mb-4">
          <button onClick={() => setShowDeleted(!showDeleted)}
            className="text-sm text-gray-500 hover:underline">
            {showDeleted ? 'Hide' : 'Show'} deleted lines ({deletedLines.length})
          </button>
          {showDeleted && (
            <div className="mt-2 opacity-60">
              <ReviewTable
                lines={deletedLines}
                direction="incoming"
                hasFx={!!data.has_fx}
                editingLine={null}
                setEditingLine={() => {}}
                onUpdate={() => {}}
                onDelete={() => {}}
                isLocked={true}
              />
            </div>
          )}
        </div>
      )}

      {/* Summary panel */}
      {activeLines.length > 0 && (
        <div className="bg-white border rounded-lg p-4">
          <h3 className="text-sm font-semibold mb-3">Summary</h3>
          <div className="grid grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-gray-500">Lux VAT</span>
              <div className="font-bold">EUR {totalLuxVat.toLocaleString('en-LU', {minimumFractionDigits: 2})}</div>
            </div>
            <div>
              <span className="text-gray-500">Reverse Charge VAT</span>
              <div className="font-bold">EUR {totalRC.toLocaleString('en-LU', {minimumFractionDigits: 2})}</div>
            </div>
            <div>
              <span className="text-gray-500">Unclassified</span>
              <div className={`font-bold ${unclassified > 0 ? 'text-red-600' : 'text-green-600'}`}>{unclassified}</div>
            </div>
            <div>
              <span className="text-gray-500">Flagged</span>
              <div className={`font-bold ${flagged > 0 ? 'text-amber-600' : 'text-green-600'}`}>{flagged}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Review Table Component
function ReviewTable({
  lines, direction, hasFx, editingLine, setEditingLine, onUpdate, onDelete, isLocked,
}: {
  lines: InvoiceLine[];
  direction: string;
  hasFx: boolean;
  editingLine: string | null;
  setEditingLine: (id: string | null) => void;
  onUpdate: (id: string, updates: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
  isLocked: boolean;
}) {
  const treatments = direction === 'incoming' ? INCOMING_TREATMENTS : OUTGOING_TREATMENTS;

  return (
    <div className="bg-white border rounded-lg overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-[#1a1a2e] text-white">
          <tr>
            <th className="px-2 py-2 text-left whitespace-nowrap">Provider</th>
            <th className="px-2 py-2 text-left">Country</th>
            <th className="px-2 py-2 text-left">Description</th>
            <th className="px-2 py-2 text-left whitespace-nowrap">Inv. Date</th>
            <th className="px-2 py-2 text-left">Inv. #</th>
            <th className="px-2 py-2 text-right whitespace-nowrap">EUR ex. VAT</th>
            <th className="px-2 py-2 text-right">Rate</th>
            <th className="px-2 py-2 text-right whitespace-nowrap">VAT Applied</th>
            <th className="px-2 py-2 text-right whitespace-nowrap">RC Amount</th>
            <th className="px-2 py-2 text-right whitespace-nowrap">EUR incl.</th>
            {hasFx && <>
              <th className="px-2 py-2 text-right">Currency</th>
              <th className="px-2 py-2 text-right whitespace-nowrap">FX Amt</th>
              <th className="px-2 py-2 text-right">ECB Rate</th>
            </>}
            <th className="px-2 py-2 text-left">Treatment</th>
            <th className="px-2 py-2 text-left">Source</th>
            <th className="px-2 py-2 text-right">Conf.</th>
            <th className="px-2 py-2 text-center">Flags</th>
            {!isLocked && <th className="px-2 py-2"></th>}
          </tr>
        </thead>
        <tbody>
          {lines.map(line => {
            const isEditing = editingLine === line.id;
            const rowColor = getRowColor(line);

            return (
              <tr key={line.id}
                className={`border-t ${rowColor} ${!isLocked ? 'cursor-pointer hover:bg-gray-50' : ''}`}
                onClick={() => !isLocked && setEditingLine(isEditing ? null : line.id)}
              >
                <td className="px-2 py-1.5">
                  {isEditing ? (
                    <input className="w-full border rounded px-1 py-0.5 text-xs" defaultValue={line.provider}
                      onClick={e => e.stopPropagation()}
                      onBlur={e => onUpdate(line.id, { provider: e.target.value })} />
                  ) : (
                    <span className="font-medium">{line.provider}</span>
                  )}
                </td>
                <td className="px-2 py-1.5">
                  {isEditing ? (
                    <input className="w-16 border rounded px-1 py-0.5 text-xs" defaultValue={line.country}
                      onClick={e => e.stopPropagation()}
                      onBlur={e => onUpdate(line.id, { country: e.target.value })} />
                  ) : line.country}
                </td>
                <td className="px-2 py-1.5 max-w-48 truncate" title={line.description}>
                  {isEditing ? (
                    <input className="w-full border rounded px-1 py-0.5 text-xs" defaultValue={line.description}
                      onClick={e => e.stopPropagation()}
                      onBlur={e => onUpdate(line.id, { description: e.target.value })} />
                  ) : line.description}
                </td>
                <td className="px-2 py-1.5 whitespace-nowrap">{formatDate(line.invoice_date)}</td>
                <td className="px-2 py-1.5">{line.invoice_number}</td>
                <td className="px-2 py-1.5 text-right font-mono">
                  {isEditing ? (
                    <input className="w-20 border rounded px-1 py-0.5 text-xs text-right" type="number" step="0.01"
                      defaultValue={line.amount_eur} onClick={e => e.stopPropagation()}
                      onBlur={e => onUpdate(line.id, { amount_eur: parseFloat(e.target.value) })} />
                  ) : fmtEUR(line.amount_eur)}
                </td>
                <td className="px-2 py-1.5 text-right">{line.vat_rate != null ? `${(line.vat_rate * 100).toFixed(0)}%` : '-'}</td>
                <td className="px-2 py-1.5 text-right font-mono">{fmtEUR(line.vat_applied)}</td>
                <td className="px-2 py-1.5 text-right font-mono">{fmtEUR(line.rc_amount)}</td>
                <td className="px-2 py-1.5 text-right font-mono">{fmtEUR(line.amount_incl)}</td>
                {hasFx && <>
                  <td className="px-2 py-1.5 text-right">{line.currency || '-'}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{line.currency_amount ? fmtEUR(line.currency_amount) : '-'}</td>
                  <td className="px-2 py-1.5 text-right">{line.ecb_rate || '-'}</td>
                </>}
                <td className="px-2 py-1.5">
                  {isEditing ? (
                    <select className="border rounded px-1 py-0.5 text-xs" value={line.treatment || ''}
                      onClick={e => e.stopPropagation()}
                      onChange={e => onUpdate(line.id, { treatment: e.target.value || null, treatment_source: 'manual' })}>
                      <option value="">Unclassified</option>
                      {treatments.map(t => (
                        <option key={t} value={t}>{t} - {TREATMENT_CODES[t].label}</option>
                      ))}
                    </select>
                  ) : (
                    <span className={`text-xs px-1 py-0.5 rounded ${line.treatment ? 'bg-gray-100' : 'text-red-600 font-bold'}`}>
                      {line.treatment || 'UNCLASSIFIED'}
                    </span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-gray-500">{line.treatment_source || '-'}</td>
                <td className="px-2 py-1.5 text-right">
                  {line.ai_confidence != null ? (
                    <span className={line.ai_confidence < 0.7 ? 'text-amber-600 font-bold' : ''}>
                      {(line.ai_confidence * 100).toFixed(0)}%
                    </span>
                  ) : '-'}
                </td>
                <td className="px-2 py-1.5 text-center">
                  {line.flag ? (
                    <span
                      className={`cursor-pointer ${line.flag_acknowledged ? 'text-gray-400' : 'text-red-600'}`}
                      title={line.flag_reason || 'Flagged'}
                      onClick={e => {
                        e.stopPropagation();
                        if (!line.flag_acknowledged && !isLocked) {
                          onUpdate(line.id, { flag_acknowledged: 1 });
                        }
                      }}
                    >
                      {line.flag_acknowledged ? '✓' : '⚠'}
                    </span>
                  ) : '-'}
                </td>
                {!isLocked && (
                  <td className="px-2 py-1.5">
                    <button
                      className="text-red-400 hover:text-red-600"
                      onClick={e => { e.stopPropagation(); onDelete(line.id); }}
                      title="Delete line"
                    >✕</button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Row colour coding per PRD 4.2
function getRowColor(line: InvoiceLine): string {
  if (line.state === 'deleted') return 'bg-gray-100 line-through';
  if (!line.treatment) return 'border-l-4 border-l-red-500'; // Blocking: unclassified
  if (line.flag && !line.flag_acknowledged) return 'border-l-4 border-l-red-500 bg-red-50'; // Blocking: unacknowledged flag
  if (line.treatment_source === 'ai' && line.ai_confidence != null && line.ai_confidence < 0.7)
    return 'bg-amber-50'; // Low confidence AI
  if (line.treatment_source === 'ai') return 'bg-yellow-50'; // AI classified
  if (line.treatment_source === 'precedent') return 'bg-blue-50'; // Precedent match
  return ''; // Rule or manual = white
}

function formatDate(d: string | null): string {
  if (!d) return '-';
  const parts = d.split('-');
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return d;
}

function fmtEUR(v: number | null): string {
  if (v == null) return '-';
  return v.toLocaleString('en-LU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

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
    <span className={`text-xs px-2 py-0.5 rounded font-medium ${colors[status] || 'bg-gray-100'}`}>
      {status.toUpperCase()}
    </span>
  );
}

function DocStatus({ status }: { status: string }) {
  const colors: Record<string, string> = {
    uploaded: 'bg-gray-100 text-gray-600',
    triaging: 'bg-purple-100 text-purple-600',
    triaged: 'bg-blue-100 text-blue-600',
    extracting: 'bg-yellow-100 text-yellow-600',
    extracted: 'bg-green-100 text-green-600',
    rejected: 'bg-red-100 text-red-600',
    error: 'bg-red-100 text-red-600',
  };
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded ${colors[status] || 'bg-gray-100'}`}>
      {status}
    </span>
  );
}
