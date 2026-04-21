// Landing page — first-class / top-tier build.
//
// Design brief (Diego, 2026-04-19): Factorial + Linear + Veeva + Stripe
// blend. Vertical gravitas. Substance density. Specific CJEU case names
// on the home page because nobody else can. No company name in the
// header. No About us. No team. No marketing chatbot. One humble CTA.
//
// The copy anchors live in docs/positioning.md §Landing page.
//
// Important (stint 11): the exact wording + ordering of sections is
// optimised for the 20-second read of a Big-4 VAT partner. Every line
// earns its place against the "would Peter Gassner put this on veeva.com?"
// test. If a future pass wants to add a section, first ask "does this
// change what a 20-second reader takes away?" — if no, don't add it.

import Link from 'next/link';

// ─────────────────── Section primitives ───────────────────

function Container({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`max-w-[1180px] mx-auto px-6 md:px-10 ${className}`}>
      {children}
    </div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-block text-[11px] tracking-[0.16em] uppercase font-semibold text-brand-700">
      {children}
    </div>
  );
}

function CifraWordmark() {
  // Handmade — matches the product's Logo component but at landing scale.
  return (
    <span className="inline-flex items-center gap-1.5 font-medium text-ink text-[19px] tracking-tight">
      <span className="block w-[10px] h-[10px] rounded-full bg-brand-500" aria-hidden />
      cifra
    </span>
  );
}

// ─────────────────── Top nav ───────────────────

function TopNav() {
  // Login routing: on the root domain (cifracompliance.com), the
  // middleware automatically redirects /login to app.cifracompliance.com/login.
  // On the app subdomain / local dev, /login is served directly. So a
  // single href="/login" works everywhere. Using <a> instead of Next's
  // <Link> because a subdomain jump bypasses client-side routing anyway.
  return (
    <header className="sticky top-0 z-30 bg-[#FBFAF7]/75 backdrop-blur-md border-b border-[#EFEAE2]">
      <Container className="flex items-center justify-between h-14">
        <Link href="/marketing" className="flex items-center" aria-label="cifra home">
          <CifraWordmark />
        </Link>
        <nav className="flex items-center gap-6 md:gap-7">
          <a
            href="#product"
            className="hidden md:inline-block text-[13px] text-ink-soft hover:text-ink transition-colors"
          >
            Product
          </a>
          <a
            href="#depth"
            className="hidden md:inline-block text-[13px] text-ink-soft hover:text-ink transition-colors"
          >
            Depth
          </a>
          <a
            href="#roadmap"
            className="hidden md:inline-block text-[13px] text-ink-soft hover:text-ink transition-colors"
          >
            Roadmap
          </a>
          {/* Divider hidden on mobile so nav items don't collide with the CTA cluster. */}
          <span aria-hidden className="hidden md:inline-block h-5 w-px bg-[#EFEAE2]" />
          <a
            href="/login"
            className="inline-flex items-center text-[13px] font-medium text-ink-soft hover:text-ink transition-colors group"
          >
            Sign in
            <span
              aria-hidden
              className="ml-1 inline-block transition-transform group-hover:translate-x-0.5"
            >
              →
            </span>
          </a>
          <a
            href="mailto:contact@cifracompliance.com"
            className="inline-flex items-center h-8 px-3.5 rounded-md bg-ink text-white text-[13px] font-medium hover:bg-ink-soft transition-colors"
          >
            Get in touch
          </a>
        </nav>
      </Container>
    </header>
  );
}

// ─────────────────── Hero ───────────────────

function Hero() {
  return (
    <section className="pt-24 pb-20 md:pt-32 md:pb-28">
      <Container>
        <Eyebrow>Vertical. Luxembourg. Tax.</Eyebrow>
        <h1
          className="mt-5 text-[44px] md:text-[68px] leading-[1.02] tracking-[-0.03em] font-semibold text-ink"
          style={{ fontFamily: 'var(--font-sans)' }}
        >
          Luxembourg tax compliance,
          <br />
          <span className="text-brand-500">rebuilt from the law up.</span>
        </h1>
        <p className="mt-7 max-w-[640px] text-[19px] md:text-[20px] leading-[1.55] text-ink-soft">
          cifra prepares VAT returns for fund entities in minutes, with
          the classifier depth a Magic Circle partner would sign off on.
          Starting with VAT. Built for every LU filing your firm owns.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-6">
          <a
            href="mailto:contact@cifracompliance.com?subject=cifra%20demo%20request"
            className="inline-flex items-center h-11 px-5 rounded-md bg-ink text-white text-[14px] font-medium hover:bg-ink-soft transition-colors"
          >
            Request a private demo
            <span className="ml-2" aria-hidden>→</span>
          </a>
          <a
            href="#depth"
            className="inline-flex items-center text-[14px] font-medium text-ink underline underline-offset-4 decoration-[1.5px] hover:text-brand-600 transition-colors"
          >
            See the classifier depth
          </a>
        </div>
        <p className="mt-10 max-w-[560px] text-[13px] text-ink-muted">
          Built by a Luxembourg VAT professional. Private beta with a
          handful of firms. If you prepare LU fund VAT returns, we can
          probably save you an hour per return today — and everything
          else on your compliance calendar over the next 18 months.
        </p>
      </Container>
    </section>
  );
}

// ─────────────────── The "why vertical" section ───────────────────

function WhyVertical() {
  return (
    <section id="product" className="py-20 md:py-28 border-t border-[#EFEAE2]">
      <Container>
        <div className="grid md:grid-cols-12 gap-10">
          <div className="md:col-span-5">
            <Eyebrow>Why vertical</Eyebrow>
            <h2 className="mt-4 text-[34px] md:text-[44px] leading-[1.08] tracking-[-0.02em] font-semibold text-ink">
              Horizontal VAT tools treat every country as a dropdown.
              <br />
              <span className="text-ink-soft">Luxembourg deserves better.</span>
            </h2>
            <p className="mt-6 text-[16px] leading-[1.65] text-ink-soft">
              LU VAT classification hinges on Art. 44 sub-paragraphs,
              CJEU jurisprudence (BlackRock, Fiscale Eenheid X, DBKAG,
              Polysar), AED circulars that move quarterly, and a
              specific eCDF XML format nobody else files. Generic VAT
              platforms don&apos;t invest here — the LU market is too
              small to matter to them. cifra does. That&apos;s the moat.
            </p>
          </div>

          <div className="md:col-span-7 md:pl-10 md:border-l md:border-[#EFEAE2]">
            <dl className="space-y-8">
              <div>
                <dt className="text-[15px] font-semibold text-ink">
                  32+ deterministic rules with full legal citations
                </dt>
                <dd className="mt-2 text-[15px] leading-[1.6] text-ink-soft">
                  Every classification line carries the LTVA article +
                  CJEU case + AED circular that supports it. BlackRock
                  C-231/19, Fiscale Eenheid X C-595/13, DBKAG C-58/20,
                  Polysar C-60/90, Titanium C-931/19, Finanzamt T II
                  C-184/23, Versãofast T-657/24 — all cited where they
                  fire. LLMs don&apos;t compete on this axis.
                </dd>
              </div>

              <div>
                <dt className="text-[15px] font-semibold text-ink">
                  Override log as compliance evidence
                </dt>
                <dd className="mt-2 text-[15px] leading-[1.6] text-ink-soft">
                  Every AI suggestion is frozen on first
                  classification. When your reviewer changes the
                  treatment, cifra records the before/after +
                  timestamp + user + reason and exports a formal PDF
                  audit trail. Pitch killer against the &ldquo;we
                  can&apos;t use AI&rdquo; objection: the AI never
                  decides. Humans do. Every decision is logged.
                </dd>
              </div>

              <div>
                <dt className="text-[15px] font-semibold text-ink">
                  Legal-watch that surfaces when rules need re-review
                </dt>
                <dd className="mt-2 text-[15px] leading-[1.6] text-ink-soft">
                  60+ legal sources tracked with review dates. When
                  the AED publishes a new circular or the CJEU issues
                  a ruling that affects LU practice, cifra flags which
                  of your classification rules need a second look.
                  Nobody at your firm has to remember to check.
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </Container>
    </section>
  );
}

// ─────────────────── How it works (4 steps) ───────────────────

function HowItWorks() {
  const steps = [
    {
      n: '01',
      title: 'Drop invoices in',
      body:
        'Upload a folder of PDFs, a client Excel export, or (coming) a direct Peppol feed. cifra extracts invoice fields with Anthropic Claude and a refusal-safe prompt pipeline.',
    },
    {
      n: '02',
      title: 'Classifier does 80% of the work',
      body:
        '32+ deterministic rules route every line to a treatment code with the LTVA article + CJEU case that justifies it. Rules beat LLMs every time on defensibility.',
    },
    {
      n: '03',
      title: 'Validator second-opinions the whole declaration',
      body:
        'Opus reviews the classified return before filing — critical / high / medium / info findings with legal citations. Your reviewer accepts, rejects or defers each one.',
    },
    {
      n: '04',
      title: 'File what the AED expects',
      body:
        'eCDF XML generated, schema-verified. Client approves via a signed link (no login needed). You file via LuxTrust. Audit trail exports as a formal PDF.',
    },
  ];

  return (
    <section className="py-20 md:py-28 bg-white border-y border-[#EFEAE2]">
      <Container>
        <div className="max-w-[720px]">
          <Eyebrow>How it works</Eyebrow>
          <h2 className="mt-4 text-[34px] md:text-[44px] leading-[1.08] tracking-[-0.02em] font-semibold text-ink">
            From raw invoices to a defensible filing, in four steps.
          </h2>
        </div>

        <ol className="mt-14 grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {steps.map((s) => (
            <li
              key={s.n}
              className="rounded-xl border border-[#EFEAE2] bg-[#FBFAF7] p-6 flex flex-col"
            >
              <span className="text-[11.5px] font-semibold tracking-[0.12em] text-brand-700">
                {s.n}
              </span>
              <h3 className="mt-3 text-[17px] font-semibold text-ink leading-snug">
                {s.title}
              </h3>
              <p className="mt-2 text-[14px] leading-[1.55] text-ink-soft flex-1">
                {s.body}
              </p>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}

// ─────────────────── Depth / proof section ───────────────────

function Depth() {
  return (
    <section id="depth" className="py-20 md:py-28">
      <Container>
        <div className="grid md:grid-cols-12 gap-10 items-start">
          <div className="md:col-span-5">
            <Eyebrow>The depth</Eyebrow>
            <h2 className="mt-4 text-[34px] md:text-[44px] leading-[1.08] tracking-[-0.02em] font-semibold text-ink">
              Numbers a Big-4 VAT partner would recognise.
            </h2>
            <p className="mt-6 text-[16px] leading-[1.65] text-ink-soft">
              cifra treats Luxembourg tax like a first-class engineering
              discipline. Every rule is regression-tested. Every legal
              source has a review date. Every AI decision is logged.
            </p>
          </div>

          <div className="md:col-span-7">
            <dl className="grid grid-cols-2 gap-px bg-[#EFEAE2] rounded-xl overflow-hidden border border-[#EFEAE2]">
              <StatCell value="32+" label="classification rules · each citing LTVA + CJEU + circular" />
              <StatCell value="60" label="fixture corpus — every rule regression-tested on every commit" />
              <StatCell value="60+" label="legal sources tracked · LTVA, Directive, circulars, CJEU, LU Tribunals, market practice" />
              <StatCell value="17" label="AED letter categories classified with per-category appeal deadlines" />
              <StatCell value="10 yr" label="retention-ready audit trail · AED-defensible" />
              <StatCell value="€0" label="on-prem · AWS Bedrock available on request for regulated firms" />
            </dl>
          </div>
        </div>

        <div className="mt-16 rounded-xl border border-[#EFEAE2] bg-[#FBFAF7] px-6 md:px-10 py-8">
          <div className="grid md:grid-cols-[auto_1fr] md:gap-8 items-start">
            <div className="text-[11px] tracking-[0.16em] uppercase font-semibold text-brand-700 md:mt-1.5">
              Recent case-law cifra already encodes
            </div>
            <ul className="mt-4 md:mt-0 grid md:grid-cols-2 gap-y-3 gap-x-8 text-[14px] leading-snug">
              <CaseLi
                c="CJEU C-288/22 TP"
                date="2023-12-21"
                summary="Natural-person directors are not taxable persons → no VAT on fees."
              />
              <CaseLi
                c="CJEU C-184/23 Finanzamt T II"
                date="2024-07-11"
                summary="Intra-VAT-group supplies are definitively out of scope."
              />
              <CaseLi
                c="GC T-657/24 Versãofast"
                date="2025-11-26"
                summary="Credit intermediation — mortgage brokers who actively recruit customers qualify for Art. 44§1 (a)."
              />
              <CaseLi
                c="CJEU C-77/19 Kaplan"
                date="2020-11-18"
                summary="Cross-border cost-sharing does not qualify for Art. 44§1 y."
              />
              <CaseLi
                c="CJEU C-231/19 BlackRock"
                date="2020-07-02"
                summary="Fund-mgmt exemption requires services specific and essential to fund mgmt."
              />
              <CaseLi
                c="CJEU C-420/18 IO"
                date="2019-06-13"
                summary="Supervisory-board members are not taxable persons — collegial body."
              />
            </ul>
          </div>
        </div>
      </Container>
    </section>
  );
}

function StatCell({ value, label }: { value: string; label: string }) {
  return (
    <div className="bg-white p-6 md:p-7">
      <div className="text-[36px] md:text-[42px] leading-none font-semibold text-ink tracking-tight tabular-nums">
        {value}
      </div>
      <div className="mt-2 text-[13px] leading-snug text-ink-soft">{label}</div>
    </div>
  );
}

function CaseLi({ c, date, summary }: { c: string; date: string; summary: string }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="mt-1 inline-block w-1 h-1 rounded-full bg-brand-500 shrink-0" aria-hidden />
      <span>
        <span className="font-semibold text-ink">{c}</span>
        <span className="text-ink-muted"> · {date}</span>
        <br />
        <span className="text-ink-soft">{summary}</span>
      </span>
    </li>
  );
}

// ─────────────────── Product arc (multi-product) ───────────────────

function Roadmap() {
  const items = [
    { status: 'live' as const, label: 'VAT preparation', desc: 'Extract, classify, validate, approve, file.' },
    { status: 'live' as const, label: 'AED inbox', desc: '17-category letter classifier with appeal-deadline tracking.' },
    { status: 'live' as const, label: 'Approval portal', desc: 'Fund-manager approval via signed link — no login needed.' },
    { status: 'live' as const, label: 'Validator', desc: 'Second-opinion Opus review before every filing.' },
    { status: 'soon' as const, label: 'Peppol e-invoicing', desc: 'ViDA 2030 — pre-empted for LU clients with EU subsidiaries.' },
    { status: 'soon' as const, label: 'Subscription tax (taxe d\'abonnement)', desc: 'Quarterly UCITS / SIF / RAIF / SICAR filings.' },
    { status: 'next' as const, label: 'FATCA / CRS reporting', desc: 'Annual account-level XML.' },
    { status: 'next' as const, label: 'AIFMD Annex IV', desc: 'Quarterly CSSF filings for AIFMs.' },
    { status: 'next' as const, label: 'Direct tax (IRC / ICC / NWT)', desc: 'Corporate income + communal + net wealth returns.' },
    { status: 'next' as const, label: 'DAC6, CBAM, CESOP viewer', desc: 'The long tail of LU compliance.' },
  ];
  const pill = (status: 'live' | 'soon' | 'next') => {
    const map = {
      live: { label: 'Live', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
      soon: { label: 'In build', cls: 'bg-brand-50 text-brand-700 border-brand-200' },
      next: { label: 'On the roadmap', cls: 'bg-[#F5F1EC] text-ink-muted border-[#E5DFD7]' },
    };
    return map[status];
  };

  return (
    <section id="roadmap" className="py-20 md:py-28 bg-white border-y border-[#EFEAE2]">
      <Container>
        <div className="max-w-[720px]">
          <Eyebrow>The arc</Eyebrow>
          <h2 className="mt-4 text-[34px] md:text-[44px] leading-[1.08] tracking-[-0.02em] font-semibold text-ink">
            One workspace for every Luxembourg filing your firm owns.
          </h2>
          <p className="mt-6 text-[16px] leading-[1.65] text-ink-soft">
            cifra is built vertical-deep. That means new filings stack
            on the same data foundation — entities, declarations,
            invoices, legal-sources, audit-log. One login, one audit
            trail, one place your compliance calendar lives.
          </p>
        </div>

        <ul className="mt-14 grid md:grid-cols-2 gap-x-10 gap-y-3">
          {items.map((item) => {
            const p = pill(item.status);
            return (
              <li
                key={item.label}
                className="flex items-start gap-4 py-3 border-b border-[#EFEAE2] last:border-b-0"
              >
                <span
                  className={`shrink-0 inline-flex items-center justify-center h-[22px] px-2 rounded-full text-[10.5px] font-semibold tracking-wide border ${p.cls}`}
                >
                  {p.label}
                </span>
                <div>
                  <div className="text-[15px] font-medium text-ink leading-snug">
                    {item.label}
                  </div>
                  <div className="text-[13px] text-ink-soft leading-snug mt-0.5">
                    {item.desc}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </Container>
    </section>
  );
}

// ─────────────────── Closing CTA ───────────────────

function Close() {
  return (
    <section className="py-20 md:py-28">
      <Container>
        <div className="max-w-[760px]">
          <h2 className="text-[34px] md:text-[48px] leading-[1.08] tracking-[-0.02em] font-semibold text-ink">
            Want to see what your next VAT return looks like,
            <br />
            <span className="text-brand-500">run through cifra?</span>
          </h2>
          <p className="mt-6 text-[17px] leading-[1.6] text-ink-soft">
            Send us an old return — anonymised is fine — and we&apos;ll
            run it through the classifier and validator, and send back
            the side-by-side. 30-minute private demo, no slide deck.
          </p>
          <div className="mt-9">
            <a
              href="mailto:contact@cifracompliance.com?subject=cifra%20side-by-side%20request"
              className="inline-flex items-center h-11 px-5 rounded-md bg-ink text-white text-[14px] font-medium hover:bg-ink-soft transition-colors"
            >
              contact@cifracompliance.com
              <span className="ml-2" aria-hidden>→</span>
            </a>
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
          <CifraWordmark />
          <span className="text-[12.5px] text-ink-muted">· Luxembourg</span>
        </div>
        <div className="flex items-center gap-5 text-[12.5px] text-ink-muted">
          <a
            href="mailto:contact@cifracompliance.com"
            className="hover:text-ink transition-colors"
          >
            contact@cifracompliance.com
          </a>
          <Link href="/login" className="hover:text-ink transition-colors">
            Sign in
          </Link>
        </div>
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
        <WhyVertical />
        <HowItWorks />
        <Depth />
        <Roadmap />
        <Close />
      </main>
      <Footer />
    </>
  );
}
