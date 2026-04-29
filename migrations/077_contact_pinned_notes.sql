-- Migration 077 — pinned_notes on crm_contacts (stint 64.U.3)
--
-- Pinned notes are short, always-visible reminders at the top of a
-- contact's detail page (allergies, timezone, "no email after 7pm",
-- "speaks French only"). Distinct from `notes` which is the long
-- free-form scratchpad — pinned ones are designed to scan in 1
-- second every time the page opens.
--
-- Pattern lifted from HubSpot ("Pinned note") and Notion's pinned
-- comments. Big-4 partners use the equivalent on InterAction
-- ("alerts" field).

ALTER TABLE crm_contacts
  ADD COLUMN IF NOT EXISTS pinned_notes TEXT;
