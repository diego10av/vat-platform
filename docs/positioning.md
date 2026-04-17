# cifra · Positioning

> One page of clarity. Update when customer calls reveal new signal.

---

## In one sentence

cifra is a Luxembourg tax & compliance workspace — AI reads, humans
review, starting with VAT.

**The headline you see today** (login, tab, top of any pitch):

> *cifra — Luxembourg tax & compliance, in one workspace.
>  AI reads, humans review. Starting with VAT.*

The positioning deliberately leaves room: we identify with VAT today
(that's where we have product + regression corpus + LTVA knowledge),
but we don't brand ourselves as a "VAT platform". The roadmap — fund
filings, Peppol e-invoicing under ViDA, AED operations — builds on
top of the same workspace.

## Who it's for — ICP

**Wide primary audience, narrow beachhead.**

The product is built to be sold to **anyone in Luxembourg who prepares
and reviews compliance filings** — not just fiduciaries. The four
distinct buyer profiles we target:

| Segment | Typical buyer | Why they buy |
|---|---|---|
| **Boutique tax & fiduciary firms** (5-50 staff) | Managing partner / VAT lead | Get 1 senior hour back per return; audit-defensible trail |
| **Big 4** (PwC, KPMG, EY, Deloitte LU) | VAT practice lead / partner | Standardise the prep layer across hundreds of returns; AI guardrails that pass their QA |
| **Specialist law firms** with VAT practice | Partner running VAT / indirect-tax | Same prep-time compression + case-law citations for opinions |
| **In-house teams** at AIFMs, holding groups, fund admins | CFO / head of tax / VAT officer | Don't want to outsource but lack tooling — cifra is the internal workspace |

**Beachhead (where we sell first):** boutique tax/fiduciary firms
(5-20 staff, 50-300 fund entities). Big enough to pay SaaS, small
enough to decide in a week. Once 10-20 of these are live and
referenceable, Big 4 and law firms follow — they move slower but
the same product wins.

**Not the ICP:** generic SMEs who file their own VAT (too small),
pure bookkeepers without VAT specialism (wrong workflow), accounting
platforms looking to add VAT as a feature (competitor, not
customer).

## The problem today

Preparing a LU VAT return for a fund entity takes 2-5 hours of senior
time. About **70% of that work is transcription** (reading an invoice
PDF, typing numbers into Excel) or **judgment** (classifying the service
under Art. 44 sub-paragraphs, deciding whether BlackRock C-231/19
narrows an exemption). None of it is defensibly traceable three years
later if the AED comes knocking.

The other 30% — genuine professional judgment on novel transactions —
is where senior experts should actually be spending their time. Today
it's the minority of the hours.

## What cifra does differently

Five things competitors don't do:

1. **Deterministic classifier first, AI second.** 32+ rules with CJEU
   and LTVA citations handle ~80% of lines before any LLM touches them.
   When a competitor markets "ChatGPT classifies your invoices", cifra
   says "here's the 60-case regression corpus the classifier passes
   before shipping".

2. **Legal-watch is a living system.** 60+ legal sources (LTVA articles,
   EU Directive, AED circulars, CJEU cases, market-practice positions)
   with review dates. When the law moves — new circular, new CJEU
   decision, ViDA schema update — you see which rules need re-review,
   and when.

3. **Opus second-opinion review.** Every declaration gets an AI review
   of its own output before filing. The reviewer sees findings
   (critical / high / medium / info) with legal citations, and
   accepts / rejects / defers each. Like having a Magic Circle partner
   review every return.

4. **AED inbox with appeal deadlines.** 17 letter categories
   auto-classified by Claude — fixation d'acompte (40-day appeal
   window), bulletin d'information (3 months), notification de contrôle,
   mise en demeure, sursis de paiement, remise gracieuse — each with
   its own per-category deadline rules.

5. **eCDF XML generation, not just a PDF.** The filing artifact the AED
   actually wants. Currently subject to XSD verification (5 items
   flagged in legal-watch-triage.md — resolved before commercial launch).

## Why now

- **ViDA forcing digitisation by 2027-2030.** Every LU firm knows this.
  Nobody has a plan. Whoever has the tool in 2026 wins the wave.
- **Post-COVID shift to remote / hybrid** made Excel + Word workflows
  painful — no central source of truth, no audit trail.
- **AI maturity** finally makes PDF extraction reliable enough to deploy
  in compliance contexts (with proper guardrails — cifra's anti-
  injection, null-propagation, refusal-path, fixture regression).
- **AED increasingly data-driven** (SAF-T, CESOP, VIES improvements) =
  need for defensible, machine-readable trails.

## 60-second pitch (for a cold call or coffee meeting)

> "I'm Diego. Do you prepare VAT returns for LU fund entities? Most
> firms do it in Excel — 3-4 hours per return, hard to audit three
> years later. I've built cifra: it reads the invoices, classifies them
> per LTVA and CJEU with full citations for every decision, generates
> the eCDF XML, and runs an AI second-opinion review before you file.
> My target clients cut return prep from 4 hours to 45 minutes, with
> better documentation than they had before. 15-minute demo — free."

## What cifra explicitly is NOT

- **Not a replacement for a VAT lawyer's judgment** on novel
  transactions. It surfaces precedent and defensibility; it doesn't
  make law.
- **Not a filing robot** — the reviewer uploads the XML manually via
  LuxTrust. cifra prepares schema-verified XML; the human files.
- **Not multi-jurisdiction in V1.** LU only. Belgium / Netherlands /
  Germany on the roadmap for year 2.
- **Not for individuals.** B2B only — firms preparing for end-client
  fund entities.
- **Not "ChatGPT for VAT".** The AI is scaffolded with deterministic
  rules, a fixture regression corpus, a validator agent, and a
  legal-watch triage. The LLM is one component among five defences.

---

## Landing page copy — first pass (for cifracompliance.com)

### Hero

**Luxembourg VAT compliance, rebuilt.**

Prepare VAT returns for fund entities in minutes, not hours —
with the classifier depth a Magic Circle partner would sign off on.

[ Request a demo ]  [ See how it works ]

### Three features (section "What makes cifra different")

**Classifier with CJEU citations, not ChatGPT guesses.**
32+ deterministic rules covering every Art. 44 sub-paragraph, reverse-
charge variant, and domestic RC scenario, each citing the LTVA article
and relevant CJEU case (BlackRock, Fiscale Eenheid X, DBKAG…). 60-case
regression corpus. AI only touches the lines the rules cannot resolve.

**Living legal-watch.**
When the AED publishes a new circular or the CJEU hands down a ruling
that affects fund-management exemption, cifra's legal-watch flags which
rules need re-review. Nobody at your firm has to remember to check.

**Second-opinion AI review.**
Opus 4.5 reviews every classified declaration before you file — flagging
potential misclassifications with full legal citations. You accept,
reject or defer each finding. Like having a partner review every return.

### Proof points (once there are customers)

- "Before cifra, a mid-size fund return took me 3 hours. Now it's 35
  minutes, and I sleep better about the audit trail." — [first customer]
- Classifier test coverage: 253 tests / 60-case regression corpus
- Legal sources tracked: 60+ (LTVA + Directive + circulars + CJEU + LU
  Tribunals + market practice)
- AED letter categories recognised: 17

### Pricing

Contact for firm pricing. Three tiers from single-practitioner Starter
to white-label Enterprise. [ Request a quote ]

### Footer

cifra SARL-S · Luxembourg · contact@cifracompliance.com
Built by a LU VAT professional for LU VAT professionals.
