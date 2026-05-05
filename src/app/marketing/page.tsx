// ════════════════════════════════════════════════════════════════════════
// Landing page at cifracompliance.com (root domain).
//
// Diego (2026-05-05): "haz algo más digno del software que estamos
// construyendo". Substantial redesign over the placeholder landing —
// proper typographic hierarchy with the serif Newsreader for hero +
// sub-headers, a richer "three modules" grid with icons that mirror
// the sidebar, and a "what makes it different" section that surfaces
// the actual product moat (deterministic classifier + LTVA/CJEU
// citations + audit log).
//
// Still dogfood-only: noindex/nofollow at the layout level. No
// tracking, no analytics, no contact form.
// ════════════════════════════════════════════════════════════════════════

import {
  ReceiptIcon, BarChart3Icon, BriefcaseIcon, ArrowRightIcon,
  ScrollTextIcon, ScaleIcon, ShieldCheckIcon,
} from 'lucide-react';
import { Logo } from '@/components/Logo';

const APP_LOGIN_URL = 'https://app.cifracompliance.com/login';

export default function MarketingPage() {
  return (
    <main className="min-h-screen bg-canvas text-ink">
      {/* ─── Top nav ─────────────────────────────────────────────── */}
      <header className="border-b border-divider bg-surface/70 backdrop-blur-sm sticky top-0 z-popover">
        <div className="max-w-[1100px] mx-auto px-6 h-14 flex items-center justify-between">
          <Logo />
          <a
            href={APP_LOGIN_URL}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-sm font-medium text-ink-soft hover:text-ink hover:bg-surface-alt transition-colors"
          >
            Sign in
            <ArrowRightIcon size={13} />
          </a>
        </div>
      </header>

      {/* ─── Hero ────────────────────────────────────────────────── */}
      <section>
        <div className="max-w-[1100px] mx-auto px-6 pt-24 pb-20 md:pt-32 md:pb-28">
          <div className="max-w-[820px]">
            <h1
              className="font-serif text-[44px] md:text-[58px] leading-[1.05] font-medium tracking-tight text-ink"
              style={{ letterSpacing: '-0.02em' }}
            >
              Luxembourg tax compliance,
              <br />
              <span className="text-ink-soft italic">built law-first.</span>
            </h1>
            <p className="mt-7 text-lg md:text-xl text-ink-soft max-w-2xl leading-relaxed">
              AI reads invoices and AED letters. A deterministic classifier with
              LTVA and CJEU citations turns them into eCDF-ready returns. Every
              override is audit-logged with the article that justified it.
            </p>
            <div className="mt-10 flex items-center gap-4">
              <a
                href={APP_LOGIN_URL}
                className="inline-flex items-center gap-2 h-11 px-5 rounded-md bg-brand-500 text-white text-sm font-semibold hover:bg-brand-600 transition-colors shadow-sm"
              >
                Sign in
                <ArrowRightIcon size={15} />
              </a>
              <span className="text-2xs uppercase tracking-wider text-ink-faint font-semibold">
                Single workspace · three modules
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Three modules ──────────────────────────────────────── */}
      <section className="border-t border-divider bg-surface">
        <div className="max-w-[1100px] mx-auto px-6 py-20 md:py-24">
          <div className="mb-10">
            <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-accent-600 mb-3">
              Three modules. One workspace.
            </p>
            <h2 className="font-serif text-3xl md:text-4xl font-medium text-ink leading-tight max-w-[640px]" style={{ letterSpacing: '-0.015em' }}>
              Designed for the way a Luxembourg professional&nbsp;works.
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <ModuleCard
              icon={<ReceiptIcon size={22} />}
              title="VAT"
              tagline="Invoices to eCDF"
              blurb="Receipt extraction, deterministic classifier with 32+ rules, EC Sales List, AED letter ingestion. Every line cites the article that justified it."
            />
            <ModuleCard
              icon={<BarChart3Icon size={22} />}
              title="Tax-Ops"
              tagline="Compliance tracker"
              blurb="One matrix per obligation: CIT, NWT, WHT, BCL, subscription tax, FATCA / CRS. Status, deadlines, sign-off, audit trail — replaces a stack of spreadsheets."
            />
            <ModuleCard
              icon={<BriefcaseIcon size={22} />}
              title="CRM"
              tagline="Your professional book"
              blurb="Companies, contacts, matters, opportunities, tasks, billing. Built for the way a Luxembourg professional manages their portfolio — not adapted from a sales CRM."
            />
          </div>
        </div>
      </section>

      {/* ─── Why it's different ─────────────────────────────────── */}
      <section className="border-t border-divider">
        <div className="max-w-[1100px] mx-auto px-6 py-20 md:py-24">
          <div className="mb-12 max-w-[640px]">
            <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-accent-600 mb-3">
              What makes it different
            </p>
            <h2 className="font-serif text-3xl md:text-4xl font-medium text-ink leading-tight" style={{ letterSpacing: '-0.015em' }}>
              Built around the law, not&nbsp;the&nbsp;form.
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-x-10 gap-y-12">
            <DifferentiatorPoint
              icon={<ScrollTextIcon size={20} />}
              title="LTVA + CJEU citations on every line"
              body="Every classification carries the article and the case law that justifies it. Audit-ready by construction; the audit trail writes itself."
            />
            <DifferentiatorPoint
              icon={<ScaleIcon size={20} />}
              title="Deterministic classifier"
              body="32+ explicit rules — not a black-box LLM call. Predictable, reviewable, regression-tested against a 60-fixture synthetic corpus."
            />
            <DifferentiatorPoint
              icon={<ShieldCheckIcon size={20} />}
              title="Frozen AI suggestions, audit log"
              body="The AI's first proposal is captured at intake, never overwritten. Every reviewer override becomes a defensible event in the audit trail."
            />
          </div>
        </div>
      </section>

      {/* ─── Footer ─────────────────────────────────────────────── */}
      <footer className="border-t border-divider bg-surface">
        <div className="max-w-[1100px] mx-auto px-6 py-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <Logo />
          <a
            href={APP_LOGIN_URL}
            className="text-sm text-ink-muted hover:text-ink transition-colors inline-flex items-center gap-1.5"
          >
            Sign in
            <ArrowRightIcon size={13} />
          </a>
        </div>
        <div className="max-w-[1100px] mx-auto px-6 pb-6 text-2xs text-ink-faint">
          cifracompliance.com · Luxembourg
        </div>
      </footer>
    </main>
  );
}

// ─── Sub-components ─────────────────────────────────────────────

function ModuleCard({
  icon, title, tagline, blurb,
}: {
  icon: React.ReactNode;
  title: string;
  tagline: string;
  blurb: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-6 hover:border-border-strong transition-colors">
      <div className="inline-flex w-11 h-11 items-center justify-center rounded-lg bg-brand-50 text-brand-700 mb-4">
        {icon}
      </div>
      <div className="text-2xs uppercase tracking-wider text-ink-faint font-semibold mb-1">
        {tagline}
      </div>
      <h3 className="font-serif text-2xl font-medium text-ink mb-3 leading-tight">{title}</h3>
      <p className="text-sm text-ink-muted leading-relaxed">{blurb}</p>
    </div>
  );
}

function DifferentiatorPoint({
  icon, title, body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div>
      <div className="inline-flex w-9 h-9 items-center justify-center rounded-md bg-accent-50 text-accent-600 mb-4">
        {icon}
      </div>
      <h3 className="text-base font-semibold text-ink leading-snug mb-2">{title}</h3>
      <p className="text-sm text-ink-muted leading-relaxed">{body}</p>
    </div>
  );
}
