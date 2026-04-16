# Legal watch — Luxembourg VAT

> **Purpose.** This document is the platform's living legal memory. It lists
> every external source (law, directive, circular, case, market practice)
> that the classification engine, eCDF boxes, and agent prompts rely on —
> together with **when** each was last reviewed and **what to watch for
> next**. A Magic-Circle-quality VAT practice is only as reliable as its
> ability to stay current; this file is the discipline that keeps the
> tool honest as the law evolves.
>
> **Maintainer cadence.** Review this file at minimum once per quarter,
> and always before a declaration covering a new legal period is filed.
> After each review, bump `last_reviewed` dates in
> `src/config/legal-sources.ts` and record the review in the changelog at
> the bottom of this file.

---

## 1. Structural principles

1. Every classification rule (`src/config/classification-rules.ts`) and
   every eCDF box filter (`src/config/ecdf-boxes.ts`) cites a structured
   id from `src/config/legal-sources.ts`, never a free-text legal
   reference. When the legal basis changes, editing one source entry
   updates every rule that depends on it.
2. Rules that depend on CJEU developments carry an explicit
   `watchlist` note so the next maintainer knows to re-check before
   filing.
3. Plain-text citations ("Art. 44§1 d LTVA") remain in human-readable
   `reason` / `flag_reason` / appendix output — they are the
   reviewer-facing narrative — but they are generated FROM the structured
   source, not written by hand.

---

## 2. Primary sources (Luxembourg and EU)

See `src/config/legal-sources.ts` for the typed map. The current entries are:

### Luxembourg
- **LTVA** — Loi du 12 février 1979 concernant la taxe sur la valeur ajoutée, as amended.
  - Key articles: 2, 12, 17, 18bis, 21, 27, 28§3 c, 40, 40-1, 43, 44, 45, 54, 60ter, 61, 62, 65.
- Règlement grand-ducal of various dates implementing specific LTVA provisions.

### EU
- **Directive 2006/112/EC** (VAT Directive).
- **Implementing Regulation 282/2011** (place of supply, evidentiary presumptions).
- **Regulation 904/2010** (administrative cooperation, VIES).
- Recent amendments to track:
  - **Directive 2020/285** — small-business scheme (effective 2025-01-01 EU-wide).
  - **Directive 2022/542** — revised reduced-rate framework.
  - **ViDA package 2022-2024** — e-invoicing, digital reporting, platform economy; rolling deadlines 2026-2030.

---

## 3. AED circulars in force

> Populated by the legal-review pass (agent E-4). Each entry: number,
> year, subject, impact on classifier / boxes / prompts, and the date the
> maintainer last confirmed it is still current.

- **Circ. 723 (territory: fund management exemption).** Clarifies the
  scope of Art. 44§1 d LTVA. Confirm post-2020 update number against the
  AED site.
- **Circ. 764 (territory: financial exemption).** Art. 44§1 a scope.
- **Circ. 810 (territory: real estate letting).** Art. 44§1 b + Art. 45 opt-in.
- **Circ. 791 / 797 (e-invoicing).** Format and archival requirements.
- **Circ. on VAT group regime** (post Art. 60ter introduction).
- **Circ. on simplified-regime thresholds.**
- **Circ. on practitioner responsibility / POA filing.**

> All of the above need their exact current circular numbers confirmed
> against `https://impotsdirects.public.lu` and the AED's own site.
> Entries populated from the agent E-4 briefing will replace these
> placeholders with verified numbers.

---

## 4. CJEU / EU General Court case law to embed

- **Versãofast, T-657/24, 26 November 2025** — referral fees and fund
  management exemption. Already cited by the drafter prompt.
- **BlackRock Investment Management (UK) Ltd, C-231/19, 2020** — single
  indivisible supply of IT services to a fund manager is not exempt.
- **Fiscale Eenheid X NV, C-595/13, 2015** — boundary of "special
  investment funds" concept.
- **ATP Pension Service A/S, C-464/12, 2014** — pension-fund management.
- **DBKAG, C-58/20 & K, C-59/20, 2021** — outsourced fund-administration
  services; tax-advice exception.
- **Morgan Stanley, C-165/17, 2019** — deduction of input VAT on
  cross-border head-office / branch costs.
- **Skandia America, C-7/13, 2014** and **Danske Bank, C-812/19, 2021** —
  VAT group cross-border rules.
- **Fenix International, C-695/20, 2023** — platform-economy rules.
- **Titanium, C-931/19, 2021** — when does a real-estate letting create
  a fixed establishment.
- **Herst, C-401/18, 2020** — attribution of intra-Community movement in
  chain transactions.

Cases to watch: any new AG opinion on Art. 135(1)(g); the CJEU
reference on VAT groups and cross-border branches (pending 2026-2027);
the Luxembourg-originated references to Morgan Stanley-style deduction.

---

## 5. Luxembourg Tribunal administratif / Cour administrative

Decisions that have shaped AED administrative practice on VAT matters.
Populated from the agent E-4 output.

---

## 6. Market practice (Big 4 / Magic Circle LU)

Not law, but what firms actually do. Record here with the explicit
caveat that these are consensus positions, not statutory:

- Default VAT treatment of referral fees to non-LU intermediaries.
- Carry-interest payment treatment.
- AIFM delegation fees vs investment advisory fees.
- Placement-agent commissions (distribution vs intermediation).
- Depositary-fee split (custody 14% vs oversight 17%).
- Transfer-agency fee treatment.
- Co-investment vehicle fees.
- Waterfall carry distributions.

Each practice entry must cite the legal basis (even if the basis is only
professional consensus) and the date the maintainer confirmed it still
reflects the market.

---

## 7. Active developments — what to monitor in 2026-2028

| Topic                                                     | Expected effect                                                                                                                                                                              | Source to monitor                                                                  |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **ViDA — digital reporting requirement**                  | Structured e-invoicing mandatory for B2B; near-real-time reporting to Member State.                                                                                                          | Council of the EU + LU transposition law.                                          |
| **ViDA — platform economy**                               | Deemed supplier rules for digital platforms (short-term accommodation, passenger transport).                                                                                                 | `eur-lex.europa.eu` / LU CLPE.                                                     |
| **ViDA — single VAT registration**                        | Extended OSS scope; C2C goods movements.                                                                                                                                                     | EU Commission.                                                                     |
| **LU SAF-T**                                              | Luxembourg-specific audit-file schema (2027-2028 expected).                                                                                                                                  | AED newsletter / impotsdirects.public.lu.                                          |
| **Small-business scheme (Directive 2020/285)**            | Already in force EU-wide since 2025-01-01; LU transposition text and the AED's operational guidance.                                                                                         | AED circulars + LU budget law 2026.                                                |
| **Reduced-rates framework (Directive 2022/542)**          | LU policy direction on which annex-categories to apply at reduced rates.                                                                                                                     | LU budget law.                                                                     |
| **LU Luxembourg budget 2026 VAT measures**                | Any rate adjustments, exemption scope changes, new opt-ins.                                                                                                                                  | Projet de loi budget 2026 + loi modifiée sur la TVA after adoption.                |
| **CJEU — Art. 135(1)(g) pending references**              | Any AG opinion or ruling affecting LU fund-management treatment.                                                                                                                             | `curia.europa.eu` — search on article 135.                                         |
| **CJEU — Morgan Stanley follow-up**                       | Cross-border deduction / branch cases impacting LU entities with non-LU head offices or branches.                                                                                            | `curia.europa.eu`.                                                                 |
| **AED practice on VAT groups**                            | Any new circular clarifying Art. 60ter operational details after its 2018 introduction.                                                                                                      | AED site.                                                                          |
| **VIES system evolution**                                 | VIES API modernisation may enable automated VAT-number verification inside the tool.                                                                                                         | EU Commission VIES documentation.                                                  |

---

## 8. Legal-review changelog

When a maintainer performs a review — full or partial — they add an entry
here. The point is historical traceability: if AED contests a filed
return, we can show when our legal position was last confirmed.

| Date       | Reviewer           | Scope                                                                                                                                          | Notes                                                                                                              |
| ---------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 2026-04-16 | Platform build     | Initial scaffold of legal-sources.ts and this file. Primary LTVA articles + key CJEU cases entered; circulars to confirm against AED site.     | Automated agent E-4 briefing pending — entries to be added once returned.                                          |
| 2026-04-16 | Opus audit E-2     | eCDF box mappings reviewed against TVA001N / TVA002NA / état récapitulatif structure.                                                          | Two CRITICAL formula bugs fixed (076, 097 double-counted import VAT 077). Box 056 rebased to rate-weighted formula. Box 435 trimmed to RC_EU_EX only. OUT_LUX_14 / 08 / 03 treatments + boxes 703/705/707 + rate-specific output VAT boxes added. EC Sales List rewritten to emit L/T/S indicators per treatment and include OUT_IC_GOODS / OUT_LU_TRIANG lines (previously omitted). VAT-number VIES-format check added. (simplified, non-annual) combination now rejected at declaration creation. 5 XML-schema items flagged TODO for manual AED XSD verification (namespace, FormVersion, element name, period encoding, Agent sub-block). 8 new regression tests added. |
| 2026-04-16 | Opus audit E-1     | Classification rules (19 direct + 4 inference) reviewed against LTVA + Directive + circulars + CJEU case law.                                  | TWO CRITICAL findings fixed: (1) RULE 19 IMPORT_VAT no longer auto-deducts — foreign-supplier VAT is NOT LU import VAT; flag-only pending customs DAU (Art. 70 LTVA exposure eliminated). (2) RULES 10/12 RC_EU_EX / RC_NONEU_EX now entity-type-guarded (BlackRock C-231/19, Fiscale Eenheid X C-595/13) — only qualifying funds get Art. 44§1 d; SOPARFIs and holdings fall to RC_EU_TAX / RC_NONEU_TAX. HIGH: "domiciliation" removed from REAL_ESTATE_KEYWORDS (Circ. 764 taxable 17%); new RULE 5D classifies it correctly. Real-estate carve-outs (parking, hotel, hunting, safe-deposit) handled via RULE 5C. CSSF keyword tightened to public-authority phrases only. RULE 18 now requires customer_vat evidence (else flagged to avoid B2C mis-scoping under Art. 17§2). New sub-rules 7A / 7B / 7D / 15A consume the extractor's exemption_reference for precise Art. 44 paragraph selection. New INFERENCE E "taxable backstop" prevents legal / tax / audit advisory from being swept into fund-management exemption (Deutsche Bank C-44/11, BlackRock C-231/19). INFERENCE A/B tolerance tightened ×10 → ×3. INFERENCE C/D now cancelled by exclusion keywords (SaaS, cloud, training, consulting). GP no longer treated as a qualifying fund in INFERENCE C/D. New RULE 23 for Art. 57 franchise-threshold suppliers. 11 new regression tests. |
| 2026-04-16 | Opus audit E-3     | Agent prompts (extractor / triage / drafter / aed-reader) reviewed for fiscal accuracy and AED-audit survivability.                           | EXTRACTOR: added 11 fields the prompt was not capturing — customer_address, corrected_invoice_reference (Art. 65§3), self_billing_mentioned (Art. 62), triangulation_mentioned (Art. 18bis), margin_scheme_mentioned (Art. 56bis), self_supply_mentioned (Art. 12), customs_reference (DAU/MRN), fx_source_hint, direction_confidence, suspicious_content_flag/note, invoice_validity_missing_fields (Art. 61 completeness check). Rule: `rc_amount` on every line MUST be null — classifier owns the reverse-charge computation. `total_vat=null` vs `0` disambiguated for pure RC invoices. Direction no longer silently defaults to "incoming" — null propagates to the UI as a low-confidence flag. Date "first of month" fabrication removed. FX policy neutrality (LU allows three methods). Expanded split-patterns table (depositary / audit / insurance / law-firm / SaaS). Anti-injection now covers hidden/white/metadata text. TRIAGE: 4 new categories (proforma_invoice, purchase_order, aed_attestation, power_of_attorney, kyc_document) — prevents pro-forma and POs being silently treated as invoices. Rule 1bis for VAT-match + name divergence. CCSS carve-out refined for décompte annuel + enforcement. DRAFTER: full professional-liability disclaimer externalised to src/config/disclaimers.ts (EN/FR/DE). Three new branches D (correction return), E (simplified annual), F (post-AED amendment). Subject line includes matricule + draft status. "LU bank working day" wrongly used for filing deadline — corrected to "LU administrative working day"; payment deadline distinct, interest at 7.2%/year under Art. 81 LTVA cited. Observation list extended with scope-limitation, audit-risk quantification, filing + payment deadlines, Art. 61 validity flags. AED-READER: 7 new categories (relance_simple, courrier_amiable, sursis_de_paiement, remise_gracieuse, demande_caution, notification_controle, pv_de_controle). Per-category appeal-deadline table (40 days for fixation_d_acompte — the old single 3-month rule was wrong). New fields: next_action, notification_date, recipient_name, iban_for_payment, contact_officer, enclosures_referenced, balance_sign, basis_note, refund_granted/amount, vat_number. SHARED CONFIG: src/config/legal-suffixes.ts unifies the fuzzy-match list between extractor and triage; src/config/disclaimers.ts holds the EN/FR/DE disclaimer. MIGRATION e3_prompt_audit_fields added the 11 new invoice columns + 17 new aed_communications columns. invoices.direction made nullable. |

---

## 9. How to add a new legal source

1. Identify what it is: law amendment, circular, court decision, market
   practice shift, or an administrative policy change.
2. Add a typed entry to the matching map in `src/config/legal-sources.ts`
   (LU_LAW / EU_LAW / CIRCULARS / CASES_EU / CASES_LU / PRACTICE).
3. Set `last_reviewed` to today. Set `effective_from` to the source's
   own effective date.
4. If the new source REPLACES an older one, set the old entry's
   `effective_until` to the new one's `effective_from` and its
   `superseded_by` to the new id.
5. Find every rule / box / prompt affected and update its cited source
   id. Run `npm test` and `npm run build`.
6. Add a row to the changelog in §8 with date, reviewer, scope and a
   one-sentence note.

The key discipline: **never cite a legal position in code without a
structured source id.** Plain-text citations rot silently as the law
evolves.
