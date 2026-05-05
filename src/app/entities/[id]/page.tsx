'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Trash2Icon } from 'lucide-react';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { ApproversCard } from '@/components/entity/ApproversCard';
import { EntityEditCard } from '@/components/entity/EntityEditCard';
import { EntityProrataCard } from '@/components/entity/EntityProrataCard';
import { OfficialDocumentsCard } from '@/components/entity/OfficialDocumentsCard';
import { CascadeDeleteModal } from '@/components/delete/CascadeDeleteModal';

interface TimelineData {
  entity: {
    id: string; name: string; client_name: string | null; vat_number: string | null;
    matricule: string | null; regime: string; frequency: string; address: string | null;
    rcs_number: string | null; legal_form: string | null; entity_type: string | null;
    has_fx: boolean; has_outgoing: boolean; has_recharges: boolean;
    requires_partner_review?: boolean;
    notes: string | null;
    ai_mode: 'full' | 'classifier_only' | null;
    // Stint 24 — fields from the AED VAT registration letter (migration 027).
    // Optional because the timeline endpoint may predate the migration; all
    // default to null in the UI.
    tax_office?: string | null;
    activity_code?: string | null;
    activity_description?: string | null;
    bank_name?: string | null;
    bank_iban?: string | null;
    bank_bic?: string | null;
    deregistration_date?: string | null;
  };
  declarations: Array<{
    id: string; year: number; period: string; status: string;
    filing_ref: string | null; filed_at: string | null; payment_confirmed_at: string | null;
    line_count: number; total_ex_vat: number; vat_payable: number;
  }>;
  top_providers: Array<{ provider: string; total: number; invoice_count: number }>;
  precedents: Array<{ id: string; provider: string; country: string | null; treatment: string; last_amount: number | null; last_used: string | null; times_used: number }>;
  aed_letters: Array<{ id: string; filename: string; type: string | null; urgency: string | null; status: string; summary: string | null; deadline_date: string | null; uploaded_at: string }>;
  recent_audit: Array<{ id: string; action: string; target_type: string; field: string | null; old_value: string | null; new_value: string | null; created_at: string; year: number | null; period: string | null }>;
}

export default function EntityDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [data, setData] = useState<TimelineData | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    fetch(`/api/entities/${id}/timeline`).then(r => r.json()).then(setData);
  }, [id]);

  if (!data) return <PageSkeleton />;

  const e = data.entity;
  const totalLifetime = data.declarations.reduce((s, d) => s + Number(d.vat_payable || 0), 0);

  return (
    <div>
      <div className="mb-5">
        <div className="text-xs text-ink-faint mb-1">
          <Link href="/entities" className="hover:underline">Entities</Link> ›
        </div>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">{e.name}</h1>
            <div className="text-sm text-ink-muted mt-1 flex items-center gap-2">
              {e.client_name && <span>{e.client_name}</span>}
              {e.client_name && <span className="text-ink-faint">·</span>}
              <span className="capitalize">{e.regime}</span>
              <span className="text-ink-faint">·</span>
              <span className="capitalize">{e.frequency}</span>
              {e.vat_number && <><span className="text-ink-faint">·</span><span>{e.vat_number}</span></>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setDeleteOpen(true)}
              className="h-8 px-3 rounded border border-border-strong text-sm font-medium text-ink-muted hover:bg-danger-50 hover:text-danger-700 hover:border-danger-200 transition-all duration-150 inline-flex items-center gap-1.5"
              title="Archive or permanently delete this entity"
            >
              <Trash2Icon size={12} /> Delete
            </button>
            <Link
              href={`/declarations?entity_id=${id}`}
              className="h-8 px-3 rounded bg-brand-500 text-white text-sm font-semibold hover:bg-brand-600 transition-all duration-150 inline-flex items-center cursor-pointer"
            >
              All declarations
            </Link>
          </div>
        </div>
      </div>

      <CascadeDeleteModal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onDone={() => {
          setDeleteOpen(false);
          // If we have a parent client, return to that client detail;
          // else go to the flat entities list.
          router.push('/entities');
        }}
        scope="entity"
        targetId={id}
        targetName={e.name}
      />

      <EntityEditCard
        entity={{
          id: e.id,
          name: e.name,
          vat_number: e.vat_number,
          matricule: e.matricule,
          rcs_number: e.rcs_number,
          legal_form: e.legal_form,
          entity_type: e.entity_type,
          regime: e.regime,
          frequency: e.frequency,
          address: e.address,
          has_fx: e.has_fx,
          has_outgoing: e.has_outgoing,
          has_recharges: e.has_recharges,
          requires_partner_review: !!e.requires_partner_review,
          // Stint 24 — fields captured from the VAT registration letter
          // (migration 027). Read-only display in EntityEditCard until
          // the follow-up stint adds edit form inputs for them.
          tax_office: e.tax_office ?? null,
          activity_code: e.activity_code ?? null,
          activity_description: e.activity_description ?? null,
          bank_name: e.bank_name ?? null,
          bank_iban: e.bank_iban ?? null,
          bank_bic: e.bank_bic ?? null,
          deregistration_date: e.deregistration_date ?? null,
        }}
        onSaved={(next) => setData(d => d ? { ...d, entity: { ...d.entity, ...next } } : d)}
      />

      <OfficialDocumentsCard
        entityId={id}
        entityName={e.name}
        currentFrequency={e.frequency}
        currentRegime={e.regime}
        onEntityPatched={() => {
          // Re-fetch the timeline so the entity card reflects any
          // fields the user just propagated from the new VAT letter
          // or the manual frequency-change modal.
          fetch(`/api/entities/${id}/timeline`).then(r => r.json()).then(setData);
        }}
      />

      <ApproversCard entityId={id} />

      <EntityProrataCard entityId={id} />

      <AiModeCard
        entityId={id}
        current={e.ai_mode || 'full'}
        onChanged={(next) => setData(d => d ? { ...d, entity: { ...d.entity, ai_mode: next } } : d)}
      />

      <NotesCard
        kind="entity"
        id={id}
        initial={e.notes}
        title="Internal notes"
        helper="These notes are internal — never sent to the client. Use them for engagement context, recurring quirks of this entity, or reminders."
      />

      <div className="grid grid-cols-4 gap-3 mb-5">
        <KPI label="Declarations" value={data.declarations.length} />
        <KPI label="Lifetime VAT paid" value={`€${fmtEUR(totalLifetime)}`} small />
        <KPI label="Recurring providers" value={data.top_providers.length} />
        <KPI label="AED letters" value={data.aed_letters.length} />
      </div>

      <div className="grid grid-cols-3 gap-4 mb-5">
        {/* Declarations history */}
        <div className="col-span-2 bg-surface border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border bg-surface-alt">
            <h3 className="text-sm font-semibold text-ink">Declarations history</h3>
          </div>
          {data.declarations.length === 0 ? (
            <div className="p-6 text-center text-sm text-ink-faint">No declarations for this entity yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-ink-muted border-b border-divider">
                <tr>
                  <th className="px-3 py-2 text-left font-medium uppercase tracking-wide text-2xs">Period</th>
                  <th className="px-3 py-2 text-left font-medium uppercase tracking-wide text-2xs">Status</th>
                  <th className="px-3 py-2 text-right font-medium uppercase tracking-wide text-2xs">Lines</th>
                  <th className="px-3 py-2 text-right font-medium uppercase tracking-wide text-2xs">Total ex.VAT</th>
                  <th className="px-3 py-2 text-right font-medium uppercase tracking-wide text-2xs">VAT due</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {data.declarations.map(d => (
                  <tr key={d.id} className="border-b border-divider last:border-0 hover:bg-surface-alt/50 transition-colors duration-150">
                    <td className="px-3 py-2 font-medium text-ink">{d.year} {d.period}</td>
                    <td className="px-3 py-2"><StatusPill status={d.status} /></td>
                    <td className="px-3 py-2 text-right text-ink-soft tabular-nums">{d.line_count}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-soft">€{fmtEUR(d.total_ex_vat)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">€{fmtEUR(d.vat_payable)}</td>
                    <td className="px-3 py-2 text-right">
                      <Link href={`/declarations/${d.id}`} className="text-brand-600 hover:underline text-xs font-medium">Open</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Top providers */}
        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border bg-surface-alt">
            <h3 className="text-sm font-semibold text-ink">Top providers (lifetime)</h3>
          </div>
          {data.top_providers.length === 0 ? (
            <div className="p-6 text-center text-sm text-ink-faint">No invoices yet.</div>
          ) : (
            <div className="divide-y divide-divider">
              {data.top_providers.map(p => (
                <div key={p.provider} className="px-3 py-2 flex items-center justify-between text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-ink">{p.provider}</div>
                    <div className="text-2xs text-ink-faint">{p.invoice_count} invoice{p.invoice_count === 1 ? '' : 's'}</div>
                  </div>
                  <div className="font-mono tabular-nums text-ink-soft ml-2">€{fmtEUR(p.total)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Precedents + AED letters */}
      <div className="grid grid-cols-2 gap-4 mb-5">
        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border bg-surface-alt">
            <h3 className="text-sm font-semibold text-ink">Precedents ({data.precedents.length})</h3>
          </div>
          {data.precedents.length === 0 ? (
            <div className="p-6 text-center text-sm text-ink-faint">No precedents yet. They appear after the first approved declaration.</div>
          ) : (
            <div className="max-h-[300px] overflow-y-auto divide-y divide-divider">
              {data.precedents.map(p => (
                <div key={p.id} className="px-3 py-2 flex items-center justify-between text-xs">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-ink">{p.provider}</div>
                    <div className="text-2xs text-ink-muted">{p.country || '—'} · used {p.times_used}× · last {p.last_used}</div>
                  </div>
                  <span className="ml-2 px-2 py-0.5 rounded text-2xs font-semibold tracking-wide bg-blue-100 text-blue-800 border border-blue-200">{p.treatment}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border bg-surface-alt flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink">AED letters</h3>
            <Link href={`/aed-letters`} className="text-xs text-brand-600 hover:underline">All letters</Link>
          </div>
          {data.aed_letters.length === 0 ? (
            <div className="p-6 text-center text-sm text-ink-faint">No letters for this entity.</div>
          ) : (
            <div className="max-h-[300px] overflow-y-auto divide-y divide-divider">
              {data.aed_letters.map(l => (
                <div key={l.id} className="px-3 py-2 text-xs">
                  <div className="flex items-center justify-between">
                    <div className="font-medium text-ink truncate">{l.type || l.filename}</div>
                    <span className="text-2xs text-ink-faint ml-2 shrink-0">{formatDate(l.uploaded_at)}</span>
                  </div>
                  {l.summary && <div className="text-xs text-ink-soft mt-0.5 line-clamp-2">{l.summary}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent audit */}
      <div className="bg-surface border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border bg-surface-alt flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">Recent activity</h3>
          <Link href={`/audit?entity_id=${id}`} className="text-xs text-brand-600 hover:underline">Full audit log →</Link>
        </div>
        {data.recent_audit.length === 0 ? (
          <div className="p-6 text-center text-sm text-ink-faint">No activity yet.</div>
        ) : (
          <div className="divide-y divide-divider">
            {data.recent_audit.slice(0, 10).map(r => (
              <div key={r.id} className="px-3 py-2 text-xs flex items-center gap-3">
                <span className="text-2xs text-ink-faint w-32 shrink-0">{formatDateTime(r.created_at)}</span>
                <span className="text-2xs px-1.5 py-0.5 rounded bg-surface-alt text-ink-soft font-medium">{r.action}</span>
                <span className="text-ink-soft font-mono text-2xs">{r.target_type}</span>
                <span className="text-ink-muted truncate flex-1">
                  {r.field ? `${r.field}: ` : ''}{r.new_value || ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Reusable notes card. POSTs to the relevant entity/declaration endpoint.
function NotesCard({
  kind, id, initial, title, helper,
}: {
  kind: 'entity' | 'declaration';
  id: string;
  initial: string | null;
  title: string;
  helper?: string;
}) {
  const [notes, setNotes] = useState(initial || '');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Debounced auto-save 800ms after typing stops
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(async () => {
      setSaving(true);
      try {
        const url = kind === 'entity' ? `/api/entities/${id}` : `/api/declarations/${id}`;
        const method = kind === 'entity' ? 'PUT' : 'PATCH';
        await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notes }),
        });
        setSavedAt(new Date());
        setDirty(false);
      } finally {
        setSaving(false);
      }
    }, 800);
    return () => clearTimeout(t);
  }, [notes, dirty, kind, id]);

  return (
    <div className="bg-surface border border-border rounded-lg p-4 mb-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <span className="text-2xs text-ink-faint">
          {saving ? 'Saving…' : savedAt ? `Saved ${savedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}
        </span>
      </div>
      {helper && <p className="text-xs text-ink-muted mb-2">{helper}</p>}
      <textarea
        value={notes}
        onChange={e => { setNotes(e.target.value); setDirty(true); }}
        rows={3}
        placeholder="Add a note…"
        className="w-full border border-border-strong rounded px-3 py-2 text-sm"
      />
    </div>
  );
}

function KPI({ label, value, small }: { label: string; value: string | number; small?: boolean }) {
  return (
    <div className="bg-surface border border-border rounded-lg p-3">
      <div className="text-2xs text-ink-muted uppercase tracking-wide font-semibold">{label}</div>
      <div className={`font-bold mt-1 tabular-nums text-ink ${small ? 'text-base' : 'text-2xl'}`}>{value}</div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// AiModeCard — per-entity compliance kill-switch.
//
// Two modes:
//   - full            (default): AI extraction, validator, and chat are
//                                 enabled for this entity.
//   - classifier_only: cifra runs only the deterministic LTVA/CJEU
//                      rules. No Anthropic calls, ever. PDF extraction
//                      and validator refuse with a 409; the reviewer
//                      enters invoices manually.
//
// This is the visible product answer to "our compliance policy forbids
// third-party LLM calls on client data". Surfaced per-entity because
// the same firm can serve both a regular boutique (ai_mode='full') and
// a paranoid bank client (ai_mode='classifier_only') in the same cifra
// workspace.
// ════════════════════════════════════════════════════════════════════════
function AiModeCard({
  entityId, current, onChanged,
}: {
  entityId: string;
  current: 'full' | 'classifier_only';
  onChanged: (next: 'full' | 'classifier_only') => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function set(mode: 'full' | 'classifier_only') {
    if (mode === current) return;
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/entities/${entityId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ai_mode: mode }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error?.message || 'Failed to change AI mode.');
        return;
      }
      onChanged(mode);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally { setSaving(false); }
  }

  const isLocked = current === 'classifier_only';
  return (
    <div className={[
      'bg-surface border rounded-lg p-4 mb-4',
      isLocked ? 'border-warning-300' : 'border-border',
    ].join(' ')}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-ink">AI mode</h3>
            {isLocked && (
              <span className="text-2xs font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-warning-100 text-warning-800 border border-warning-300">
                Classifier only
              </span>
            )}
          </div>
          <p className="text-xs text-ink-muted mt-1 leading-relaxed max-w-xl">
            {isLocked
              ? 'This entity runs the deterministic classifier only. AI extraction, validator, and the chat assistant are disabled for it. The LTVA/CJEU rule engine still classifies ~80% of lines; the rest you classify manually.'
              : 'cifra uses AI to extract invoices, run the validator, and power the assistant. Switch to "classifier only" if this client\u2019s compliance policy forbids third-party LLM calls on their data.'}
          </p>
        </div>
        <div className="shrink-0 inline-flex rounded-md border border-border-strong overflow-hidden">
          <ModeBtn
            active={current === 'full'}
            disabled={saving}
            onClick={() => set('full')}
            label="Full"
          />
          <ModeBtn
            active={current === 'classifier_only'}
            disabled={saving}
            onClick={() => set('classifier_only')}
            label="Classifier only"
          />
        </div>
      </div>
      {error && (
        <div className="mt-3 text-xs text-danger-700 bg-danger-50 border border-danger-200 rounded px-3 py-2">
          {error}
        </div>
      )}
    </div>
  );
}

function ModeBtn({
  active, disabled, onClick, label,
}: { active: boolean; disabled: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={[
        'h-8 px-3 text-xs font-medium transition-colors',
        active
          ? 'bg-brand-50 text-brand-700'
          : 'bg-surface text-ink-soft hover:bg-surface-alt',
        disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer',
      ].join(' ')}
    >
      {label}
    </button>
  );
}
function StatusPill({ status }: { status: string }) {
  const colors: Record<string, string> = {
    created: 'bg-surface-alt text-ink-soft',
    uploading: 'bg-blue-100 text-blue-700',
    extracting: 'bg-purple-100 text-purple-700',
    classifying: 'bg-yellow-100 text-yellow-700',
    review: 'bg-orange-100 text-orange-700',
    approved: 'bg-green-100 text-green-700',
    filed: 'bg-emerald-100 text-emerald-800',
    paid: 'bg-teal-100 text-teal-800',
  };
  return <span className={`text-2xs px-2 py-0.5 rounded font-semibold uppercase tracking-wide ${colors[status] || 'bg-surface-alt'}`}>{status}</span>;
}
function fmtEUR(n: number | string | null | undefined): string {
  if (n == null || n === '') return '—';
  const v = Number(n);
  if (isNaN(v)) return '—';
  return v.toLocaleString('en-LU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB');
}
function formatDateTime(s: string): string {
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
