-- 031_crm_opportunities — sales pipeline (stint 25).
--
-- Mirrors Notion Opportunities + adds:
--   - `stage_entered_at` so we can compute velocity ("avg 14 days in
--     Meeting Held stage"). Updated by app layer whenever `stage`
--     changes.
--   - `next_action` (free text) + `next_action_due` (date) — distinct
--     from `next_follow_up`. Captures "what needs to happen next",
--     not just when.
--   - `actual_close_date` — when a deal actually closed (won or lost),
--     distinct from the estimated date. Required for velocity metrics.
--   - `won_reason` — symmetric to loss_reason. Helps later sales
--     playbooks figure out what actually wins deals.
--   - `weighted_value_eur` as a STORED GENERATED column so queries
--     and Excel exports don't re-derive it.

CREATE TABLE IF NOT EXISTS crm_opportunities (
  id                    text PRIMARY KEY,
  notion_page_id        text UNIQUE,

  name                  text NOT NULL,
  company_id            text REFERENCES crm_companies(id),
  primary_contact_id    text REFERENCES crm_contacts(id),

  stage                 text NOT NULL,
    -- lead_identified | initial_contact | meeting_held
    -- proposal_sent | in_negotiation | won | lost
  stage_entered_at      timestamptz NOT NULL DEFAULT NOW(),

  practice_areas        text[] NOT NULL DEFAULT '{}',
    -- real_estate | litigation | employment | fund_regulatory | tax | m_a
  source                text,

  estimated_value_eur   numeric(14,2),
  probability_pct       integer CHECK (probability_pct IS NULL OR (probability_pct >= 0 AND probability_pct <= 100)),
  weighted_value_eur    numeric(14,2) GENERATED ALWAYS AS
                        (COALESCE(estimated_value_eur, 0) * COALESCE(probability_pct, 0) / 100.0) STORED,

  first_contact_date    date,
  estimated_close_date  date,
  actual_close_date     date,

  -- Next-action Salesforce-style.
  next_action           text,
  next_action_due       date,

  -- Post-mortem.
  loss_reason           text,
    -- competitor | price | no_response | conflict_of_interest | other
  won_reason            text,
    -- referral_strength | relationship | proposal_quality | fee_structure | other

  bd_lawyer             text,
  notes                 text,
  tags                  text[] NOT NULL DEFAULT '{}',

  created_at            timestamptz NOT NULL DEFAULT NOW(),
  updated_at            timestamptz NOT NULL DEFAULT NOW(),
  deleted_at            timestamptz
);

CREATE INDEX IF NOT EXISTS idx_crm_opportunities_stage
  ON crm_opportunities (stage)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_crm_opportunities_company
  ON crm_opportunities (company_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_crm_opportunities_estimated_close
  ON crm_opportunities (estimated_close_date)
  WHERE estimated_close_date IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_crm_opportunities_next_action
  ON crm_opportunities (next_action_due)
  WHERE next_action_due IS NOT NULL AND deleted_at IS NULL;

COMMENT ON COLUMN crm_opportunities.stage_entered_at IS
  'Updated by app whenever stage changes — lets velocity widgets compute days-in-stage without snapshot tables.';
COMMENT ON COLUMN crm_opportunities.weighted_value_eur IS
  'GENERATED ALWAYS: estimated_value_eur * probability_pct / 100. Stored so Excel export + pipeline-forecast queries are fast.';
