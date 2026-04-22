# Import Notion CRM → cifra

**Status**: script ready · awaits Diego's NOTION_TOKEN setup to execute.

One-shot migration tool that copies Diego's 6 Notion CRM databases
(Companies / Contacts / Opportunities / Matters / Activities / Billing)
into the `crm_*` tables in Supabase (migrations 028-035).

## Why a script and not the MCP

The Notion MCP exposes `notion-search` with a semantic query capped at
25 results with no pagination token — fine for exploration, insufficient
for an exhaustive copy. The official Notion SDK (`@notionhq/client`) has
proper cursor-based pagination and returns every row.

## One-time setup (Diego, ~3 minutes)

1. **Create a Notion integration**
   - Open https://www.notion.so/my-integrations
   - "New integration" → name it `cifra import`, type `Internal`,
     workspace `Manso Partners`
   - Capabilities: `Read content` is enough (no need for write/comments)
   - Click "Save"

2. **Copy the integration secret**
   - In the integration's "Configuration" tab, reveal + copy
     `Internal Integration Secret` (starts with `ntn_`)

3. **Add it to `.env.local`** in the cifra repo:
   ```
   NOTION_TOKEN=ntn_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```
   Restart any dev server.

4. **Share the CRM page with the integration**
   - Open the CRM page in Notion (the one Diego sent earlier)
   - Top-right `...` menu → `Connect to` → select `cifra import`
   - This propagates read access down to the 6 child databases.

5. **Tell Claude the setup is done**, and I run:
   ```bash
   npx tsx scripts/import-notion-crm.ts --dry-run
   ```
   This reads without writing — shows row counts + data-quality flags.

6. If the dry-run looks clean, I run the real import:
   ```bash
   npx tsx scripts/import-notion-crm.ts
   ```

## What the script does

1. Paginates every row of every database via Notion SDK.
2. Maps Notion enum labels (with emojis) to cifra snake_case values
   (e.g. `🔑 Key Account` → `key_account`).
3. Splits the Notion `Type` column on Contacts into `lifecycle_stage`
   (single state: lead/prospect/customer/former_customer) + `role_tags`
   (multi-tag: referrer/opposing_party).
4. Normalizes countries to ISO-3166-alpha-2 (`Luxembourg` → `LU`).
5. Inserts in FK-dependency order:
   - companies → contacts → contact_companies junction → opportunities
     → matters → activities → activity_contacts junction → billing
6. Pass 2: resolves the self-FK `referred_by_contact_id` on contacts.
7. For Billing invoices without a number, auto-generates
   `MP-YYYY-NNNN` based on issue_date year + sequence.
8. Prints final counts per table.

## Idempotency

Every target row has a `notion_page_id` column and the script uses
`ON CONFLICT (notion_page_id) DO UPDATE SET ...`. Re-running is safe:
rows that already exist are updated in place (lets us iterate the
mapping logic without wiping data).

## Skipped / best-effort behavior

- **Activities without a Date** are skipped (`activity_date` is NOT NULL).
- **Billing rows without both Amount columns** are skipped
  (`amount_excl_vat` + `amount_incl_vat` are NOT NULL).
- **`paid_date`** is approximated as `issue_date` when the invoice
  status is `✅ Paid` in Notion (Notion doesn't track paid_date
  separately). Override manually when this matters.
- **Lead counsel** is a People property in Notion; we store the raw
  Notion user UUID. cifra doesn't have a users table that maps to
  those UUIDs yet — these IDs are kept for future reconciliation.
- **Website / LinkedIn / tags on Companies** — not in Notion source,
  stay empty post-import. Populate manually later if needed.

## Data handling

- The script reads from Notion and writes to Diego's Supabase
  (`jfgdeogfyyugppwhezrz`). Nothing real touches the repo.
- Output is aggregate counts only — no names, emails, amounts
  printed. If a row errors out, only the Notion page UUID + column
  name appears in the error message (redact before sharing).
- The `.env.local` with `NOTION_TOKEN` stays local (covered by
  `.gitignore`). Rotate in the Notion integration settings whenever
  you want.

## Post-import checklist

- [ ] Compare Supabase counts vs Notion counts. Should match within
      the "skipped" exceptions noted above.
- [ ] Spot-check a single company in cifra `/crm/companies` (fase 2
      when UI ships) vs Notion. Verify country, classification, linked
      contacts.
- [ ] Run typecheck + tests: `npx tsc --noEmit && npx vitest run`.
- [ ] Commit (script + migrations; no data).

## If the Notion CRM evolves post-import

Two options:
1. **Re-run the script** — idempotent UPSERT pattern handles
   additions + edits. New rows in Notion get inserted; existing rows
   get refreshed.
2. **Treat cifra as canonical** from import day onward, and stop
   updating Notion. Recommended once Diego has validated the data +
   the UI is usable.

## Rollback

If something goes wrong:
```sql
TRUNCATE TABLE crm_companies, crm_contacts, crm_contact_companies,
               crm_opportunities, crm_matters, crm_activities,
               crm_activity_contacts, crm_billing_invoices,
               crm_billing_payments CASCADE;
```
Then fix the script and re-run. Migrations themselves are idempotent
(`CREATE TABLE IF NOT EXISTS`) so no DDL rollback needed.
