# Tax-Ops migration — 2026-04-24

Audit trail of the one-shot data migration that moved Diego's two
annual Excel books (+ deferred Notion DB) into the `/tax-ops` Postgres
module landed in stint 34.

## What moved, where

| Source file | Sheets | Rows (source) | Target tables |
|---|---|---|---|
| `CIT (DGM) - 2026.xlsx` | 4 (container + 3 flat) | 148 CIT rows + N extras | `tax_client_groups`, `tax_entities`, `tax_obligations`, `tax_filings` |
| `VAT & Others (DGM) - 2026.xlsx` | 7 (per tax_type) | 83 VAT/other rows | same tables |
| Notion "Tasks & Follow-ups" DB (`d6488f84b6ac46eb86ec23199d06c049`) | 1 | N tasks | `tax_ops_tasks` (deferred — see below) |

## Sheet → tax_type mapping

### CIT book
| Sheet | tax_type | Notes |
|---|---|---|
| Container sheet (auto-detected when col B has ≥3 distinct values) | `cit_annual` | Group label taken per-row from col B |
| Flat CIT sheets (group = sheet name) | `cit_annual` | e.g. fund-family-named sheets |
| FCR sheet (or any sheet with "functional currency request" in a header) | `functional_currency_request` | Auto-detected by sheet name `/^fcr$/i` or header pattern |
| Column "2024 Tax assessment received = Yes" | extra historical `cit_annual` 2024 filing | status = `assessment_received` |
| Column "2026 NWT check" | extra `nwt_annual` 2026 filing | parsed via `parseStatusCell` |

### VAT & Others book
| Sheet | tax_type | period_pattern |
|---|---|---|
| `2026 Annual` | `vat_annual` | annual |
| `Quarterly 2026` | `vat_quarterly` | quarterly |
| `Monthly 2026` | `vat_monthly` | monthly |
| `Subscription Tax` | `subscription_tax_quarterly` | quarterly |
| `WHT director` | `wht_director_monthly` | monthly |
| `VAT (de)registration` | `vat_registration` | adhoc |
| `BCL Reporting` | `bcl_sbs_quarterly` | quarterly |

Per-period columns (Q1–Q4, Jan–Dec) expand into one `tax_filings` row
per non-empty cell — each with its own status parsed from that cell.

## Status parser heuristics

Implemented in `src/lib/tax-ops-parsers.ts :: parseStatusCell`:

| Source cell pattern | Parsed status | Fields set |
|---|---|---|
| `Filed on DD.MM.YYYY` | `filed` | `filed_at` |
| `Draft sent DD.MM.YYYY` / `Sent to client …` | `draft_sent` | `draft_sent_at` |
| `Waiting for X` / `Waiting financials` | `blocked` | `comment` = raw cell |
| `Yes` (in "assessment received" column) | `assessment_received` | — |
| `Accepted` / `Approved` | `pending_client_approval` | — |
| `Cancelled` / `N/A` / `Waived` | `waived` | — |
| Empty / missing | `pending_info` | — |
| Anything else | `working` | `comment` = raw cell |

## Deadline auto-compute

At insert time, every filing queries `tax_deadline_rules` by
`(tax_type, period_pattern)` and runs `computeDeadline(rule, year, period_label)`
from `src/lib/tax-ops-deadlines.ts`. Three rule kinds supported:

- `days_after_period_end` → period_end + N days (e.g. VAT quarterly = Q end + 15d)
- `fixed_md` → (year+1, month, day) (e.g. VAT annual = 1 March N+1)
- `fixed_md_with_extension` → statutory + admin tolerance (e.g. CIT 31 Mar statutory, 31 Dec extension via AED-standard prorogation)

Ad-hoc filings (e.g. VAT (de)registration, functional_currency_request)
get `deadline_date = NULL` — they're one-offs, deadline set manually
per filing.

## Entity dedup logic

Entities dedupe by `(client_group, normalized_legal_name)`:
- `client_group` normalized via uppercase + whitespace collapse (merges "Foo" / "FOO" / "foo " and similar case/whitespace variants)
- `legal_name` normalized via NFKC + whitespace collapse + lowercase (merges case + accent variants)

Prior to this normalization the dry-run produced 21 groups / 224 entities.
Post-normalization: 19 groups / 214 entities — the drop reflects the
merge of spelling / whitespace variants.

## Production counts (post-commit)

```
SELECT COUNT(*) FROM tax_client_groups;     --  19
SELECT COUNT(*) FROM tax_entities;          -- 214
SELECT COUNT(*) FROM tax_obligations;       -- 233
SELECT COUNT(*) FROM tax_filings;           -- 259 (263 processed, 4 dropped as duplicates)
SELECT COUNT(*) FROM tax_deadline_rules;    --  13 (seeded by migration 045)
SELECT COUNT(*) FROM audit_log
  WHERE action='tax_ops_bulk_import';       --   1 (the import tx)
```

Status distribution at import:
- 129 pending_info
- 54 working
- 41 filed
- 30 assessment_received
- 4 blocked
- 1 pending_client_approval

Filings by tax_type:
- 175 cit_annual
- 59 vat_annual
- 10 vat_quarterly
- 7 vat_monthly
- 7 wht_director_monthly
- 3 functional_currency_request
- 2 bcl_sbs_quarterly
- 1 nwt_annual
- 1 subscription_tax_quarterly

## Deadlines — sanity check

| tax_type · period | Example filing deadline | Expected (per rule) | ✓ |
|---|---|---|---|
| cit_annual · 2026 | 2027-12-31 | statutory 2027-03-31, AED extension 2027-12-31 | ✓ |
| nwt_annual · 2026 | 2027-12-31 | same mechanics as CIT | ✓ |
| vat_annual · 2026 | 2027-03-01 | fixed_md month=3 day=1, N+1 | ✓ |
| vat_monthly · 2026-01 | 2026-02-15 | Jan 31 + 15 days | ✓ |
| vat_monthly · 2026-02 | 2026-03-15 | Feb 28 + 15 days (leap-safe) | ✓ |
| vat_quarterly · 2026-Q1 | 2026-04-15 | Mar 31 + 15 days | ✓ |
| wht_director_monthly · 2026-01 | 2026-02-10 | Jan 31 + 10 days | ✓ |

## Notion migration — deferred

Diego's "Tasks & Follow-ups" DB (database id `d6488f84b6ac46eb86ec23199d06c049`)
was NOT migrated as part of stint 34. The NOTION_TOKEN configured for
the importer script doesn't have access to that DB (only the MCP's
OAuth does), and migrating tasks before the `/tax-ops/tasks` UI shipped
would have buried them in an invisible table. Both constraints
resolved as of stint 34.E (tasks surface shipped).

A follow-up one-shot import can be run anytime — either by granting
the NOTION_TOKEN access to the DB and running
`scripts/tax-ops-import.ts` with a Notion-enabled branch, or by
copy-pasting rows into the `/tax-ops/tasks` UI.

## Known small deltas

- **259 filings in DB vs 263 processed**: 4 rows dropped by the
  `ON CONFLICT (obligation_id, period_label) DO NOTHING` guard.
  These were duplicate period-label combinations from Excel cells
  (e.g. "Q1+Q2" status cell repeated in two sheets' columns).
  Acceptable — one row per filing obligation is the desired shape.
- **9 obligations without filings**: obligations templated from
  "Annual + quarterly" periodicity strings where only one of the
  two patterns had any source data. They sit in the DB as ready
  templates for year-rollover; no data loss.

## Rollback path (if ever needed)

The import is fully reversible:

```sql
DELETE FROM tax_filings WHERE import_source = 'excel_import';
DELETE FROM tax_obligations
 WHERE NOT EXISTS (SELECT 1 FROM tax_filings f WHERE f.obligation_id = tax_obligations.id);
DELETE FROM tax_entities
 WHERE NOT EXISTS (SELECT 1 FROM tax_obligations o WHERE o.entity_id = tax_entities.id);
DELETE FROM tax_client_groups
 WHERE NOT EXISTS (SELECT 1 FROM tax_entities e WHERE e.client_group_id = tax_client_groups.id);
```

Deadline rules (seeded by migration 045, not the importer) stay put
— they're static reference data.

## 2026-04-24 follow-up (stint 35)

After Diego opened `/tax-ops` for real, two data problems surfaced
and were corrected in stint 35:

### Problem 1: NWT was modelled as a filing

My importer created `nwt_annual` filing rows for every "2026 NWT check"
column value in the CIT book. Diego clarified NWT is an internal advisory
review (interim financials → tax-leakage check → restructuring memo)
done for opted-in clients only — not a filing.

**Fix (migration 046)**:
- Added `service_kind TEXT NOT NULL DEFAULT 'filing'` to `tax_obligations`
  with a partial index on `(service_kind='review', is_active)`.
- `UPDATE tax_obligations SET service_kind='review' WHERE tax_type='nwt_annual'`
  — 1 row affected in prod.
- Updated `rule_nwt_annual` from `fixed_md_with_extension {month:3,day:31,
  ext:12/31}` to `fixed_md {month:11,day:30}` with 30d tolerance.
  Statutory / market notes rewritten to describe the review workflow.

### Problem 2: Year mismatch for annual filings

The Excel book is labelled "2026" because Diego works on it in 2026, but
the annual filings (CIT, VAT annual, FATCA/CRS, WHT annual, NWT review)
inside are actually 2025 work. The periodic filings (VAT Q/M, subscription,
WHT monthly, BCL) are genuinely 2026 (current year).

**Fix (`scripts/tax-ops-data-fix.ts`)**:
- Targeted only `import_source='excel_import' AND period_year=2026 AND
  tax_type IN (cit_annual, nwt_annual, vat_annual, vat_simplified_annual,
  wht_director_annual, fatca_crs_annual)`.
- For each: `period_year=2025`, `period_label='2025'`, `deadline_date`
  recomputed via `computeDeadline(rule, 2025, '2025')`. Transactional
  with post-update sanity check — if any row still at year=2026, rollback.
- Result: **200 filings shifted** (140 cit_annual + 59 vat_annual + 1
  nwt_annual). All deadlines recomputed:
    - CIT 2025 → 2026-12-31 (AED extension)
    - VAT annual 2025 → 2026-03-01
    - NWT review 2025 → 2026-11-30 (new rule)

### Verification (post-fix)

```sql
SELECT o.tax_type, f.period_year, COUNT(*) AS n, MIN(f.deadline_date) AS dl
  FROM tax_filings f
  JOIN tax_obligations o ON o.id = f.obligation_id
 WHERE f.import_source='excel_import'
 GROUP BY o.tax_type, f.period_year
 ORDER BY o.tax_type, f.period_year;
```

Expected (and observed):
- `cit_annual · 2024 · 31 · 2025-12-31` (historical assessments)
- `cit_annual · 2025 · 140 · 2026-12-31` ✓
- `nwt_annual · 2025 · 1 · 2026-11-30` ✓
- `vat_annual · 2025 · 59 · 2026-03-01` ✓
- `vat_quarterly · 2026 · 10 · 2026-04-15` (untouched)
- `vat_monthly · 2026 · 6 · 2026-02-15..2026-04-15` (untouched)
- `wht_director_monthly · 2026 · 6 · 2026-02-10` (untouched)
- `subscription_tax_quarterly · 2026 · 1 · 2026-04-15` (untouched)
- `bcl_sbs_quarterly · 2026 · 2` (untouched, no rule → null deadline)
- `functional_currency_request · 2026 · 3` (ad-hoc, null deadline)

## Re-running the importer

Safe to re-run. ON CONFLICT DO NOTHING guards handle duplicate
inserts at both the `tax_client_groups` level (UNIQUE on name) and
`tax_obligations` / `tax_filings` (UNIQUE on their natural keys).
`tax_entities` has no UNIQUE constraint on `legal_name` — re-running
without cleaning up first WILL duplicate entities. If re-running
after a test, run the rollback SQL above first.
