'use client';

import { useEffect, useState, useRef } from 'react';

interface AEDComm {
  id: string;
  entity_id: string | null;
  entity_name: string | null;
  filename: string;
  file_size: number;
  type: string | null;
  amount: number | null;
  reference: string | null;
  deadline_date: string | null;
  urgency: string | null;
  summary: string | null;
  status: string;
  uploaded_at: string;
}

interface Entity {
  id: string;
  name: string;
}

export default function AEDLettersPage() {
  const [letters, setLetters] = useState<AEDComm[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [selectedEntity, setSelectedEntity] = useState('');
  const [uploading, setUploading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'open'>('all');
  const fileInput = useRef<HTMLInputElement>(null);

  function load() {
    fetch('/api/aed').then(r => r.json()).then(setLetters);
  }

  useEffect(() => {
    load();
    fetch('/api/entities').then(r => r.json()).then(setEntities);
  }, []);

  async function handleUpload(files: FileList | null) {
    if (!files || !files.length) return;
    setUploading(true);
    for (const f of Array.from(files)) {
      const form = new FormData();
      form.set('file', f);
      if (selectedEntity) form.set('entity_id', selectedEntity);
      await fetch('/api/aed/upload', { method: 'POST', body: form });
    }
    setUploading(false);
    load();
  }

  async function setStatus(id: string, status: string) {
    await fetch(`/api/aed/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    load();
  }

  async function openLetter(id: string) {
    const res = await fetch(`/api/aed/${id}?action=url`);
    const d = await res.json();
    if (d.url) window.open(d.url, '_blank', 'noopener');
  }

  const visible = statusFilter === 'open'
    ? letters.filter(l => l.status === 'received' || l.status === 'reviewed')
    : letters;

  const counts = {
    total: letters.length,
    high: letters.filter(l => l.urgency === 'high' && l.status !== 'archived').length,
    open: letters.filter(l => l.status === 'received' || l.status === 'reviewed').length,
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight">AED communications</h1>
          <p className="text-[12px] text-gray-500 mt-1">
            Letters received from the Luxembourg tax authority. Auto-classified by Claude on upload.
          </p>
        </div>
        <div className="flex gap-1">
          <FilterChip active={statusFilter === 'all'} onClick={() => setStatusFilter('all')}>All ({counts.total})</FilterChip>
          <FilterChip active={statusFilter === 'open'} onClick={() => setStatusFilter('open')}>Open ({counts.open})</FilterChip>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-5">
        <KPI label="Total letters" value={counts.total} />
        <KPI label="High urgency open" value={counts.high} color={counts.high > 0 ? 'text-red-600' : 'text-gray-400'} />
        <KPI label="Open" value={counts.open} color={counts.open > 0 ? 'text-orange-600' : 'text-gray-400'} />
      </div>

      {/* Upload */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-5">
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-[11px] uppercase tracking-wide font-semibold text-gray-500 mb-1">Entity (optional)</label>
            <select
              value={selectedEntity}
              onChange={e => setSelectedEntity(e.target.value)}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-[12px] focus:border-[#1a1a2e] focus:outline-none focus:ring-1 focus:ring-[#1a1a2e]"
            >
              <option value="">— unassigned —</option>
              {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <input ref={fileInput} type="file" accept=".pdf,.png,.jpg,.jpeg" multiple
            className="hidden" onChange={e => handleUpload(e.target.files)} />
          <button
            onClick={() => fileInput.current?.click()}
            disabled={uploading}
            className="h-9 px-4 rounded bg-[#1a1a2e] text-white text-[12px] font-semibold hover:bg-[#2a2a4e] disabled:opacity-40 cursor-pointer transition-all duration-150"
          >
            {uploading ? 'Uploading & classifying…' : 'Upload AED letter'}
          </button>
        </div>
      </div>

      {/* Letters table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {visible.length === 0 ? (
          <div className="p-8 text-center text-[12px] text-gray-400">No letters yet.</div>
        ) : (
          <table className="w-full text-[12px]">
            <thead className="bg-gray-50 text-gray-600 border-b border-gray-200">
              <tr>
                <th className="px-3 py-2 text-left font-medium uppercase tracking-wide text-[10px]">Type</th>
                <th className="px-3 py-2 text-left font-medium uppercase tracking-wide text-[10px]">Entity</th>
                <th className="px-3 py-2 text-left font-medium uppercase tracking-wide text-[10px]">Reference</th>
                <th className="px-3 py-2 text-left font-medium uppercase tracking-wide text-[10px]">Summary</th>
                <th className="px-3 py-2 text-right font-medium uppercase tracking-wide text-[10px]">Amount</th>
                <th className="px-3 py-2 text-left font-medium uppercase tracking-wide text-[10px]">Deadline</th>
                <th className="px-3 py-2 text-left font-medium uppercase tracking-wide text-[10px]">Urgency</th>
                <th className="px-3 py-2 text-left font-medium uppercase tracking-wide text-[10px]">Status</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {visible.map(l => (
                <tr key={l.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/60 transition-colors duration-150">
                  <td className="px-3 py-2"><TypePill type={l.type} /></td>
                  <td className="px-3 py-2 text-gray-700">{l.entity_name || <span className="text-gray-400">—</span>}</td>
                  <td className="px-3 py-2 text-gray-600 font-mono text-[11px]">{l.reference || '—'}</td>
                  <td className="px-3 py-2 text-gray-700 max-w-md">
                    <div className="line-clamp-2">{l.summary || <button onClick={() => openLetter(l.id)} className="text-blue-600 hover:underline cursor-pointer">Open to review</button>}</div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-700">{l.amount != null ? `€${Number(l.amount).toLocaleString('en-LU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}</td>
                  <td className="px-3 py-2 text-gray-700">{formatDate(l.deadline_date)}</td>
                  <td className="px-3 py-2"><UrgencyPill urgency={l.urgency} /></td>
                  <td className="px-3 py-2"><StatusPill status={l.status} /></td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button onClick={() => openLetter(l.id)} className="text-blue-600 hover:underline text-[11px] font-medium cursor-pointer">View</button>
                    {l.status === 'received' && <> · <button onClick={() => setStatus(l.id, 'reviewed')} className="text-blue-600 hover:underline text-[11px] font-medium cursor-pointer">Mark reviewed</button></>}
                    {l.status === 'reviewed' && <> · <button onClick={() => setStatus(l.id, 'actioned')} className="text-blue-600 hover:underline text-[11px] font-medium cursor-pointer">Mark actioned</button></>}
                    {l.status !== 'archived' && <> · <button onClick={() => setStatus(l.id, 'archived')} className="text-gray-400 hover:underline text-[11px] cursor-pointer">Archive</button></>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function TypePill({ type }: { type: string | null }) {
  if (!type) return <span className="text-[10px] text-gray-400">—</span>;
  const map: Record<string, string> = {
    extrait_de_compte: 'bg-gray-100 text-gray-700',
    fixation_d_acompte: 'bg-red-100 text-red-700',
    bulletin_d_information: 'bg-amber-100 text-amber-700',
    demande_de_renseignements: 'bg-orange-100 text-orange-700',
    other: 'bg-gray-100 text-gray-600',
  };
  return <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${map[type] || 'bg-gray-100'}`}>{type.replace(/_/g, ' ')}</span>;
}
function UrgencyPill({ urgency }: { urgency: string | null }) {
  if (!urgency) return <span className="text-[10px] text-gray-400">—</span>;
  const map: Record<string, string> = {
    high: 'bg-red-100 text-red-700',
    medium: 'bg-amber-100 text-amber-700',
    low: 'bg-gray-100 text-gray-600',
  };
  return <span className={`text-[10px] px-2 py-0.5 rounded font-semibold uppercase tracking-wide ${map[urgency] || 'bg-gray-100'}`}>{urgency}</span>;
}
function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    received: 'bg-blue-100 text-blue-700',
    reviewed: 'bg-purple-100 text-purple-700',
    actioned: 'bg-green-100 text-green-700',
    archived: 'bg-gray-100 text-gray-500',
  };
  return <span className={`text-[10px] px-2 py-0.5 rounded font-semibold uppercase tracking-wide ${map[status] || 'bg-gray-100'}`}>{status}</span>;
}
function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`h-7 px-2.5 rounded text-[11px] font-medium transition-colors duration-150 cursor-pointer ${
        active ? 'bg-[#1a1a2e] text-white' : 'border border-gray-300 text-gray-700 hover:bg-gray-50'
      }`}
    >
      {children}
    </button>
  );
}
function KPI({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3">
      <div className="text-[10px] text-gray-500 uppercase tracking-wide font-semibold">{label}</div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${color || 'text-gray-900'}`}>{value}</div>
    </div>
  );
}
function formatDate(d: string | null): string {
  if (!d) return '—';
  const parts = d.split('-');
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return d;
}
