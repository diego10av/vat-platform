-- 033_crm_activities — timeline events (stint 25).
--
-- Every call, meeting, email, proposal, hearing, deadline, or
-- miscellaneous note attaches to an Activity. Activities can relate
-- to a contact, company, opportunity, and/or matter simultaneously.
--
-- Multiple contacts per activity are stored via a dedicated junction
-- (crm_activity_contacts) rather than a JSON array — that way we
-- can index "all activities where contact X participated" cheaply.
--
-- Adds vs Notion:
--   - `outcome` (text) DISTINCT from `notes`. Outcome = "what
--     happened in the call" (summary). Notes = "anything else I want
--     to remember" (long-form). This split matches Veeva's call
--     report format.

CREATE TABLE IF NOT EXISTS crm_activities (
  id                 text PRIMARY KEY,
  notion_page_id     text UNIQUE,

  name               text NOT NULL,
  activity_type      text NOT NULL,
    -- call | meeting | email | proposal | hearing | deadline | other
  activity_date      timestamptz NOT NULL,
  duration_hours     numeric(6,2),
  billable           boolean NOT NULL DEFAULT false,
  lawyer             text,

  -- Single primary relation per type (for fast filter "by company X").
  -- Multiple contacts handled via crm_activity_contacts below.
  primary_contact_id text REFERENCES crm_contacts(id),
  company_id         text REFERENCES crm_companies(id),
  opportunity_id     text REFERENCES crm_opportunities(id),
  matter_id          text REFERENCES crm_matters(id),

  outcome            text,
  notes              text,

  created_at         timestamptz NOT NULL DEFAULT NOW(),
  updated_at         timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_activities_date
  ON crm_activities (activity_date DESC);
CREATE INDEX IF NOT EXISTS idx_crm_activities_matter
  ON crm_activities (matter_id)
  WHERE matter_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_activities_opportunity
  ON crm_activities (opportunity_id)
  WHERE opportunity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_activities_company
  ON crm_activities (company_id)
  WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_activities_primary_contact
  ON crm_activities (primary_contact_id)
  WHERE primary_contact_id IS NOT NULL;

-- Junction for activities with multiple contacts in attendance.
CREATE TABLE IF NOT EXISTS crm_activity_contacts (
  activity_id        text NOT NULL REFERENCES crm_activities(id) ON DELETE CASCADE,
  contact_id         text NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
  PRIMARY KEY (activity_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_activity_contacts_contact
  ON crm_activity_contacts (contact_id);

COMMENT ON TABLE crm_activities IS
  'Timeline events (calls/meetings/emails/...). Adds `outcome` distinct from `notes`, mirroring Veeva call-report format.';
