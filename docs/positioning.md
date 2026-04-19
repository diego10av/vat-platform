# cifra · Positioning

> One page of clarity. Update when customer calls reveal new signal.
>
> Last major revision: 2026-04-19 — vertical-first repositioning
> (Veeva-inspired), CSP vs in-house split, multi-product architecture.

---

## In one sentence

**cifra is the compliance workspace for Luxembourg tax — built
vertical-first, classifier-first, audit-first. Starting with VAT.**

The load-bearing words:
- **Workspace**, not "VAT tool" — because the roadmap extends.
- **Vertical-first** — only Luxembourg, only compliance. No generic SaaS.
- **Classifier-first** — 32+ deterministic rules with LTVA + CJEU
  citations; AI is scaffolded, not autonomous.
- **Audit-first** — every AI suggestion frozen, every human override
  logged as defensible evidence.
- **Starting with VAT** — today's credibility, not tomorrow's ceiling.

## The positioning model — why Veeva, not Stripe

Two templates for SaaS strategy: horizontal (Stripe, Linear, Notion —
serve every industry, win on craft) vs vertical (Veeva, Procore,
Toast — serve one industry, win on depth).

cifra is vertical. Specifically, it follows the **Veeva playbook**:

| Veeva (life sciences) | cifra (LU tax & compliance) |
|---|---|
| Started with a single product (Veeva CRM for pharma reps) | Starts with VAT preparation for LU fund entities |
| Went deep in one vertical before going wide | Goes deep in LU before BE/NL/DE |
| Domain-native founders (Peter Gassner was a Salesforce SVP who saw pharma's pain) | Domain-native founder (Diego: 8+ years LU VAT professional) |
| Premium pricing, no race to the bottom | Premium pricing hypothesis (€299-custom, not €29) |
| Added Vault (clinical docs), Commercial Cloud, Development Cloud — one product at a time, all for the same customer | Adds Peppol e-invoicing, subscription tax, FATCA/CRS, AIFMD Annex IV — one product at a time, all for the same customer |
| Refused to add adjacent verticals (still only life sciences after 15 years) | Refuses to add adjacent jurisdictions or industries until LU is dominant |

**The moat in a vertical SaaS is regulatory depth, not features.**
That's why cifra's legal-watch system (60+ sources with review dates,
32+ classification rules each citing the specific LTVA article + CJEU
case + AED circular) is the product, not a "trust and safety" afterthought.

## Who it's for — ICP

Wide primary audience, narrow beachhead. Two distinct operational
shapes the product must support:

### Client-type A: CSP firms (*the beachhead*)

A fiduciary, Big 4, boutique tax firm, or law firm that prepares
returns **on behalf of their clients**. Typical shape:

- 5-50 staff, 50-500 fund entities under management
- Each end-client has its own entities (SOPARFIs, AIFMs, SCSps…)
- Buyer is the managing partner or VAT lead
- Data hierarchy: `CSP → clients → entities → declarations`

cifra supports this shape natively: the `clients` table is the parent
of `entities`, and `client_contacts` propagate to `entity_approvers`
so the CSP doesn't re-enter the same fund manager's email on every
entity.

### Client-type B: In-house teams (*follow-on*)

An AIFM, holding group, fund admin, family office, or corporate group
that prepares returns **for their own entities**. Typical shape:

- CFO / head of tax / VAT officer + one reviewer
- 5-100 entities in the group
- Buyer is the CFO
- Data hierarchy: `Firm → entities → declarations` (no "clients" layer)

cifra supports this shape via an `org_type` switch: when set to
`in_house`, the UI hides the "Clients" sidebar item and `entities`
are direct children of the firm. Same underlying product; different
conceptual model.

### The four buyer personas (across both shapes)

| Segment | Typical buyer | Shape | Why they buy |
|---|---|---|---|
| **Boutique tax & fiduciary firms** (5-50 staff) | Managing partner / VAT lead | CSP | Get 1 senior hour back per return; audit-defensible trail |
| **Big 4** (PwC, KPMG, EY, Deloitte LU) | VAT practice lead / partner | CSP | Standardise the prep layer; AI guardrails that pass their QA |
| **Specialist law firms** with VAT practice | Partner running indirect tax | CSP | Prep compression + case-law citations for opinions |
| **In-house teams** at AIFMs, holding groups, fund admins | CFO / head of tax / VAT officer | In-house | Don't want to outsource but lack tooling — cifra is the internal workspace |

**Beachhead (where we sell first):** boutique CSP firms (5-20 staff,
50-300 fund entities). Big enough to pay SaaS, small enough to
decide in a week. Once 10-20 are live and referenceable, Big 4 and
law firms follow — same product, slower cycles.

**Not the ICP:** generic SMEs filing their own VAT, pure bookkeepers
without VAT specialism, accounting platforms looking to add VAT as a
feature (competitors, not customers).

## The problem today

Preparing a LU VAT return for a fund entity takes 2-5 hours of senior
time. About **70% of that work is transcription** (reading an invoice
PDF, typing numbers into Excel) or **low-judgment classification**
(tagging an invoice under Art. 44§1 d vs 44§1 a). The genuinely
difficult judgment — novel transactions, recent CJEU rulings
(Versãofast T-657/24, Finanzamt T II C-184/23, C-288/22 TP) — is
where senior expertise actually matters. Today it's the minority of
the hours.

None of it is defensibly traceable three years later if the AED
challenges an exemption.

## What cifra does differently (the five pillars)

1. **Deterministic classifier, LLM-scaffolded — not LLM-native.**
   32+ rules covering Art. 44 sub-paragraphs, reverse-charge
   variants, domestic RC categories, passive-holding gates (Polysar
   C-60/90), director fees (natural + legal persons per C-288/22),
   pro-rata for mixed-use funds. Each rule cites the specific
   LTVA article + CJEU case + AED circular. 60-case regression
   corpus runs on every commit. When a competitor markets "ChatGPT
   classifies your invoices", cifra answers with the reproducible
   accuracy of a rules engine.

2. **Legal-watch is a living system, not a marketing page.**
   60+ legal sources (LTVA articles, EU Directive, AED circulars,
   CJEU cases, LU Tribunals, market practice) with review dates.
   When the law moves — new circular, new CJEU decision, ViDA
   schema update — the dashboard flags which rules need re-review,
   and when. No firm has to remember to check.

3. **AI override log as compliance evidence.** Every invoice_line
   stores `ai_suggested_treatment` frozen at first classification.
   When the reviewer changes `treatment`, the difference becomes a
   "USER OVERRIDE" event in the audit trail, exportable as formal
   PDF via `audit-trail-pdf.ts`. The pitch killer against
   "we can't use AI" objections.

4. **Opus second-opinion validator.** Every declaration gets an AI
   review of its own output before filing. The reviewer sees findings
   (critical / high / medium / info) with legal citations, and
   accepts / rejects / defers each. Like having a Magic Circle
   partner review every return.

5. **eCDF XML generation, not PDF.** The filing artifact the AED
   actually wants. XSD-verified output.

## Product architecture — the multi-product arc

cifra is architected as a **workspace**, not a tool. That means the
same customer can consume multiple product lines off the same data
foundation (entities, declarations, invoices, legal-sources,
audit-log). Order of release:

| # | Product | Status | Value prop per customer |
|---|---------|--------|---|
| **1** | **VAT preparation** | 🟢 Live | Core engine: extraction, classification, review, approval, eCDF XML |
| **2** | **AED inbox** | 🟢 Live | 17-category letter classifier with per-category appeal-deadline tracking |
| **3** | **Client approval portal** | 🟢 Live | Signed-link portal for fund managers to approve without cifra login |
| **4** | **Opus validator** | 🟢 Live | Second-opinion AI review before filing |
| **5** | **Peppol e-invoicing** (ViDA) | 🟡 P1 | Generate + ingest structured XML invoices; pre-empt 2030 mandate |
| **6** | **Subscription tax (taxe d'abonnement)** | 🔵 P2 | Quarterly filings for UCITS / SIF / RAIF / SICAR |
| **7** | **FATCA / CRS reporting** | 🔵 P2 | Annual account-level XML reporting to AED |
| **8** | **AIFMD Annex IV** | 🔵 P2 | Quarterly CSSF filings for AIFMs |
| **9** | **Direct tax — IRC / ICC / NWT** | 🟤 P3 | Corporate income, communal, net wealth taxes |
| **10** | **DAC6 reportable arrangements** | 🟤 P3 | Cross-border tax arrangement notifications |
| **11** | **CBAM quarterly reports** | 🟤 P3 | For LU importers of cement / steel / aluminium |

**Strategic note:** Diego's stated vision is *"cifra becomes the
compliance workspace for LU fund entities"*. Each product after VAT
takes ~4-8 weeks of focused work once its predecessors are stable.
Aim: one new product per quarter after reaching 20 paying customers.

## Why now

- **ViDA forces digitisation by 2027-2030.** Every LU firm knows
  this. Nobody has a plan. Whoever has the tool in 2026 wins the wave.
- **Post-COVID shift to remote / hybrid** made Excel + Word workflows
  painful — no central source of truth, no audit trail.
- **AI maturity** finally makes PDF extraction reliable enough to
  deploy in compliance contexts (with proper guardrails — cifra's
  anti-injection, null-propagation, refusal-path, fixture regression).
- **AED increasingly data-driven** (SAF-T, CESOP, VIES improvements)
  = need for defensible, machine-readable trails.
- **Recent CJEU rulings** (C-288/22 TP on LU director fees,
  C-184/23 Finanzamt T II on intra-VAT-group supplies, T-657/24
  Versãofast on referral fees) are actively reshaping classification
  — firms without a legal-watch system fall behind within weeks.

## 60-second pitch (for a cold call or coffee meeting)

> *"I'm Diego. Do you prepare VAT returns for LU fund entities? Most
> firms do it in Excel — 3-4 hours per return, hard to audit three
> years later. I've built cifra: it reads the invoices, classifies
> them per LTVA and CJEU with full citations for every decision,
> generates the eCDF XML, and runs an AI second-opinion review
> before you file. My target clients cut return prep from 4 hours
> to 45 minutes, with better documentation than they had before.
> 15-minute demo — free."*

## What cifra explicitly is NOT

- **Not a replacement for a VAT lawyer's judgment** on novel
  transactions. It surfaces precedent and defensibility; it doesn't
  make law.
- **Not a filing robot** — the reviewer uploads the XML manually via
  LuxTrust. cifra prepares schema-verified XML; the human files.
- **Not multi-jurisdiction in V1.** LU only. Belgium / Netherlands /
  Germany on the roadmap for year 2.
- **Not for individuals.** B2B only — firms preparing for end-client
  fund entities, or in-house teams at AIFMs / holding groups.
- **Not "ChatGPT for VAT".** The AI is scaffolded with deterministic
  rules, a fixture regression corpus, a validator agent, a
  legal-watch triage, and an override-log audit trail. The LLM is
  one component among five defences.
- **Not going horizontal.** No HR module, no CRM, no "AI for every
  tax in every country". The vertical focus IS the moat.

---

## Landing page — design direction

References (in descending priority for cifra's style):

- **Veeva.com** — vertical-first SaaS; product-line clarity;
  enterprise gravitas without stuffiness
- **Linear.app** — tight typography, developer-grade craft
- **Mercury.com** — trustworthiness for a regulated vertical
- **Stripe.com** — density of substance without visual noise
- **Factorial.com** — clean hero, layered product explanation

Anti-references (what NOT to copy):

- Generic SaaS illustrations (abstract shapes, 3D blobs)
- "Trusted by [10 logos]" grids — we have no logos yet and won't fake them
- "4.9 ★★★★★ on G2" — same reason
- Video hero + autoplay sound — banned
- Marketing chatbot / HubSpot forms — banned
- "Book a demo" as the only CTA — should feel less salesy

### Principles (Gassner test on every page element)

- **Substance density > whitespace**: a Big 4 partner reads the page in
  20 seconds. Every word earns its place.
- **Show the product, don't describe it**: real screenshots of
  `/declarations/[id]`, the classifier dashboard, the AI override
  log — cropped, annotated with a single word.
- **Legal depth visible**: the home page mentions specific CJEU
  cases by name + year. Nobody else does this because nobody else can.
- **No company name above the fold**: just the cifra wordmark.
  Diego is deliberately anonymous until he's ready to launch.
- **Vertical signalled without lock-in**: "Starting with VAT"
  appears in the hero. The roadmap section shows Peppol /
  subscription tax / FATCA coming.
- **One CTA, and it's humble**: `contact@cifracompliance.com` or
  a simple form. No "Book a demo → Calendly overlay".

### Copy anchors (for the landing build)

**Hero H1:**
> Luxembourg tax compliance, rebuilt from the law up.

**Hero subhead (max 22 words):**
> cifra prepares VAT returns for fund entities in minutes, with the
> classifier depth a Magic Circle partner would sign off on.

**Section 2 · Why vertical**
> Horizontal VAT tools treat every country as a dropdown.
> Luxembourg deserves better.
> 32+ deterministic rules citing LTVA + CJEU. A legal-watch system
> that flags stale rules when the AED publishes. An override log
> that turns every reviewer decision into defensible evidence.

**Section 3 · Product arc**
> Starting with VAT. Next: Peppol e-invoicing, subscription tax,
> FATCA/CRS, AIFMD Annex IV. One workspace, all the LU compliance
> filings your firm owns.

**Section 4 · How it works** (4-step flow with real screenshots)
> 1. Upload invoices. cifra extracts fields with Anthropic Claude.
> 2. Classifier applies 32+ LTVA + CJEU rules. You see the legal
>    citation for every line.
> 3. Validator reviews the full declaration. You accept / reject /
>    defer each finding.
> 4. eCDF XML generates. You file via LuxTrust. Audit trail exports
>    as a PDF the AED will actually read.

**Section 5 · Proof points (once there are customers)**
> - Classifier regression: 60-case corpus, run on every commit
> - Legal sources tracked: 60+ (LTVA + Directive + circulars + CJEU
>   + LU Tribunals + market practice)
> - AED letter categories classified: 17
> - Pricing: from €299/month. Enterprise custom.

**Footer (intentionally terse):**
> cifra · Luxembourg · `contact@cifracompliance.com`

No "About us". No team page. No "Made with ❤". No newsletter signup.

---

*Last amended: 2026-04-19 — vertical-first repositioning (Veeva arc),
CSP vs in-house split, multi-product architecture, landing page
direction.*
