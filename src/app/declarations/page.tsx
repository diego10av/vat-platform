'use client';

import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

interface Entity {
  id: string;
  name: string;
  regime: string;
  frequency: string;
}

interface Declaration {
  id: string;
  entity_id: string;
  entity_name: string;
  year: number;
  period: string;
  status: string;
  created_at: string;
}

export default function DeclarationsPage() {
  return (
    <Suspense fallback={<div className="text-center py-12 text-gray-500">Loading...</div>}>
      <DeclarationsContent />
    </Suspense>
  );
}

function DeclarationsContent() {
  const searchParams = useSearchParams();
  const entityId = searchParams.get('entity_id');

  const [entities, setEntities] = useState<Entity[]>([]);
  const [declarations, setDeclarations] = useState<Declaration[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ entity_id: entityId || '', year: new Date().getFullYear(), period: '' });
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/entities').then(r => r.json()).then(setEntities);
    loadDeclarations();
  }, [entityId]);

  async function loadDeclarations() {
    const url = entityId ? `/api/declarations?entity_id=${entityId}` : '/api/declarations';
    const res = await fetch(url);
    setDeclarations(await res.json());
  }

  function getPeriodsForEntity(entityId: string): string[] {
    const entity = entities.find(e => e.id === entityId);
    if (!entity) return ['Y1'];
    if (entity.frequency === 'annual') return ['Y1'];
    if (entity.frequency === 'quarterly') return ['Q1', 'Q2', 'Q3', 'Q4'];
    return ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const res = await fetch('/api/declarations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || 'Failed to create declaration');
      return;
    }
    const declaration = await res.json();
    setShowForm(false);
    window.location.href = `/declarations/${declaration.id}`;
  }

  const selectedEntity = entities.find(e => e.id === form.entity_id);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">
          Declarations
          {entityId && selectedEntity && (
            <span className="text-lg font-normal text-gray-500 ml-2">for {selectedEntity.name}</span>
          )}
        </h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-[#1a1a2e] text-white px-4 py-2 rounded text-sm font-semibold hover:bg-[#2a2a4e]"
        >
          {showForm ? 'Cancel' : '+ New Declaration'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-white border rounded-lg p-6 mb-6">
          <h2 className="font-semibold mb-4">New Declaration</h2>
          {error && <div className="text-red-600 text-sm mb-3 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Entity *</label>
              <select required value={form.entity_id}
                onChange={e => setForm({...form, entity_id: e.target.value, period: ''})}
                className="w-full border rounded px-3 py-2 text-sm">
                <option value="">Select entity...</option>
                {entities.map(e => (
                  <option key={e.id} value={e.id}>{e.name} ({e.regime})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Year *</label>
              <select required value={form.year}
                onChange={e => setForm({...form, year: parseInt(e.target.value)})}
                className="w-full border rounded px-3 py-2 text-sm">
                {[2024, 2025, 2026, 2027].map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Period *</label>
              <select required value={form.period}
                onChange={e => setForm({...form, period: e.target.value})}
                className="w-full border rounded px-3 py-2 text-sm">
                <option value="">Select period...</option>
                {form.entity_id && getPeriodsForEntity(form.entity_id).map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-4">
            <button type="submit" className="bg-[#1a1a2e] text-white px-4 py-2 rounded text-sm font-semibold hover:bg-[#2a2a4e]">
              Create Declaration
            </button>
          </div>
        </form>
      )}

      <div className="bg-white border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#1a1a2e] text-white text-xs">
            <tr>
              <th className="px-4 py-3 text-left">Entity</th>
              <th className="px-4 py-3 text-left">Year</th>
              <th className="px-4 py-3 text-left">Period</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Created</th>
              <th className="px-4 py-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {declarations.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                No declarations yet.{' '}
                {entities.length === 0
                  ? <Link href="/entities" className="text-blue-600 hover:underline">Create an entity first</Link>
                  : 'Click "New Declaration" to start.'}
              </td></tr>
            )}
            {declarations.map(d => (
              <tr key={d.id} className="border-t hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{d.entity_name}</td>
                <td className="px-4 py-3">{d.year}</td>
                <td className="px-4 py-3">{d.period}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={d.status} />
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs">{new Date(d.created_at).toLocaleDateString()}</td>
                <td className="px-4 py-3">
                  <Link href={`/declarations/${d.id}`} className="text-blue-600 hover:underline text-xs">Open</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
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
