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

## 3 · VAT filing deadlines — statutory + administrative tolerance

**Statement**: every VAT filing carries two deadlines: the **statutory**
date (the legal deadline under LTVA) and the **effective** date
(statutory + the AED's administrative tolerance). cifra stores both
on `tax_filings` (`statutory_deadline_date` + `deadline_date`); the
effective is what alerts/badges fire on, the statutory is shown as
the legal reference.

**Source**:
- LTVA Art. 64 — monthly + quarterly returns due "le 15 du mois suivant
  la période d'imposition" (15th of the month following the period).
- LTVA Art. 64bis — annual recapitulative for régime ordinaire due
  **1 May N+1**.
- LTVA Art. 67bis — annual return for régime simplifié due
  **1 March N+1**.
- AED administrative practice (Diego, LU VAT expert, 2026-05-07):
  - Annuals (both ordinaire and simplifié): tolerance until
    **30 October N+1**.
  - Periodic (monthly + quarterly): tolerance ≈ **+60 days** past
    the legal deadline (~2 months).

**Encoded in `tax_deadline_rules` (mig 090)**:

| `id` | `rule_kind` | Statutory | Effective |
|---|---|---|---|
| `rule_vat_annual` | `fixed_md_with_extension` | 1 May N+1 | 30 Oct N+1 |
| `rule_vat_simplified_annual` | `fixed_md_with_extension` | 1 March N+1 | 30 Oct N+1 |
| `rule_vat_quarterly` | `days_after_period_end` (15) + `admin_tolerance_days = 60` | period_end + 15d | + 60d |
| `rule_vat_monthly` | `days_after_period_end` (15) + `admin_tolerance_days = 60` | period_end + 15d | + 60d |

**Enforcement points**:
- `src/lib/tax-ops-deadlines.ts` `computeDeadline()` returns
  `{ statutory, extension, effective }`. For
  `days_after_period_end` rules with `admin_tolerance_days > 0` the
  `extension` is `statutory + admin_tolerance_days * 1 day`. For
  `fixed_md_with_extension` the extension is the explicit
  `extension_month/extension_day` pair.
- Writers (`/api/tax-ops/rollover`, `/api/tax-ops/filings` POST) write
  both `deadline_date` (= effective) and `statutory_deadline_date`
  (= statutory).
- Readers (`/api/tax-ops/matrix`, `/api/tax-ops/filings/[id]`) expose
  both. UI component `DeadlineWithTolerance` displays the effective as
  the primary urgency-coloured date and the statutory as a small muted
  secondary line ("legal · YYYY-MM-DD").
- Home dashboard / sidebar badges read `deadline_date` only — alerts
  fire as the *effective* approaches, not the statutory. This is the
  behaviour Diego asked for ("alertas solo cuando se acerca la fecha
  de la administrative tolerance").

**Closed filings** (status ∈ `filed/paid/waived`) keep their historic
deadline_date for audit; only OPEN filings are recomputed when a rule
changes (mig 090 backfill).

---

## 4 · Future rules to add here

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
