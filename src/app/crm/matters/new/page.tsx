'use client';

// ════════════════════════════════════════════════════════════════════════
// /crm/matters/new — Four-step matter intake wizard.
//
// Why not a modal? Conflict-check is high-stakes enough that the user
// should see it in full; cramming four steps into a dialog degrades
// both readability and the "pause here, think" moment at Step 4.
//
// Flow:
//   1. Parties — which client, who's the primary contact, who's the
//      counterparty, any related parties we should flag
//   2. Scope — title, practice areas, fee type, rate + budget + cap
//   3. Team — lead counsel + team members (free-text today; junction
//      table deferred to post-signal stint per stint-31 plan)
//   4. Conflict check — embeds the existing ConflictCheckPanel.
//      Issuing a matter against active conflicts requires an explicit
//      acknowledgement ("I'll document the waiver") to prevent a
//      silent mis-open.
//
// Quick-add (CrmFormModal) still exists on the list page for importing
// historic matters where the conflict-check gate doesn't apply.
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeftIcon, ChevronRightIcon, CheckCircle2Icon, AlertTriangleIcon, ShieldCheckIcon } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/Toaster';

interface Company {
  id: string;
  company_name: string;
  classification?: string | null;
}

interface Contact {
  id: string;
  full_name: string;
  email?: string | null;
}

interface ConflictHit {
  matter_id: string;
  matter_reference: string;
  status: string;
  field: 'client' | 'counterparty' | 'related';
  party: string;
  match_value: string;
  client_name: string | null;
}

interface ConflictResult {
  checked_at: string;
  hits: ConflictHit[];
  false_positive_ids?: string[];
}

const PRACTICE_AREAS = [
  { value: 'real_estate',     label: 'Real Estate' },
  { value: 'litigation',      label: 'Litigation' },
  { value: 'employment',      label: 'Employment' },
  { value: 'fund_regulatory', label: 'Fund/Regulatory' },
  { value: 'tax',             label: 'Tax' },
  { value: 'm_a',             label: 'M&A' },
];
const FEE_TYPES = [
  { value: 'retainer',    label: 'Retainer' },
  { value: 'success_fee', label: 'Success fee' },
  { value: 'fixed_fee',   label: 'Fixed fee' },
  { value: 'hourly',      label: 'Hourly' },
];

export default function MatterIntakePage() {
  const router = useRouter();
  const toast = useToast();

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // Step 1 — Parties
  const [companies, setCompanies] = useState<Company[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [clientCompanyId, setClientCompanyId] = useState('');
  const [primaryContactId, setPrimaryContactId] = useState('');
  const [counterpartyName, setCounterpartyName] = useState('');
  const [relatedPartiesRaw, setRelatedPartiesRaw] = useState(''); // one per line

  // Step 2 — Scope
  const [title, setTitle] = useState('');
  const [practiceAreas, setPracticeAreas] = useState<string[]>([]);
  const [feeType, setFeeType] = useState('');
  const [hourlyRateEur, setHourlyRateEur] = useState('');
  const [estimatedBudgetEur, setEstimatedBudgetEur] = useState('');
  const [capEur, setCapEur] = useState('');

  // Step 3 — Team
  const [leadCounsel, setLeadCounsel] = useState('');
  const [teamMembersRaw, setTeamMembersRaw] = useState(''); // comma or newline

  // Step 4 — Conflict check
  const [conflictResult, setConflictResult] = useState<ConflictResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  const [submitting, setSubmitting] = useState(false);

  // Load companies (once).
  useEffect(() => {
    fetch('/api/crm/companies?limit=500', { cache: 'no-store' })
      .then(r => r.json())
      .then((rows: Company[]) => setCompanies(rows ?? []))
      .catch(() => setCompanies([]));
  }, []);

  // Load contacts for the chosen company.
  useEffect(() => {
    if (!clientCompanyId) { setContacts([]); setPrimaryContactId(''); return; }
    fetch(`/api/crm/companies/${clientCompanyId}`, { cache: 'no-store' })
      .then(r => r.json())
      .then((body: { contacts?: Contact[] }) => setContacts(body.contacts ?? []))
      .catch(() => setContacts([]));
  }, [clientCompanyId]);

  const relatedParties = relatedPartiesRaw.split(/\n/).map(s => s.trim()).filter(Boolean);
  const teamMembers = teamMembersRaw.split(/[\n,]/).map(s => s.trim()).filter(Boolean);
  const activeHits = (conflictResult?.hits ?? []).filter(
    h => !(conflictResult?.false_positive_ids ?? []).includes(`${h.matter_id}:${h.field}:${h.party}`),
  );

  // Step gates.
  const step1Valid = !!clientCompanyId;
  const step2Valid = title.trim().length > 0;
  // Step 3 is always valid (team is optional).
  const canSubmit =
    step1Valid && step2Valid && !!conflictResult &&
    (activeHits.length === 0 || acknowledged);

  async function runConflictCheck() {
    setScanning(true);
    try {
      const clientName = companies.find(c => c.id === clientCompanyId)?.company_name ?? null;
      const res = await fetch('/api/crm/matters/conflict-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_company_id: clientCompanyId || null,
          client_name: clientName,
          counterparty_name: counterpartyName || null,
          related_parties: relatedParties,
        }),
      });
      if (!res.ok) { toast.error('Conflict scan failed'); return; }
      const body = await res.json();
      setConflictResult({
        checked_at: body.checked_at ?? new Date().toISOString(),
        hits: body.hits ?? [],
        false_positive_ids: [],
      });
      if ((body.hits ?? []).length === 0) toast.success('Clean — no matches');
      else toast.info(`${body.hits.length} potential conflict${body.hits.length === 1 ? '' : 's'} — review below`);
    } finally { setScanning(false); }
  }

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/crm/matters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          client_company_id: clientCompanyId,
          primary_contact_id: primaryContactId || null,
          counterparty_name: counterpartyName || null,
          related_parties: relatedParties,
          practice_areas: practiceAreas,
          fee_type: feeType || null,
          hourly_rate_eur: hourlyRateEur ? Number(hourlyRateEur) : null,
          estimated_budget_eur: estimatedBudgetEur ? Number(estimatedBudgetEur) : null,
          cap_eur: capEur ? Number(capEur) : null,
          lead_counsel: leadCounsel || null,
          team_members: teamMembers,
          conflict_check_done: true,
          conflict_check_date: new Date().toISOString().slice(0, 10),
          conflict_check_result: conflictResult,
          status: 'active',
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err?.error?.message ?? `Create failed (${res.status})`);
        return;
      }
      const body = await res.json();
      toast.success(`Matter ${body.matter_reference} opened`);
      router.push(`/crm/matters/${body.id}`);
    } finally { setSubmitting(false); }
  }

  return (
    <div className="max-w-[820px]">
      <div className="text-[11.5px] text-ink-muted mb-2">
        <Link href="/crm/matters" className="hover:underline">← All matters</Link>
      </div>
      <PageHeader
        title="Open a matter"
        subtitle="4 steps · parties, scope, team, conflict check"
      />

      <StepIndicator step={step} onJump={setStep} disabled={{ 2: !step1Valid, 3: !step1Valid || !step2Valid, 4: !step1Valid || !step2Valid }} />

      {step === 1 && (
        <StepCard title="Parties" blurb="Who's the client, who's on the other side, any related names to flag.">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Client company *">
              <select
                value={clientCompanyId}
                onChange={e => setClientCompanyId(e.target.value)}
                className="w-full h-9 px-2.5 text-[13px] border border-border rounded-md bg-white"
              >
                <option value="">Select a company…</option>
                {companies.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.company_name}{c.classification ? ` · ${c.classification}` : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Primary contact">
              <select
                value={primaryContactId}
                onChange={e => setPrimaryContactId(e.target.value)}
                disabled={!clientCompanyId}
                className="w-full h-9 px-2.5 text-[13px] border border-border rounded-md bg-white disabled:opacity-50"
              >
                <option value="">—</option>
                {contacts.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.full_name}{c.email ? ` · ${c.email}` : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Counterparty name">
              <input
                value={counterpartyName}
                onChange={e => setCounterpartyName(e.target.value)}
                placeholder="Other side (target, fund, individual)"
                className="w-full h-9 px-2.5 text-[13px] border border-border rounded-md"
              />
            </Field>
            <div className="md:col-span-2">
              <Field label="Related parties (one per line)">
                <textarea
                  value={relatedPartiesRaw}
                  onChange={e => setRelatedPartiesRaw(e.target.value)}
                  rows={3}
                  placeholder={'Silent partner SCS\nTarget fund manager Ltd\nAdvising bank'}
                  className="w-full px-2.5 py-2 text-[13px] border border-border rounded-md resize-y"
                />
              </Field>
              <p className="text-[10.5px] text-ink-muted italic mt-1">
                All of these names are scanned against open/on-hold matters in Step 4.
              </p>
            </div>
          </div>
        </StepCard>
      )}

      {step === 2 && (
        <StepCard title="Scope" blurb="Title, practice areas, fee structure, budget + cap.">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="md:col-span-2">
              <Field label="Matter title *">
                <input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="E.g. Project Atlas — fund launch Luxembourg RAIF"
                  className="w-full h-9 px-2.5 text-[13px] border border-border rounded-md"
                />
              </Field>
            </div>
            <div className="md:col-span-2">
              <Field label="Practice areas">
                <div className="flex flex-wrap gap-1.5">
                  {PRACTICE_AREAS.map(p => {
                    const isOn = practiceAreas.includes(p.value);
                    return (
                      <button
                        key={p.value}
                        type="button"
                        onClick={() => setPracticeAreas(ps =>
                          ps.includes(p.value) ? ps.filter(x => x !== p.value) : [...ps, p.value],
                        )}
                        className={`h-7 px-2.5 text-[11.5px] rounded-md border transition-colors ${
                          isOn
                            ? 'bg-brand-50 border-brand-300 text-brand-800 font-medium'
                            : 'bg-white border-border text-ink-muted hover:border-border-strong'
                        }`}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </Field>
            </div>
            <Field label="Fee type">
              <select
                value={feeType}
                onChange={e => setFeeType(e.target.value)}
                className="w-full h-9 px-2.5 text-[13px] border border-border rounded-md bg-white"
              >
                <option value="">—</option>
                {FEE_TYPES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </Field>
            <Field label="Hourly rate (€/h)">
              <input
                type="number"
                step="0.01"
                value={hourlyRateEur}
                onChange={e => setHourlyRateEur(e.target.value)}
                placeholder="400"
                className="w-full h-9 px-2.5 text-[13px] border border-border rounded-md tabular-nums"
              />
            </Field>
            <Field label="Estimated budget (€)">
              <input
                type="number"
                step="0.01"
                value={estimatedBudgetEur}
                onChange={e => setEstimatedBudgetEur(e.target.value)}
                placeholder="25000"
                className="w-full h-9 px-2.5 text-[13px] border border-border rounded-md tabular-nums"
              />
            </Field>
            <Field label="Hard cap (€)">
              <input
                type="number"
                step="0.01"
                value={capEur}
                onChange={e => setCapEur(e.target.value)}
                placeholder="35000"
                className="w-full h-9 px-2.5 text-[13px] border border-border rounded-md tabular-nums"
              />
            </Field>
            <div className="md:col-span-2">
              <p className="text-[10.5px] text-ink-muted italic">
                Setting an estimated budget enables 75/90/100% auto-alerts on time entries. The cap triggers a warning when
                within 10% of breach.
              </p>
            </div>
          </div>
        </StepCard>
      )}

      {step === 3 && (
        <StepCard title="Team" blurb="Who's leading and who's contributing. Optional.">
          <div className="grid grid-cols-1 gap-3">
            <Field label="Lead counsel">
              <input
                value={leadCounsel}
                onChange={e => setLeadCounsel(e.target.value)}
                placeholder="Diego González Manso"
                className="w-full h-9 px-2.5 text-[13px] border border-border rounded-md"
              />
            </Field>
            <Field label="Team members (comma- or newline-separated)">
              <textarea
                value={teamMembersRaw}
                onChange={e => setTeamMembersRaw(e.target.value)}
                rows={3}
                placeholder={'Associate A\nParalegal B\nExternal tax counsel C'}
                className="w-full px-2.5 py-2 text-[13px] border border-border rounded-md resize-y"
              />
            </Field>
            <p className="text-[10.5px] text-ink-muted italic">
              Stored as a plain list today. Role + fee-share attribution comes with the team-members junction table (deferred
              per stint 31 plan).
            </p>
          </div>
        </StepCard>
      )}

      {step === 4 && (
        <StepCard title="Conflict check" blurb="Scan the parties above against existing open/on-hold matters.">
          {!conflictResult && (
            <div className="text-center py-6">
              <ShieldCheckIcon size={28} className="mx-auto text-ink-muted mb-2" />
              <p className="text-[13px] text-ink mb-1">Ready to scan.</p>
              <p className="text-[11.5px] text-ink-muted mb-4">
                Will check <strong>{companies.find(c => c.id === clientCompanyId)?.company_name ?? '—'}</strong>
                {counterpartyName && <>, <strong>{counterpartyName}</strong></>}
                {relatedParties.length > 0 && <>, + {relatedParties.length} related part{relatedParties.length === 1 ? 'y' : 'ies'}</>}
                {' '}against every non-closed matter.
              </p>
              <Button variant="primary" size="sm" onClick={runConflictCheck} loading={scanning}>
                Run conflict check
              </Button>
            </div>
          )}
          {conflictResult && activeHits.length === 0 && (
            <div className="p-4 bg-emerald-50 border border-emerald-300 rounded-md">
              <p className="text-[13px] text-emerald-800 font-semibold flex items-center gap-2">
                <CheckCircle2Icon size={15} />
                Clean — no potential conflicts with existing open matters.
              </p>
              <p className="text-[11.5px] text-emerald-700 mt-1">Safe to open this matter.</p>
            </div>
          )}
          {conflictResult && activeHits.length > 0 && (
            <div>
              <div className="p-3 bg-danger-50 border border-danger-300 rounded-md mb-3">
                <p className="text-[13px] text-danger-800 font-semibold flex items-center gap-2">
                  <AlertTriangleIcon size={15} />
                  {activeHits.length} potential conflict{activeHits.length === 1 ? '' : 's'} found
                </p>
                <p className="text-[11.5px] text-danger-700 mt-1">
                  Review each before proceeding. If you believe it&apos;s a false positive, document the waiver outside this
                  tool (engagement letter clause, client consent email) before acknowledging.
                </p>
              </div>
              <ul className="space-y-1.5 mb-3">
                {activeHits.map(h => (
                  <li key={`${h.matter_id}:${h.field}:${h.party}`} className="border border-border rounded-md px-3 py-2 text-[12px]">
                    <div className="font-mono text-[11px] text-brand-700">{h.matter_reference}</div>
                    {h.client_name && <span className="text-[11px] text-ink-muted">· {h.client_name}</span>}
                    <div className="text-[11px] text-ink-muted mt-0.5">
                      <strong>{h.field}</strong> matched <em>&ldquo;{h.party}&rdquo;</em> via <em>&ldquo;{h.match_value}&rdquo;</em>
                    </div>
                  </li>
                ))}
              </ul>
              <label className="flex items-start gap-2 p-3 border border-border rounded-md bg-white cursor-pointer">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={e => setAcknowledged(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-brand-500"
                />
                <span className="text-[12px] text-ink">
                  I acknowledge these conflicts and have documented a waiver (or these are false positives). Opening the
                  matter anyway.
                </span>
              </label>
            </div>
          )}
          {conflictResult && (
            <div className="mt-3 text-right">
              <button onClick={runConflictCheck} disabled={scanning} className="text-[11.5px] text-brand-700 hover:underline disabled:opacity-50">
                Re-run scan
              </button>
            </div>
          )}
        </StepCard>
      )}

      {/* Navigation */}
      <div className="mt-5 flex items-center justify-between">
        <div>
          {step > 1 && (
            <button
              onClick={() => setStep(s => Math.max(1, s - 1) as 1 | 2 | 3 | 4)}
              className="inline-flex items-center gap-1 h-9 px-3 rounded-md border border-border bg-white text-[13px] text-ink-soft hover:bg-surface-alt"
            >
              <ChevronLeftIcon size={14} />
              Back
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {step < 4 && (
            <Button
              variant="primary"
              size="md"
              onClick={() => setStep(s => Math.min(4, s + 1) as 1 | 2 | 3 | 4)}
              disabled={
                (step === 1 && !step1Valid) ||
                (step === 2 && !step2Valid)
              }
              icon={<ChevronRightIcon size={14} />}
            >
              Next
            </Button>
          )}
          {step === 4 && (
            <Button
              variant="primary"
              size="md"
              onClick={submit}
              loading={submitting}
              disabled={!canSubmit}
            >
              Open matter
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function StepIndicator({
  step, onJump, disabled,
}: {
  step: 1 | 2 | 3 | 4;
  onJump: (s: 1 | 2 | 3 | 4) => void;
  disabled: { 2?: boolean; 3?: boolean; 4?: boolean };
}) {
  const labels: Array<{ n: 1 | 2 | 3 | 4; label: string }> = [
    { n: 1, label: 'Parties' },
    { n: 2, label: 'Scope' },
    { n: 3, label: 'Team' },
    { n: 4, label: 'Conflict check' },
  ];
  return (
    <div className="flex items-center gap-1 mb-5">
      {labels.map((l, i) => {
        const isActive = l.n === step;
        const isPast = l.n < step;
        const isLocked = !!disabled[l.n as 2 | 3 | 4];
        return (
          <div key={l.n} className="flex items-center">
            <button
              type="button"
              onClick={() => !isLocked && onJump(l.n)}
              disabled={isLocked}
              className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[11.5px] font-semibold transition-colors ${
                isActive
                  ? 'bg-brand-600 text-white'
                  : isPast
                    ? 'bg-brand-50 text-brand-800 hover:bg-brand-100'
                    : isLocked
                      ? 'bg-surface-alt text-ink-muted/60 cursor-not-allowed'
                      : 'bg-white border border-border text-ink-soft hover:bg-surface-alt'
              }`}
            >
              <span className="tabular-nums">{l.n}</span>
              <span>{l.label}</span>
            </button>
            {i < labels.length - 1 && <div className="w-6 h-px bg-border mx-1" />}
          </div>
        );
      })}
    </div>
  );
}

function StepCard({ title, blurb, children }: { title: string; blurb: string; children: React.ReactNode }) {
  return (
    <section className="border border-border rounded-lg bg-white p-5">
      <h2 className="text-[14px] font-semibold text-ink mb-0.5">{title}</h2>
      <p className="text-[11.5px] text-ink-muted mb-4">{blurb}</p>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-wide font-semibold text-ink-muted mb-1">{label}</label>
      {children}
    </div>
  );
}
