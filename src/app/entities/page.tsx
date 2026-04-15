'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Entity {
  id: string;
  name: string;
  vat_number: string | null;
  matricule: string | null;
  rcs_number: string | null;
  legal_form: string | null;
  entity_type: string | null;
  regime: string;
  frequency: string;
  address: string | null;
  bank_iban: string | null;
  bank_bic: string | null;
  tax_office: string | null;
  client_name: string | null;
  client_email: string | null;
  csp_name: string | null;
  csp_email: string | null;
  has_fx: number;
  has_outgoing: number;
  has_recharges: number;
  notes: string | null;
  created_at: string;
}

export default function EntitiesPage() {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '', vat_number: '', matricule: '', rcs_number: '',
    legal_form: '', entity_type: '', regime: 'simplified', frequency: 'annual',
    address: '', bank_iban: '', bank_bic: '', tax_office: '',
    client_name: '', client_email: '', csp_name: '', csp_email: '',
    has_fx: false, has_outgoing: false, has_recharges: false, notes: '',
  });

  useEffect(() => { loadEntities(); }, []);

  async function loadEntities() {
    const res = await fetch('/api/entities');
    setEntities(await res.json());
  }

  async function handleDelete(entity: Entity) {
    if (!confirm(`Are you sure you want to delete "${entity.name}"? This hides the entity from the list but keeps the data in the database for audit purposes.`)) {
      return;
    }
    const res = await fetch(`/api/entities/${entity.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'user_deleted' }),
    });
    if (!res.ok) {
      alert('Failed to delete entity');
      return;
    }
    loadEntities();
  }

  function resetForm() {
    setForm({
      name: '', vat_number: '', matricule: '', rcs_number: '',
      legal_form: '', entity_type: '', regime: 'simplified', frequency: 'annual',
      address: '', bank_iban: '', bank_bic: '', tax_office: '',
      client_name: '', client_email: '', csp_name: '', csp_email: '',
      has_fx: false, has_outgoing: false, has_recharges: false, notes: '',
    });
    setEditId(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const url = editId ? `/api/entities/${editId}` : '/api/entities';
    const method = editId ? 'PUT' : 'POST';
    await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    resetForm();
    setShowForm(false);
    loadEntities();
  }

  function handleEdit(entity: Entity) {
    setForm({
      name: entity.name || '',
      vat_number: entity.vat_number || '',
      matricule: entity.matricule || '',
      rcs_number: entity.rcs_number || '',
      legal_form: entity.legal_form || '',
      entity_type: entity.entity_type || '',
      regime: entity.regime || 'simplified',
      frequency: entity.frequency || 'annual',
      address: entity.address || '',
      bank_iban: entity.bank_iban || '',
      bank_bic: entity.bank_bic || '',
      tax_office: entity.tax_office || '',
      client_name: entity.client_name || '',
      client_email: entity.client_email || '',
      csp_name: entity.csp_name || '',
      csp_email: entity.csp_email || '',
      has_fx: !!entity.has_fx,
      has_outgoing: !!entity.has_outgoing,
      has_recharges: !!entity.has_recharges,
      notes: entity.notes || '',
    });
    setEditId(entity.id);
    setShowForm(true);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Entities</h1>
        <button
          onClick={() => { resetForm(); setShowForm(!showForm); }}
          className="bg-[#1a1a2e] text-white px-4 py-2 rounded text-sm font-semibold hover:bg-[#2a2a4e]"
        >
          {showForm ? 'Cancel' : '+ New Entity'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white border rounded-lg p-6 mb-6">
          <h2 className="font-semibold mb-4">{editId ? 'Edit Entity' : 'New Entity'}</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Name *</label>
              <input required value={form.name} onChange={e => setForm({...form, name: e.target.value})}
                className="w-full border rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">VAT Number</label>
              <input value={form.vat_number} onChange={e => setForm({...form, vat_number: e.target.value})}
                placeholder="LU12345678" className="w-full border rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Matricule</label>
              <input value={form.matricule} onChange={e => setForm({...form, matricule: e.target.value})}
                className="w-full border rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">RCS Number</label>
              <input value={form.rcs_number} onChange={e => setForm({...form, rcs_number: e.target.value})}
                className="w-full border rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Legal Form</label>
              <select value={form.legal_form} onChange={e => setForm({...form, legal_form: e.target.value})}
                className="w-full border rounded px-3 py-2 text-sm">
                <option value="">Select...</option>
                <option value="SARL">SARL</option>
                <option value="SCA">SCA</option>
                <option value="SCS">SCS</option>
                <option value="SA">SA</option>
                <option value="SCSp">SCSp</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Entity Type</label>
              <select value={form.entity_type} onChange={e => setForm({...form, entity_type: e.target.value})}
                className="w-full border rounded px-3 py-2 text-sm">
                <option value="">Select...</option>
                <option value="fund">Fund</option>
                <option value="active_holding">Active Holding</option>
                <option value="gp">General Partner</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Regime *</label>
              <select value={form.regime} onChange={e => setForm({...form, regime: e.target.value})}
                className="w-full border rounded px-3 py-2 text-sm">
                <option value="simplified">Simplified</option>
                <option value="ordinary">Ordinary</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Frequency *</label>
              <select value={form.frequency} onChange={e => setForm({...form, frequency: e.target.value})}
                className="w-full border rounded px-3 py-2 text-sm">
                <option value="annual">Annual</option>
                <option value="quarterly">Quarterly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Address</label>
              <input value={form.address} onChange={e => setForm({...form, address: e.target.value})}
                className="w-full border rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Bank IBAN</label>
              <input value={form.bank_iban} onChange={e => setForm({...form, bank_iban: e.target.value})}
                className="w-full border rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Bank BIC</label>
              <input value={form.bank_bic} onChange={e => setForm({...form, bank_bic: e.target.value})}
                className="w-full border rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Tax Office</label>
              <input value={form.tax_office} onChange={e => setForm({...form, tax_office: e.target.value})}
                className="w-full border rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Client Name</label>
              <input value={form.client_name} onChange={e => setForm({...form, client_name: e.target.value})}
                className="w-full border rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Client Email</label>
              <input value={form.client_email} onChange={e => setForm({...form, client_email: e.target.value})}
                className="w-full border rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">CSP Name</label>
              <input value={form.csp_name} onChange={e => setForm({...form, csp_name: e.target.value})}
                className="w-full border rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">CSP Email</label>
              <input value={form.csp_email} onChange={e => setForm({...form, csp_email: e.target.value})}
                className="w-full border rounded px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="flex gap-6 mt-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.has_fx} onChange={e => setForm({...form, has_fx: e.target.checked})} />
              Has FX invoices
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.has_outgoing} onChange={e => setForm({...form, has_outgoing: e.target.checked})} />
              Has outgoing invoices
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.has_recharges} onChange={e => setForm({...form, has_recharges: e.target.checked})} />
              Has recharges
            </label>
          </div>
          <div className="mt-4">
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})}
              rows={2} className="w-full border rounded px-3 py-2 text-sm" />
          </div>
          <div className="mt-4 flex gap-2">
            <button type="submit" className="bg-[#1a1a2e] text-white px-4 py-2 rounded text-sm font-semibold hover:bg-[#2a2a4e]">
              {editId ? 'Update' : 'Create'} Entity
            </button>
            <button type="button" onClick={() => { resetForm(); setShowForm(false); }}
              className="border px-4 py-2 rounded text-sm">
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="bg-white border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#1a1a2e] text-white text-xs">
            <tr>
              <th className="px-4 py-3 text-left">Client Name</th>
              <th className="px-4 py-3 text-left">Entity Name</th>
              <th className="px-4 py-3 text-left">Regime</th>
              <th className="px-4 py-3 text-left">Frequency</th>
              <th className="px-4 py-3 text-left">VAT Number</th>
              <th className="px-4 py-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {entities.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">No entities yet. Create one to get started.</td></tr>
            )}
            {entities.map(entity => (
              <tr key={entity.id} className="border-t hover:bg-gray-50">
                <td className="px-4 py-3 text-gray-600">{entity.client_name || '—'}</td>
                <td className="px-4 py-3 font-medium">
                  <Link href={`/entities/${entity.id}`} className="hover:text-blue-600 hover:underline">{entity.name}</Link>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                    entity.regime === 'simplified' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                  }`}>{entity.regime}</span>
                </td>
                <td className="px-4 py-3 text-gray-600">{entity.frequency}</td>
                <td className="px-4 py-3 text-gray-600">{entity.vat_number || '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-3">
                    <Link href={`/entities/${entity.id}`}
                      className="text-blue-600 hover:underline text-xs">Open</Link>
                    <button onClick={() => handleEdit(entity)}
                      className="text-blue-600 hover:underline text-xs">Edit</button>
                    <Link href={`/declarations?entity_id=${entity.id}`}
                      className="text-blue-600 hover:underline text-xs">Declarations</Link>
                    <button onClick={() => handleDelete(entity)}
                      className="text-red-600 hover:underline text-xs">Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
