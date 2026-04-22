-- 029_crm_contacts — natural persons on the CRM side (stint 25).
--
-- Replaces Notion "Contacts" with these changes vs the source:
--
--  1. `lifecycle_stage` SEPARATED from `role_tags[]`. The Notion
--     "Type" column mixed lifecycle (Lead/Prospect/Active/Inactive)
--     with functional role (Referrer/Opposing party). Salesforce
--     +Veeva split them: lifecycle is a single state, roles are
--     multi-tag.
--
--  2. `consent_status` enum + `consent_date` + `consent_source`
--     instead of a simple boolean GDPR flag. Gives us an auditable
--     RGPD Art. 7 record.
--
--  3. `engagement_level` is auto-computed by a daily job based on
--     `last_activity_at` (<30d = active, 30-180 = dormant, >180 =
--     lapsed). `engagement_override` lets the reviewer force a value
--     when the heuristic is wrong (e.g. a long-running matter with
--     no activities logged).
--
--  4. `lead_score` + `lead_score_reasoning` filled monthly by Haiku.
--
--  5. `preferred_language` for tailoring outreach.
--
-- Removed vs Notion:
--   - Dualidad Company / "Companies (linked)" — reemplazada por la
--     junction table crm_contact_companies (migration 030).
--   - Rollup explícito "Contacts-Activities" — derivado on-read
--     desde crm_activities.

CREATE TABLE IF NOT EXISTS crm_contacts (
  id                     text PRIMARY KEY,
  notion_page_id         text UNIQUE,

  full_name              text NOT NULL,
  email                  text,
  phone                  text,
  linkedin_url           text,
  job_title              text,
  country                text,            -- ISO-3166-alpha-2
  preferred_language     text,            -- en | fr | de | es | lu | pt | it

  -- Lifecycle + roles split. Lifecycle = single state. Roles = multi-tag.
  lifecycle_stage        text,
    -- lead | prospect | customer | former_customer
  role_tags              text[] NOT NULL DEFAULT '{}',
    -- any of: referrer, decision_maker, billing_contact, internal, opposing_party
  areas_of_interest      text[] NOT NULL DEFAULT '{}',
    -- real_estate, litigation, fund_regulatory, tax, m_a, employment

  -- Engagement tracking.
  engagement_level       text,
    -- auto-computed: active | dormant | lapsed
  engagement_override    text,
    -- reviewer's manual override; when set, supersedes engagement_level in the UI

  source                 text,
    -- referral | linkedin | event | website | cold_call | service_provider | friend | other

  -- Lead scoring (Haiku monthly batch).
  lead_score             integer CHECK (lead_score IS NULL OR (lead_score >= 0 AND lead_score <= 100)),
  lead_score_reasoning   text,

  -- GDPR Art. 7 consent tracking.
  consent_status         text,
    -- explicit | implicit | none | withdrawn
  consent_date           timestamptz,
  consent_source         text,

  referred_by_contact_id text REFERENCES crm_contacts(id),
  next_follow_up         date,

  notes                  text,
  lead_counsel           text,
  tags                   text[] NOT NULL DEFAULT '{}',

  -- Computed by trigger/app when activities get inserted/updated.
  last_activity_at       timestamptz,

  created_at             timestamptz NOT NULL DEFAULT NOW(),
  updated_at             timestamptz NOT NULL DEFAULT NOW(),
  deleted_at             timestamptz
);

CREATE INDEX IF NOT EXISTS idx_crm_contacts_email
  ON crm_contacts (email)
  WHERE email IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_crm_contacts_lifecycle
  ON crm_contacts (lifecycle_stage)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_crm_contacts_engagement
  ON crm_contacts (engagement_level)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_crm_contacts_next_follow_up
  ON crm_contacts (next_follow_up)
  WHERE next_follow_up IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_crm_contacts_role_tags_gin
  ON crm_contacts USING GIN (role_tags);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_tags_gin
  ON crm_contacts USING GIN (tags);

COMMENT ON TABLE crm_contacts IS
  'CRM contacts (people). lifecycle_stage + role_tags split keeps state separate from role, following Salesforce/Veeva best practice.';
COMMENT ON COLUMN crm_contacts.engagement_level IS
  'Auto-computed daily: active (<30d since last_activity), dormant (30-180d), lapsed (>180d). engagement_override trumps when set.';
COMMENT ON COLUMN crm_contacts.lead_score IS
  'Haiku-computed monthly. 0-100 with lead_score_reasoning explaining the number.';
