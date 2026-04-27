# LTVA — procedural rules cifra must respect

Reference document for **filing-cadence and obligation-structure rules**
under the Luxembourg VAT law (LTVA — *Loi du 12 février 1979 concernant
la taxe sur la valeur ajoutée*, as amended). Distinct from
`classification-research.md` (which covers the substantive classification
of supplies). Every rule here is enforced in code and the citation must
stay in sync with the source.

> **For Claude**: read this BEFORE adding or modifying anything that
> creates VAT obligations or filing rows. Diego corrected stint 51.G
> with: "deberías saber estas cosas, tienes acceso a la ley de IVA
> luxemburgués." This file is the single source of truth so that
> correction never has to repeat.

---

## 1 · Periodic VAT implies annual recapitulative

**Statement**: any taxable person filing VAT monthly OR quarterly is
**also** required to file the *déclaration annuelle récapitulative*
(annual VAT return) at year-end.

**Source**:
- LTVA Art. 64bis §1 — annual return obligation for every taxable
  person registered under the regular regime.
- AED Circulaire 765bis (2017-12-15) — clarifies that monthly /
  quarterly returns are interim filings and do not replace the annual
  recapitulative.

**Practical consequence**: an entity in cifra's tax-ops cannot have
`vat_monthly` or `vat_quarterly` active without also having
`vat_annual` active. The reverse IS allowed (annual-only means small
volume, no periodic obligation).

**Enforcement points** (defence in depth — UI + API both guard):
- `NewEntityModal.tsx` — VAT checkbox group locks `vat_annual` on
  while `vat_quarterly` or `vat_monthly` is selected; tooltip cites
  this rule.
- `AddEntityRow` invocations on `/tax-ops/vat/quarterly` and
  `/tax-ops/vat/monthly` pages pass `additionalObligations=[vat_annual]`
  so the per-family quick-add path also respects the rule.
- `/api/tax-ops/obligations` POST — when `tax_type ∈
  {vat_quarterly, vat_monthly}` and `service_kind = 'filing'`, the
  endpoint also INSERTs `vat_annual` for the same entity (idempotent
  via `ON CONFLICT (entity_id, tax_type, period_pattern)`). The
  companion audit_log entry carries `auto_companion: true,
  ltva_basis: "Art. 64bis + AED Circ. 765bis"` so the trail is
  unambiguous about which rows the user typed and which the rule
  auto-created. Stint 51.H.

---

## 2 · Annual simplified is mutually exclusive with the regular regime

**Statement**: the *régime simplifié* (annual simplified return)
applies to small businesses with annual turnover ≤ €112 000 (LTVA
Art. 67bis). It REPLACES the regular regime's annual + periodic
filings. An entity cannot hold `vat_simplified_annual` together with
any of `vat_annual`, `vat_quarterly`, or `vat_monthly`.

**Source**:
- LTVA Art. 67bis — small-business annual return.
- AED instruction (2024-01-01 update raised the threshold from €100k).

**Enforcement points**:
- `NewEntityModal.tsx` — selecting `vat_simplified_annual` disables
  the other three VAT checkboxes and unticks them; selecting any of
  the other three unticks simplified.
- The cell-level subtype switcher on `/tax-ops/vat/annual` (stint
  48.F1.A `VatSubtypeInlineCell`) already toggles between
  `vat_annual` and `vat_simplified_annual` atomically — the API
  swaps tax_type rather than letting both coexist on the same entity.

---

## 3 · Future rules to add here

Place-holder so this doc grows as we hit them. Each entry should
include: statement, statutory cite, enforcement point, and the stint
where it landed.

- (—) WHT director cadence rules — picked by article 152 LIR; cifra
  exposes 4 cadences and lets the user choose.
- (—) Subscription tax periodicity — quarterly only for SICAV-RAIFs +
  some FCPs; need rule when we extend the matrix to other vehicles.

---

## How to extend

1. Find the LTVA / LIR article that mandates the rule.
2. Add a section here with statement + source + enforcement points.
3. Implement the rule in the relevant place(s) in code; comment with
   a `LTVA Art. X` reference.
4. If the rule blocks an action that the API used to allow, add the
   guard at the API level too — UI-only enforcement is bypassable.
