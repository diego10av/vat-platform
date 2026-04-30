-- ════════════════════════════════════════════════════════════════════
-- Migration 071 — UNIQUE on tax_obligations now includes service_kind
-- (stint 64.X.1.c)
-- ════════════════════════════════════════════════════════════════════
--
-- Until now: UNIQUE (entity_id, tax_type, period_pattern). One row per
-- entity × tax_type × period_pattern, regardless of service_kind. So
-- an entity could have EITHER a filing OR a provision OR a review for
-- (cit_annual, annual) — never two of them at the same time.
--
-- Diego's domain reality (clarified 2026-04-30):
--   "Lo de tax provision es independiente del tax return como tal,
--    o sea que debería poder editar y poner lo que yo quisiese en
--    todas las columnas, independientemente. Una no debería impactar
--    a la otra."
--
-- Concrete case: Jacques Holding SA + Jacques Invest S.A. were
-- created with `service_kind='provision'` because the client asked
-- for tax provisions only (interim calc shown on annual accounts as
-- "provision for fiscal effects"). The same entity may ALSO need a
-- filing obligation tracked separately — these are independent
-- workstreams. The schema must support both.
--
-- This migration drops the old constraint and adds the broader one
-- including service_kind. ON CONFLICT clauses in the obligations
-- POST endpoint are updated in the same stint to use the new tuple.
--
-- Idempotent: only drops if exists, only adds if not exists.
-- Zero data risk: all existing rows are unique under the broader
-- constraint (verified: no duplicates).

DO $$
BEGIN
  -- Drop legacy unique constraint if it still exists. The constraint
  -- name in mig 045 was the auto-generated one — Postgres named it
  -- tax_obligations_entity_id_tax_type_period_pattern_key.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'tax_obligations_entity_id_tax_type_period_pattern_key'
       AND conrelid = 'tax_obligations'::regclass
  ) THEN
    ALTER TABLE tax_obligations
      DROP CONSTRAINT tax_obligations_entity_id_tax_type_period_pattern_key;
  END IF;
END $$;

-- Add the broader uniqueness constraint, including service_kind. The
-- 4-tuple (entity_id, tax_type, period_pattern, service_kind) lets
-- the same entity hold parallel filing + provision + review rows.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'tax_obligations_entity_kind_unique'
       AND conrelid = 'tax_obligations'::regclass
  ) THEN
    ALTER TABLE tax_obligations
      ADD CONSTRAINT tax_obligations_entity_kind_unique
      UNIQUE (entity_id, tax_type, period_pattern, service_kind);
  END IF;
END $$;

INSERT INTO audit_log (id, user_id, action, target_type, target_id,
                       new_value, created_at)
VALUES (
  'mig_071_' || gen_random_uuid()::text,
  'system',
  'migration_apply',
  'tax_obligations',
  'constraint',
  jsonb_build_object(
    'migration', '071_obligations_unique_includes_service_kind',
    'old_constraint', 'tax_obligations_entity_id_tax_type_period_pattern_key',
    'new_constraint', 'tax_obligations_entity_kind_unique',
    'reason', 'allow filing + provision + review on same entity'
  ),
  NOW()
);
