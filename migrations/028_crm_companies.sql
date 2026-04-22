-- 028_crm_companies — first table of the /crm module (stint 25).
--
-- Replaces Diego's Notion "Companies" database. Mirrors its fields
-- + adds tags[], linkedin_url, website, and entity_id FK to the tax
-- module so a CRM company can be linked to a cifra-managed entity
-- (when the CRM account becomes a tax client).
--
-- All enum-like columns are snake_case in the DB. Emojis stay in the
-- UI render layer only — keeps Excel exports / SQL queries clean.
--
-- notion_page_id is kept to make the import idempotent (UPSERT on
-- conflict). After the Notion migration is stable and backup is no
-- longer needed, this column can be dropped.

CREATE TABLE IF NOT EXISTS crm_companies (
  id                    text PRIMARY KEY,
  notion_page_id        text UNIQUE,

  company_name          text NOT NULL,
  country               text,
    -- ISO-3166-alpha-2: LU | FR | GB | IT | ES | DE | PT | BR | HK | FI | ...
  industry              text,
    -- family_office | service_provider | law_firm | private_wealth
    -- real_estate | banking | private_equity | other
  size                  text,
    -- large_cap | mid_market | sme | startup
  classification        text,
    -- key_account | standard | occasional | not_yet_client
  website               text,
  linkedin_url          text,
  tags                  text[] NOT NULL DEFAULT '{}',
  notes                 text,
  lead_counsel          text,  -- session user id (single owner)

  -- Cross-module tie-in (stint-25 slice D / fase 4): a CRM company
  -- can optionally be linked to a cifra `entities` row so the Tax
  -- tab on the company detail page shows that entity's declarations.
  entity_id             text REFERENCES entities(id),

  created_at            timestamptz NOT NULL DEFAULT NOW(),
  updated_at            timestamptz NOT NULL DEFAULT NOW(),
  deleted_at            timestamptz
);

CREATE INDEX IF NOT EXISTS idx_crm_companies_classification
  ON crm_companies (classification)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_crm_companies_country
  ON crm_companies (country)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_crm_companies_entity_id
  ON crm_companies (entity_id)
  WHERE entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_companies_tags_gin
  ON crm_companies USING GIN (tags);

COMMENT ON TABLE crm_companies IS
  'CRM accounts (companies). Migrated from Notion "Companies" + extended with tags, linkedin_url, website, entity_id.';
COMMENT ON COLUMN crm_companies.classification IS
  'Veeva-style KAM tier: key_account, standard, occasional, not_yet_client.';
COMMENT ON COLUMN crm_companies.entity_id IS
  'Optional FK to cifra entities table — when set, the CRM company is also a cifra-managed tax entity.';
