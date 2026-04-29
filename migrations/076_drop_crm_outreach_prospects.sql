-- Migration 076 — drop crm_outreach_prospects (stint 64.Q.8)
--
-- Diego: "acaba el trabajo" — final cleanup of the Outreach surface.
-- Stint 64.Q.7 folded the cold-prospecting pipeline into the unified
-- Opportunities pipeline; the /api/crm/outreach endpoints + the
-- /crm/outreach page were already neutralised (redirect to
-- /crm/opportunities). The DB table itself was kept as a safety
-- parking spot. Verified empty (0 rows) before this drop.
--
-- Reversal path: the original CREATE lives in migration 049
-- (crm_outreach.sql). Re-running that file recreates the table if
-- ever needed.

DROP TABLE IF EXISTS crm_outreach_prospects;
