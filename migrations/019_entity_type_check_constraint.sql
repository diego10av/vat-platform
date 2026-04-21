-- Migration 019 — entity_type CHECK constraint
--
-- Context:
--   Yesterday's stint (16) added entity_type = 'securitization_vehicle' and
--   cleaned up an invalid 'soparfi' literal that had slipped into the seed
--   data. The column never had a CHECK constraint on the database side, so
--   the app boundary (TS enum + VALID_ENTITY_TYPES set in bulk-import) was
--   the only guard — and the onboarding seed bypassed it directly via raw
--   SQL, leaving one row with entity_type='soparfi' in prod.
--
--   This migration:
--     1. Repairs the one stale row (`onboard-entity` / "Demo SOPARFI SARL")
--        to the corrected values that the fixed seed script would produce.
--     2. Adds a NOT VALID CHECK constraint listing the 7 valid entity_type
--        values, then validates it — fails if any row still doesn't fit.
--
--   Idempotent: the DO blocks guard against double-apply.
--
-- Legal anchor:
--   SOPARFI is a regime label (Art. 166 LIR participation exemption), not
--   a VAT status. Pure passive SOPARFI → NOT a taxable person under
--   Polysar C-60/90 → maps to 'passive_holding'. Active SOPARFI providing
--   Cibo-type services → 'active_holding'. The onboarding seed represents
--   an active holding (dividends + limited intra-group services) so we
--   route the stale row there. See docs/classification-research.md §10.

BEGIN;

-- ─────────── 1. Repair the stale 'soparfi' row ───────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM entities WHERE entity_type = 'soparfi') THEN
    UPDATE entities
       SET entity_type = 'active_holding',
           name = CASE
             WHEN name = 'Demo SOPARFI SARL' THEN 'Demo Active Holding SARL'
             ELSE name
           END,
           updated_at = NOW()
     WHERE entity_type = 'soparfi';
  END IF;
END $$;

-- ─────────── 2. Add the CHECK constraint (idempotent) ───────────
-- The constraint name `entities_entity_type_valid` is stable so
-- re-running the migration is a no-op. NOT VALID first so we never
-- fail the migration if any legacy row slipped through the repair
-- step — we VALIDATE in step 3 and surface a clean error then.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'entities_entity_type_valid'
  ) THEN
    ALTER TABLE entities
      ADD CONSTRAINT entities_entity_type_valid
      CHECK (entity_type IS NULL OR entity_type IN (
        'fund',
        'securitization_vehicle',
        'active_holding',
        'passive_holding',
        'gp',
        'manco',
        'other'
      )) NOT VALID;
  END IF;
END $$;

-- ─────────── 3. Validate the constraint ───────────
-- Fails loudly if step 1 left anything invalid — that's what we want.
ALTER TABLE entities VALIDATE CONSTRAINT entities_entity_type_valid;

COMMIT;
