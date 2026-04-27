'use client';

// Stint 56.E — task templates placeholder.
//
// Diego: "ponlo aunque de momento esté vacío, como FATCA/CRS". The
// real implementation (instantiate a set of pre-defined sub-tasks
// with dependencies + deadlines) is a separate stint. This page
// signals the roadmap so Diego sees where it's headed without
// promising delivery.

import Link from 'next/link';
import { ArrowLeftIcon, ClockIcon, FileTextIcon } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';

interface TemplateStub {
  name: string;
  description: string;
  steps: number;
  example: string[];
}

const TEMPLATES: TemplateStub[] = [
  {
    name: 'Onboard SOPARFI',
    description: 'Full set-up of a new Luxembourg SOPARFI client — KYC, notarial deed, registrations, accounting setup, first filing year.',
    steps: 12,
    example: [
      'Receive KYC documentation',
      'Constituer the entity at the notary',
      'Request matricule + RCS number',
      'Request VAT number (if needed)',
      'Setup accounting',
      'First-year CIT filing',
    ],
  },
  {
    name: 'Onboard SCSp / RAIF',
    description: 'Limited partnership / Reserved Alternative Investment Fund onboarding — fund constitution, AIFM appointment, depositary, subscription tax registration.',
    steps: 10,
    example: [
      'KYC + structure approval',
      'Constitute partnership',
      'Register with CSSF (RAIF)',
      'AIFM + depositary appointment',
      'Subscription tax filing setup',
    ],
  },
  {
    name: 'Liquidate entity',
    description: 'Voluntary liquidation cycle — open liquidation, file final returns, pay taxes due, deregister with AED/RCS.',
    steps: 8,
    example: [
      'Resolve dissolution + appoint liquidator',
      'Final CIT + NWT return',
      'Final VAT return + payment',
      'Liquidation accounts',
      'Deregister VAT',
      'Deregister RCS',
    ],
  },
  {
    name: 'First-year CIT filing',
    description: 'Run a CIT 500 from scratch for a new entity — gather TB, classify income, prepare Form 500, partner review, filing.',
    steps: 5,
    example: [
      'Collect trial balance + supporting docs',
      'Classify income / expenses',
      'Draft Form 500',
      'Partner review',
      'File via eCDF',
    ],
  },
  {
    name: 'VAT registration (régime ordinaire)',
    description: 'Register a new entity for Luxembourg VAT — Form 100, intra-EU activation, set up monthly/quarterly cadence.',
    steps: 4,
    example: [
      'Prepare Form 100',
      'Submit + obtain VAT number',
      'Activate intra-EU (VIES)',
      'Configure cadence in cifra',
    ],
  },
  {
    name: 'Cadence change (annual → quarterly)',
    description: 'Move an existing client from annual to quarterly VAT (or vice versa) — notify AED, reconcile, update internal calendar.',
    steps: 3,
    example: [
      'Notify AED via Form 100',
      'Reconcile prior period',
      'Update cifra cadence + notify CSP',
    ],
  },
];

export default function TaskTemplatesPlaceholder() {
  return (
    <div className="space-y-4 max-w-5xl">
      <Link href="/tax-ops/tasks" className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
        <ArrowLeftIcon size={12} /> Back to tasks
      </Link>

      <PageHeader
        title="Task templates"
        subtitle="Re-usable playbooks for the LU compliance workflows that repeat client after client. Click a template, instantiate, and the full sub-task tree appears under one root with deadlines + dependencies pre-wired."
      />

      {/* Status banner — same visual idiom as the FATCA/CRS stub. */}
      <div className="rounded-md border border-amber-300 bg-amber-50/60 px-4 py-3">
        <div className="flex items-start gap-2">
          <ClockIcon size={14} className="mt-0.5 shrink-0 text-amber-700" />
          <div className="text-sm text-amber-900">
            <strong>We&apos;re building this.</strong> The templates below show the
            shapes Diego asked to support; the &quot;instantiate&quot; flow that turns
            them into actual sub-task trees lands in a future stint. For now
            this page is a roadmap signal — kept out of the way of the day-to-day
            tasks list.
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {TEMPLATES.map((t) => (
          <div
            key={t.name}
            className="rounded-md border border-border bg-surface px-4 py-3"
          >
            <div className="flex items-center justify-between gap-2 mb-1">
              <h3 className="text-sm font-semibold text-ink flex items-center gap-1">
                <FileTextIcon size={12} className="text-ink-muted" />
                {t.name}
              </h3>
              <span className="text-2xs text-ink-muted">{t.steps} steps</span>
            </div>
            <p className="text-xs text-ink-muted mb-2">{t.description}</p>
            <details className="text-xs">
              <summary className="cursor-pointer text-ink-muted hover:text-ink">
                Preview steps
              </summary>
              <ol className="mt-1 ml-4 space-y-0.5 list-decimal text-ink">
                {t.example.map((s, i) => <li key={i}>{s}</li>)}
                {t.example.length < t.steps && (
                  <li className="italic text-ink-faint">
                    … {t.steps - t.example.length} more
                  </li>
                )}
              </ol>
            </details>
            <button
              type="button"
              disabled
              className="mt-2 w-full px-2 py-1 text-xs rounded-md border border-border bg-surface-alt text-ink-muted cursor-not-allowed"
              title="Coming soon — instantiation lands in a future stint"
            >
              Instantiate (coming soon)
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
