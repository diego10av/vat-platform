// Landing page — stint 60.C rebuild.
//
// Positioning (Diego, 2026-04-27): "The operating system for private
// capital structures." Diego's evolution of his earlier framing —
// "recurring compliance" was too narrow because it didn't cover the CRM
// module (clients/entities/invoices), so the qualifier was dropped.
// "Private capital structures" stays as the audience anchor.
//
// Drop the Big-4 audience framing — irrelevant to Diego's actual reader
// (fund/structure managers, AIFMs, GPs, family offices, the boutique
// services that support them). No email contact anywhere — Diego doesn't
// want to be reached. Sign-in is the only door.
//
// Three modules surfaced (live today only — no pipeline, no roadmap):
//   • Tax-Ops — every LU filing tracked: VAT (annual/quarterly/monthly),
//     CIT, NWT, subscription tax, WHT (director), BCL. Deadlines + sign-
//     off cascade preparer→reviewer→partner + audit trail.
//   • Classifier — 32+ deterministic rules citing LTVA + CJEU + AED
//     circulars. AI suggests, humans decide, every override logged.
//   • CRM — service providers, end-clients, fund families. Entities
//     (SOPARFIs, AIFMs, SCSps) linked to obligations. Invoice OCR.
//
// Section order (4 sections, ~1 min scroll, Stripe-style):
//   1. Hero — operating-system headline + Sign in CTA
//   2. ThreeModules — Tax-Ops / Classifier / CRM (3-up cards)
//   3. DepthProof — stats grid + 4 CJEU cases
//   4. Footer — Logo + Sign in
//
// Removed vs stint 11: HowItWorks 4-step, Roadmap 10-items grid,
// CTA wall, all mailto contact references, all Big-4 framing.
// The page is noindex/nofollow (see layout.tsx) — fully private even
// when DNS goes live. Sign in is gated by AUTH_PASSWORD.

import Link from 'next/link';
import { Logo } from '@/components/Logo';

// ─────────────────── Section primitives ───────────────────

function Container({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`max-w-[1080px] mx-auto px-6 md:px-10 ${className}`}>
      {children}
    </div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-block text-2xs tracking-[0.18em] uppercase font-semibold text-brand-700">
      {children}
    </div>
  );
}

// ─────────────────── Top nav ───────────────────

function TopNav() {
  // Sign in only — per Diego's stint 60 brief. cifra is closed
  // (single-user dogfooding today, private beta when ready); no
  // public sign-up or "Book a demo" CTA on the nav. The mailto for
  // contact lives only in the footer, deliberately understated.
  return (
    <header className="sticky top-0 z-popover bg-[#FBFAF7]/85 backdrop-blur-md border-b border-[#EFEAE2]">
      <Container className="flex items-center justify-between h-14">
        <Link href="/marketing" aria-label="cifra home" className="hover:opacity-90 transition-opacity">
          <Logo />
        </Link>
        <a
          href="/login"
          className="inline-flex items-center h-9 px-4 rounded-md bg-ink text-white text-sm font-medium hover:bg-ink-soft transition-colors"
        >
          Sign in
          <span aria-hidden className="ml-1.5">→</span>
        </a>
      </Container>
    </header>
  );
}

// ─────────────────── Hero ───────────────────

function Hero() {
  return (
    <section className="pt-16 pb-12 md:pt-24 md:pb-16">
      <Container>
        <div className="max-w-[880px]">
          <Eyebrow>Private capital · Europe</Eyebrow>
          <h1
            className="mt-5 text-[40px] md:text-[60px] leading-[1.04] tracking-[-0.025em] font-semibold text-ink"
          >
            The operating system for
            <br />
            <span className="text-brand-500">private capital structures.</span>
          </h1>
          <p className="mt-6 max-w-[680px] text-lg leading-[1.55] text-ink-soft">
            Compliance, clients, entities, invoices — connected.
            Starting with every Luxembourg tax filing your firm owns:
            VAT, Form 500 (CIT · MBT · NWT), subscription tax, withholding tax.
            Plus BCL reporting to the Banque centrale de Luxembourg.
            Deadlines, sign-off cascade, and audit trail, in one workspace.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-5">
            <a
              href="/login"
              className="inline-flex items-center h-11 px-5 rounded-md bg-ink text-white text-base font-medium hover:bg-ink-soft transition-colors"
            >
              Sign in
              <span aria-hidden className="ml-2">→</span>
            </a>
            <a
              href="#what"
              className="text-base font-medium text-ink-soft hover:text-ink transition-colors underline-offset-4 hover:underline"
            >
              See what cifra does
            </a>
          </div>
          {/* Stint 64.B — small "Made in Luxembourg" badge. Diego asked
              for Factorial-style polish; this anchors the local-first
              identity sutilly without pushing it into the headline. */}
          <div className="mt-6 inline-flex items-center gap-1.5 text-2xs text-ink-faint">
            <span aria-hidden>🇱🇺</span>
            <span>Made in Luxembourg · Built for Europe</span>
          </div>
        </div>
        {/* Stint 64.B — Factorial-inspired product mockup. Browser-frame
            window with a fake Tax-Ops matrix (CIT page) showing real
            visual elements: family chips, status badges, deadlines.
            Compact (~320px tall) so the hero doesn't get longer than the
            "short punchy" stint-60 brief allows. Pure HTML/Tailwind —
            no screenshot dependency, no images to maintain. */}
        <ProductMockup />
      </Container>
    </section>
  );
}

// Stint 64.B — visual mock of the Tax-Ops matrix, rendered as live HTML
// (no image assets). Gives the landing a Factorial/Stripe-style visual
// anchor without requiring real screenshots.
//
// CRITICAL — NEVER use real client / family / entity names from cifra's
// production data here. The landing is publicly reachable (even if
// noindex/nofollow + AUTH_PASSWORD-gated app), so leaking a client name
// is a confidentiality breach. Diego's instruction (stint 64.D, post-
// review): "no pongas nunca información de clientes en la landing
// page a no ser que yo te diga que hay confirmación por su parte
// para eso ser el caso." — All names below are DELIBERATELY GENERIC
// fictional placeholders (Acme / Delta / Riverside / Harbour) with no
// connection to any cifra client. If you ever change this mock, keep
// the same constraint.
function ProductMockup() {
  const rows: Array<{ family: string; tone: string; entity: string; status: string; statusTone: string; deadline: string; deadlineTone: string; partner: string }> = [
    // Stint 64.V.4 — partner column alternates Arturo / Felipe (the
    // two-partner reference example). Diego: "Arturo y Felipe,
    // intercámbianlos como los dos socios en el ejemplo."
    { family: 'ACME',      tone: 'bg-blue-100 text-blue-800',       entity: 'Acme Holdings SARL',         status: 'Filed',          statusTone: 'bg-success-50 text-success-800', deadline: '2026-04-30', deadlineTone: 'text-ink-soft',                 partner: 'Arturo' },
    { family: 'ACME',      tone: 'bg-blue-100 text-blue-800',       entity: 'Acme Sub I SCA',             status: 'Working',        statusTone: 'bg-amber-50 text-amber-800',     deadline: '2026-12-31', deadlineTone: 'text-ink-soft',                 partner: 'Felipe' },
    { family: 'DELTA',     tone: 'bg-emerald-100 text-emerald-800', entity: 'Delta Fund I SCSp',          status: 'Draft sent',     statusTone: 'bg-info-50 text-info-800',       deadline: '2026-12-31', deadlineTone: 'text-ink-soft',                 partner: 'Felipe' },
    { family: 'DELTA',     tone: 'bg-emerald-100 text-emerald-800', entity: 'Delta Co-Invest SCSp',       status: 'Awaiting info',  statusTone: 'bg-amber-50 text-amber-800',     deadline: 'Today',      deadlineTone: 'text-danger-700 font-semibold', partner: 'Arturo' },
    { family: 'RIVERSIDE', tone: 'bg-purple-100 text-purple-800',   entity: 'Riverside Partners II SCSp', status: 'Client approved',statusTone: 'bg-info-50 text-info-800',       deadline: '2026-12-31', deadlineTone: 'text-ink-soft',                 partner: 'Arturo' },
    { family: 'HARBOUR',   tone: 'bg-amber-100 text-amber-800',     entity: 'Harbour Capital SARL',       status: 'Filed',          statusTone: 'bg-success-50 text-success-800', deadline: '2026-04-15', deadlineTone: 'text-ink-soft',                 partner: 'Felipe' },
  ];
  return (
    <div className="mt-12 md:mt-16 mx-auto max-w-[960px]">
      <div className="rounded-xl border border-[#E5DFD7] bg-white shadow-[0_30px_60px_-30px_rgba(20,20,40,0.18)] overflow-hidden">
        {/* Browser frame */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[#EFEAE2] bg-[#F8F5EF]">
          <div className="flex gap-1.5 shrink-0">
            <span className="w-2.5 h-2.5 rounded-full bg-[#FF5F57]" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#FEBC2E]" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#28C840]" />
          </div>
          <div className="flex-1 mx-3 h-6 rounded-md bg-white/70 border border-[#EFEAE2] flex items-center px-2.5 text-2xs text-ink-faint truncate">
            app.cifracompliance.com/tax-ops/cit
          </div>
          <div className="text-2xs text-ink-faint hidden sm:block">cifra</div>
        </div>
        {/* Page header strip */}
        <div className="px-5 py-3 border-b border-[#EFEAE2] flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-ink">Form 500</div>
            <div className="text-2xs text-ink-muted mt-0.5">Annual CIT · MBT · NWT — one return per entity · 6 entities</div>
          </div>
          <div className="hidden md:flex items-center gap-2">
            <div className="text-2xs text-ink-faint px-2 py-1 rounded border border-[#EFEAE2]">2025</div>
            <div className="text-2xs text-white px-2 py-1 rounded bg-brand-500">+ New entity</div>
          </div>
        </div>
        {/* Matrix table mock */}
        <div className="overflow-hidden">
          <table className="w-full text-2xs sm:text-xs">
            <thead className="bg-[#FBFAF7] text-ink-muted">
              <tr>
                <th className="text-left px-3 py-2 font-medium border-b border-[#EFEAE2]">Family</th>
                <th className="text-left px-3 py-2 font-medium border-b border-[#EFEAE2]">Entity</th>
                <th className="text-left px-3 py-2 font-medium border-b border-[#EFEAE2] hidden sm:table-cell">Status 2025</th>
                <th className="text-left px-3 py-2 font-medium border-b border-[#EFEAE2]">Deadline</th>
                <th className="text-left px-3 py-2 font-medium border-b border-[#EFEAE2] hidden md:table-cell">Partner</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-[#EFEAE2] last:border-b-0">
                  <td className="px-3 py-2">
                    <span className={`inline-block px-1.5 py-0.5 rounded text-2xs font-medium ${r.tone}`}>
                      {r.family}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-ink font-medium">{r.entity}</td>
                  <td className="px-3 py-2 hidden sm:table-cell">
                    <span className={`inline-block px-1.5 py-0.5 rounded text-2xs ${r.statusTone}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className={`px-3 py-2 tabular-nums ${r.deadlineTone}`}>{r.deadline}</td>
                  <td className="px-3 py-2 text-ink-soft hidden md:table-cell">{r.partner}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {/* Caption below the mock */}
      <p className="mt-4 text-center text-2xs text-ink-faint">
        Live preview — every column inline-editable, every status changes the deadline rotation,
        every override goes to the audit trail.
      </p>
    </div>
  );
}

// ─────────────────── What cifra does (3 modules) ───────────────────

function ThreeModules() {
  const modules = [
    {
      eyebrow: 'Tax-Ops',
      title: 'Every LU filing in one calendar.',
      body:
        'VAT (annual / quarterly / monthly), Form 500 (CIT + Municipal Business Tax + Net Wealth Tax in one return), subscription tax for UCITS / SIF / RAIF, director WHT — plus BCL reporting to the Banque centrale de Luxembourg, the only non-tax filing tracked here. Deadlines auto-tracked per LTVA article. Sign-off cascade preparer → reviewer → partner with timestamps. Calendar feed for Google, Apple, Outlook.',
      bullets: [
        '7 tax types live, statutory deadlines encoded',
        'Multi-stakeholder sign-off with audit log',
        'Saved views, bulk actions, board / list / calendar',
      ],
    },
    {
      eyebrow: 'Classifier',
      title: 'Built on the law, not on prompts.',
      body:
        '32+ deterministic classification rules, each citing the LTVA article + CJEU case + AED circular that supports it. BlackRock, Fiscale Eenheid X, DBKAG, Polysar, Titanium, Finanzamt T II — encoded, regression-tested, continuously legal-watched against new circulars.',
      bullets: [
        'Deterministic rules engine — no LLM in the hot path',
        'Override log frozen at first classification',
        'Legal-watch flags rules when new case-law lands',
      ],
    },
    {
      eyebrow: 'CRM',
      title: 'Clients, contacts, pipeline — connected.',
      body:
        'Contacts with employment history, companies grouped into families, a unified pipeline from cold prospect through won deal, matters tracked end-to-end with billing in the same workspace. Calendar pulls every CRM date AND every tax-ops deadline so nothing slips. Per-row audit log shows who changed what.',
      bullets: [
        'Employment history preserved when contacts switch firms',
        'Single unified pipeline (no cold/warm vs deal silos)',
        'Calendar unified across CRM + tax-ops + future modules',
      ],
    },
  ];

  return (
    <section id="what" className="py-20 md:py-24 bg-white border-y border-[#EFEAE2]">
      <Container>
        <div className="max-w-[680px] mb-14">
          <Eyebrow>What cifra does today</Eyebrow>
          <h2 className="mt-4 text-[32px] md:text-[40px] leading-[1.08] tracking-[-0.02em] font-semibold text-ink">
            One workspace, three connected modules.
          </h2>
          <p className="mt-5 text-base leading-[1.65] text-ink-soft">
            cifra ships the daily work — tracking, preparing, signing off,
            filing — for the recurring compliance that every private capital
            structure has to do, week after week, year after year.
          </p>
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {modules.map((m) => (
            <article
              key={m.eyebrow}
              className="rounded-xl border border-[#EFEAE2] bg-[#FBFAF7] p-7 flex flex-col"
            >
              <Eyebrow>{m.eyebrow}</Eyebrow>
              <h3 className="mt-3 text-xl font-semibold text-ink leading-snug tracking-tight">
                {m.title}
              </h3>
              <p className="mt-3 text-sm leading-[1.6] text-ink-soft">
                {m.body}
              </p>
              <ul className="mt-5 space-y-2 text-sm">
                {m.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-2 text-ink-soft">
                    <span
                      aria-hidden
                      className="mt-1.5 inline-block w-1 h-1 rounded-full bg-brand-500 shrink-0"
                    />
                    <span className="leading-snug">{b}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </Container>
    </section>
  );
}

// ─────────────────── Depth (stats + AI multiplier + practitioners) ───────────────────
//
// Stint 60.D — Diego on case law: "lo del case law no me va mucho […] los
// case law mehh ademas no son ni actuales." Replaced the 4-CJEU-case panel
// with two compact sub-blocks: AI as multiplier (3 concrete ways AI
// accelerates the existing work) + Built by practitioners (one-line
// credibility statement, no Big-4 framing, no personal branding).

function StatCell({ value, label }: { value: string; label: string }) {
  return (
    <div className="bg-white p-6 md:p-7">
      <div className="text-[34px] md:text-[40px] leading-none font-semibold text-ink tracking-tight tabular-nums">
        {value}
      </div>
      <div className="mt-2 text-sm leading-snug text-ink-soft">{label}</div>
    </div>
  );
}

function AIBullet({ title, body }: { title: string; body: string }) {
  return (
    <li className="flex items-start gap-3">
      <span
        aria-hidden
        className="mt-1.5 inline-block w-1.5 h-1.5 rounded-full bg-brand-500 shrink-0"
      />
      <span className="block">
        <span className="block text-base font-semibold text-ink leading-snug">
          {title}
        </span>
        <span className="block mt-1 text-sm leading-[1.55] text-ink-soft">
          {body}
        </span>
      </span>
    </li>
  );
}

function Depth() {
  return (
    <section className="py-20 md:py-24">
      <Container>
        <div className="grid md:grid-cols-12 gap-10 items-start">
          <div className="md:col-span-5">
            <Eyebrow>The depth</Eyebrow>
            <h2 className="mt-4 text-[32px] md:text-[40px] leading-[1.08] tracking-[-0.02em] font-semibold text-ink">
              Numbers, not promises.
            </h2>
            <p className="mt-5 text-base leading-[1.65] text-ink-soft">
              cifra treats Luxembourg tax like a first-class engineering
              discipline. Every rule is regression-tested. Every legal
              source has a review date. Every AI decision is logged.
            </p>
          </div>

          <div className="md:col-span-7">
            <dl className="grid grid-cols-2 gap-px bg-[#EFEAE2] rounded-xl overflow-hidden border border-[#EFEAE2]">
              <StatCell value="32+" label="classification rules · each citing LTVA + CJEU + circular" />
              <StatCell value="100+" label="legal sources tracked, with review dates" />
              <StatCell value="700+" label="regression tests · run on every commit" />
              <StatCell value="10 yr" label="retention-ready audit trail · AED-defensible" />
            </dl>
          </div>
        </div>

        {/* Two sub-blocks: AI as multiplier + Built by practitioners. */}
        <div className="mt-14 grid md:grid-cols-5 gap-6">
          {/* Sub-block A — AI as multiplier */}
          <div className="md:col-span-3 rounded-xl border border-[#EFEAE2] bg-[#FBFAF7] px-6 md:px-8 py-7">
            <Eyebrow>How AI fits in</Eyebrow>
            <h3 className="mt-3 text-xl font-semibold text-ink leading-snug tracking-tight">
              AI never decides. It accelerates.
            </h3>
            <p className="mt-3 text-sm leading-[1.6] text-ink-soft">
              cifra uses Anthropic Claude to remove three specific kinds
              of friction from a filing day. Every output goes back to a
              human; every override is logged.
            </p>
            <ul className="mt-5 space-y-4">
              <AIBullet
                title="Invoice OCR"
                body="Extracts vendor, VAT number, and amount from PDFs in seconds. Replaces the copy-paste from invoice to spreadsheet that swallows the first hour of every quarter."
              />
              <AIBullet
                title="Classification suggestion"
                body="Claude proposes a treatment code with the LTVA article and CJEU case that supports it. The reviewer accepts it with a click — or overrides it, in which case the override is frozen in the audit log."
              />
              <AIBullet
                title="Validator second-opinion"
                body="A second model reviews the full classified return before filing and flags critical / high / medium issues with citations. A second pair of eyes that never gets tired and never goes on holiday."
              />
            </ul>
          </div>

          {/* Sub-block B — Built by practitioners */}
          <div className="md:col-span-2 rounded-xl border border-[#EFEAE2] bg-[#FBFAF7] px-6 md:px-8 py-7 flex flex-col">
            <Eyebrow>Who builds cifra</Eyebrow>
            <h3 className="mt-3 text-xl font-semibold text-ink leading-snug tracking-tight">
              Built by practitioners, not consultants.
            </h3>
            <p className="mt-4 text-base leading-[1.6] text-ink-soft">
              cifra is built by people who file these returns themselves.
              Every feature comes from a real filing day, not a workshop
              whiteboard.
            </p>
            <p className="mt-4 text-sm leading-[1.6] text-ink-muted">
              That is why the LTVA citations are accurate, the deadlines
              match what AED actually expects, and the sign-off cascade
              looks like the way real engagements run.
            </p>
          </div>
        </div>
      </Container>
    </section>
  );
}

// ─────────────────── Footer ───────────────────

function Footer() {
  return (
    <footer className="border-t border-[#EFEAE2]">
      <Container className="py-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Logo />
          <span className="text-sm text-ink-muted">· Luxembourg</span>
        </div>
        <Link href="/login" className="text-sm text-ink-muted hover:text-ink transition-colors">
          Sign in
        </Link>
      </Container>
    </footer>
  );
}

// ─────────────────── Page ───────────────────

export default function MarketingHome() {
  return (
    <>
      <TopNav />
      <main>
        <Hero />
        <ThreeModules />
        <Depth />
      </main>
      <Footer />
    </>
  );
}
