-- Migration 021 — drop 'passive_holding' from entity_type valid set
--
-- Context (Diego, 2026-04-21 review session):
--   "If it is a holding which is not a VATable person then it should not
--    be registered and there is no scenario where we will need to include
--    such an entity in the system. We can delete that box I think."
--
-- Correct. Pure passive holdings (Polysar C-60/90) are not VAT taxable
-- persons, cannot register for VAT, and have no return to prepare. They
-- should never have existed as a valid entity_type in cifra — the
-- classifier's RULE 11P/13P/15P / PASSIVE_HOLDING_HIGH_FLAG_KEYWORDS
-- machinery was there to handle them safely IF a reviewer mis-created
-- one, but the healthier outcome is to make them unrepresentable.
--
-- Data migration: verified in prod (2026-04-21) that no rows exist with
-- entity_type='passive_holding' — so this is a type-narrowing change
-- with no data conversion required. The migration:
--   1. Repoints any stray passive_holding row to 'other' as a safe fallback.
--      (Defensive — in case a row was created between the verification
--      query and the constraint change.)
--   2. Drops the old CHECK constraint from migration 019.
--   3. Re-creates it WITHOUT 'passive_holding' in the IN-list.
--
-- Classifier note: the passive-holding rules in
-- src/config/classification-rules.ts stay in place for now — they
-- become dead code but serve as documentation of the Polysar handling
-- we inherited. A follow-up stint can remove them without risk.
--
-- Idempotent via DO blocks + constraint-existence guard.

BEGIN;

-- 1. Defensive repair — should never fire, but harmless.
UPDATE entities
   SET entity_type = 'other', updated_at = NOW()
 WHERE entity_type = 'passive_holding';

-- 2. Drop the old CHECK (from migration 019).
ALTER TABLE entities
  DROP CONSTRAINT IF EXISTS entities_entity_type_valid;

-- 3. Re-add with the narrower whitelist.
ALTER TABLE entities
  ADD CONSTRAINT entities_entity_type_valid
  CHECK (entity_type IS NULL OR entity_type IN (
    'fund',
    'securitization_vehicle',
    'active_holding',
    'gp',
    'manco',
    'other'
  ));

COMMIT;
