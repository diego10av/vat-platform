# ViDA for cifra — strategic briefing + product plan

> VAT in the Digital Age (ViDA) is the EU directive package adopted
> **11 March 2025** that rebuilds how VAT works across the Union between
> 2027 and 2030. For cifra this is not just a compliance burden to
> track — it is **a new product line** that Diego can sell today to
> every customer he already has, plus every fiduciary prospect he meets.
>
> This document has three parts:
>
> 1. What ViDA actually is (in plain language)
> 2. What it means for LU fund-entity fiduciary firms
> 3. cifra's product plan — what we build, in what order, what we sell

Last updated: 2026-04-17

---

## Part 1 — ViDA in plain language

Three pillars, three rollout dates. Every serious VAT practitioner in
Europe needs to know them by name.

### 🏛️ Pillar 1 — Digital Reporting Requirements (DRR) — effective **1 July 2030**

**What it is:** every intra-EU B2B invoice must be issued as a
**structured electronic invoice** (XML following the EN 16987 /
EN 16931 standard, typically delivered over the Peppol network) and
**reported to the taxpayer's tax authority within 2 working days of
issuance**. The current `état récapitulatif` / EC Sales List (TVA006N)
disappears — replaced by continuous, near-real-time transaction
reporting.

**Translation for Diego's clients:** a SOPARFI invoicing a Belgian
customer in 2031 will:
- Generate the invoice in structured XML (not a PDF)
- Transmit it to the customer via Peppol (not by email)
- Simultaneously transmit a copy to the AED's tax portal
- Receive confirmation of the reporting within hours

**What happens if they don't:** input-VAT deduction can be challenged;
cross-border zero-rating on the supply side can be questioned. Bluntly:
**non-compliant firms lose money**.

### 🏠 Pillar 2 — Platform economy — effective **1 July 2028** (short-term accommodation + passenger transport)

**What it is:** digital platforms (Airbnb-style short-term rental +
Uber-style passenger transport) become "deemed suppliers" — they
collect the VAT from the end customer and remit it to the tax
authority, regardless of whether the underlying host / driver is
VAT-registered. Eliminates the compliance gap that let the platform
economy operate largely outside VAT.

**Translation for Diego's clients:** narrow. Some LU-based PropCo
entities that own short-term-rental properties via an app lose the
need to register for VAT themselves — the platform handles it. But
the platform now has LU VAT obligations, which is a new customer
profile for cifra.

### 🌍 Pillar 3 — Single VAT Registration (SVR) — effective **1 July 2028**

**What it is:** extension of the One-Stop-Shop (OSS) so that a company
with cross-border EU sales can register **once** in its home country
and file **one** periodic return covering all EU countries. Eliminates
the "register in every country where you sell" burden.

**Translation for Diego's clients:** a LU AIFM selling cross-border
services to consumers no longer registers in 27 countries. Files one
OSS return via AED. cifra's eCDF engine can trivially add an OSS
module for the same customer base.

---

## Part 2 — What this means for LU fiduciary firms (Diego's customers)

### The truth about LU specifically

- **B2G (public-sector) e-invoicing** has been mandatory in LU since
  **18 May 2019** via the Peppol network. Every LU firm invoicing a
  public body today already uses it.
- **B2B e-invoicing** is NOT yet mandatory in LU. The government has
  signalled it will align with ViDA but has not published a specific
  LU ramp schedule ahead of 2030.
- **Other EU countries are ahead**: Italy (mandatory B2B since 2019),
  France (phased rollout 2024-2026), Poland (mandatory 2026), Belgium
  (mandatory 2026). Germany has started 2025-2028 transition.
- **This matters for LU fund entities**: most SOPARFIs have cross-border
  trading relationships. An LU holding selling services to its French
  subsidiary ALREADY needs to issue Peppol invoices (or accept them)
  because France demands it — even though LU itself doesn't mandate
  yet.

### What Diego's fiduciary clients are asking RIGHT NOW (per Diego)

When a fund-administration firm sends an invoice to their client
(SOPARFI, fund, etc.), they have to ask themselves:
- Does the client's jurisdiction require a structured e-invoice?
- How do I generate one? (Most firms: they don't know; they send a PDF
  and hope.)
- What format — Peppol-BIS 3.0? Factur-X? UBL 2.1?
- How do I transmit? (Via a Peppol access point.)
- What are the mandatory fields? (Different per jurisdiction.)

Diego's words: *"muchas veces me preguntan cuáles son los requisitos,
cómo se hacen"* — exactly this. A Big-4 answers with a €5,000 advisory
opinion. cifra can answer with a generated XML, transmitted, archived.

---

## Part 3 — cifra's ViDA product plan

### Module A: "cifra e-invoice" — the sellable product line

**Positioning for sales:** *"You already use cifra for VAT returns.
Now use it to issue and receive the Peppol e-invoices your Belgian /
French / Italian clients already require — and be ready for LU's own
mandate when it lands in 2028-2030."*

**Core capabilities (minimum viable):**

1. **Outbound e-invoice generation**
   - Takes data from the cifra invoice UI (provider = client entity;
     customer = their end-customer) and produces:
     - Peppol-BIS 3.0 XML (most EU countries)
     - Factur-X (France hybrid PDF+XML)
     - ZUGFeRD (Germany)
     - FatturaPA (Italy)
     - KSeF (Poland) — late 2026
   - Legal-validation: runs through EN 16931 semantic validator before
     emission (prevents rejection at destination)
   - Country-specific field enrichment (Italian codice destinatario,
     French numéro SIRET, etc.)

2. **Peppol access-point transmission**
   - Via partnership with a certified Peppol access-point provider
     (Storecove, Pagero, B2Brouter, Basware). We do NOT build our own
     Peppol access point — that's SSL/PKI infrastructure and AEAT
     certification overhead not worth our focus.
   - Transmission history + delivery confirmation stored on the
     invoice record.

3. **Inbound e-invoice ingestion**
   - When the client receives a Peppol invoice from a supplier, cifra
     parses the XML **directly** (no OCR, no GPT extraction). Parses
     to the exact same `invoices + invoice_lines` tables as today.
   - Error rate drops from ~5-10% (PDF extraction) to 0% (XML is
     structurally defined).
   - Massively better for the reviewer.

4. **Compliance dashboard**
   - Per client: "What jurisdictions am I obliged to e-invoice to?"
     Based on customer_country + AIFM domicile + invoice type.
   - Countdown: "In X weeks, country Y requires you to be Peppol-ready."
     Timer-based education.

### Module B: "Ready for 2030 LU DRR" — the defensive play

When LU publishes its DRR schema (expected 2027-2028), cifra adds:

- **Near-real-time reporting feed** to the AED's DRR endpoint. Every
  outbound invoice generated in cifra is transmitted to AED within
  2 working days automatically. No reviewer action needed.
- **EC Sales List retirement** — cifra stops generating état
  récapitulatif once the new system takes over; the DRR feed replaces
  it with structurally richer data.
- **Cross-validation with inbound Peppol invoices** — flags
  discrepancies between what suppliers reported to the tax authority
  and what the client extracted.

### Module C: "OSS/IOSS returns" — the upsell

Pillar 3 of ViDA (SVR) makes OSS much more widely used in 2028+.
cifra adds:

- **OSS return preparation** — same engine, different schema + boxes.
- **IOSS** for imports of low-value goods (< €150).
- Cross-border consumer-facing LU entities (fund admin with B2C
  exposure, LU-based platforms) buy this automatically.

---

## Part 4 — Pricing

Proposed pricing model (test in customer calls before committing):

| Module | Per-seat add-on | Per-entity add-on | Per-transaction |
|--------|-----------------|-------------------|-----------------|
| VAT core (current) | €99-299/mo base | — | — |
| e-invoice outbound | +€50/mo per firm | +€20/mo per entity | €0.05-0.10 per invoice transmitted |
| e-invoice inbound (Peppol ingestion) | +€30/mo per firm | free | — (included) |
| DRR LU near-real-time (post-2030) | free | +€50/mo | — |
| OSS / IOSS returns | +€100/mo | per OSS-filing entity only | — |

**Expected ARR impact:** adding e-invoice to a €299/mo Firm tier
takes it to ~€500/mo. Revenue per customer 67% higher. This alone
justifies ~6 weeks of development effort at €100-150k ARR break-even.

---

## Part 5 — Build order + dependencies

### Phase 1 (Q2-Q3 2026) — outbound Peppol-BIS generator

- Choose a Peppol access-point partner (Storecove + B2Brouter shortlist)
- Build `src/lib/einvoice/` — domain model for EN 16931
- XML emitter for Peppol-BIS 3.0 (BE, NL, LU, PT, most of EU)
- EN 16931 validator integration (open-source: `Phive` / Mustangproject)
- UI: new button on approved declaration *"Emit as e-invoice"*
- Test with a friendly customer

### Phase 2 (Q3-Q4 2026) — country-specific profiles

- Factur-X for France (hybrid PDF+XML)
- FatturaPA for Italy
- ZUGFeRD for Germany
- Certification testing with each jurisdiction's sandbox

### Phase 3 (Q4 2026-Q1 2027) — inbound ingestion

- Peppol access-point receives inbound invoices → webhook to cifra
- XML-to-invoice-lines parser
- Replaces OCR for those customers

### Phase 4 (Q2 2027+) — DRR feed when LU publishes schema

- Auto-transmission to AED every outbound invoice
- Dashboard of DRR status (transmitted / acknowledged / rejected)

### Phase 5 (2028+) — OSS/IOSS module

- New eCDF forms for OSS return (template + box engine)
- Integration with cifra's existing ec-sales-list rebased to OSS

---

## Part 6 — Risks + mitigations

| Risk | Mitigation |
|------|-----------|
| Peppol access-point vendor lock-in | Multi-vendor strategy; XML is standard, only the transmit layer is vendor-specific |
| Country-specific format churn (Italy's FatturaPA has revised 5×) | Partner with an access-point that normalises |
| LU DRR schema not published on time | Build Peppol-BIS first (cross-border value), DRR is additive |
| Customer doesn't want to give up their PDF workflow | Hybrid: generate Peppol-BIS + accompanying PDF until adoption forced |
| EN 16931 validation is complex | Use open-source validators; don't invent our own |
| Competitors (Avalara, Sovos, Taxually) have e-invoicing too | Our moat: LU-VAT + e-invoice in ONE tool, with LU fund-entity specialisation they lack |

---

## Part 7 — Immediate actions (for Diego)

1. Talk to **3 customers / prospects in LU fiduciary** in the next 2
   weeks. Ask specifically: *"Do your clients ever ask you about
   Peppol / e-invoicing? How much time do you spend on it today?"*
   Learn the pain intensity before we build.
2. Evaluate **Peppol access-point partners**. Get quotes from
   Storecove, Pagero, B2Brouter. Aim for €0.02-0.05 per transmitted
   invoice at wholesale; we mark up to €0.05-0.10 retail.
3. Confirm **pricing hypothesis** (the €50-100/mo add-on for
   e-invoicing module) against willingness-to-pay signals from the
   calls.

Then — if the signal is positive — we build Phase 1 in Q2 2026.

---

## References

- Directive (EU) 2025/516 (ViDA) — OJ of 2025-03-11
- EN 16931-1:2017 (core semantic model for European e-invoices)
- Peppol BIS Billing 3.0 specification
- LU Peppol mandate for B2G — Loi du 13 décembre 2021 + Règlement grand-ducal
- France — Ordonnance n° 2021-1190 (factures électroniques B2B)
- Italy — SdI / FatturaPA (Agenzia delle Entrate)

Sources for periodic review (add to legal-watch):
- `europa.eu` DG TAXUD ViDA implementation updates
- `impotsdirects.public.lu` — AED announcements
- Peppol Authority updates (peppol.org)
