-- ═══════════════════════════════════════════════════════════════════════
-- Migration 013 · Expand user-role set + add 'junior' role.
--
-- Supports Diego's 2026-04-19 request: *"quiero dar un usuario a mi
-- junior para que testee por su cuenta (y que en su usuario vea solo
-- las cosas que vería ya un cliente final — no todos los extras que
-- puedo ver yo)"*.
--
-- Migration 001 created users with role ∈ {admin, member}. We widen
-- that to the four-role matrix documented in ROADMAP P0 #2:
--
--   - admin    → full access including /settings/*, /metrics, /legal-watch
--                (Diego's own account)
--   - reviewer → prepare + approve declarations; no admin pages
--                (internal colleague / senior tax professional)
--   - junior   → restricted view: same access as the end-client would have
--                (can see /clients, /entities/[id], /declarations/[id]
--                 review + approve path; CANNOT see /settings, /metrics,
--                 /legal-watch, /settings/users, cost/budget info)
--   - client   → reserved for a future B2B multi-tenant model (not used today)
--
-- IDEMPOTENT. Safe to re-run.
--
-- Author: Claude, stint 11 (2026-04-19)
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- Drop the existing CHECK constraint (name depends on Postgres
-- auto-generation; use pg_constraint introspection to find it).

DO $$
DECLARE cname TEXT;
BEGIN
  SELECT conname INTO cname
  FROM pg_constraint
  WHERE conrelid = 'users'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%role%';
  IF cname IS NOT NULL THEN
    EXECUTE 'ALTER TABLE users DROP CONSTRAINT ' || quote_ident(cname);
  END IF;
END $$;

-- Add new CHECK with the four allowed values.
ALTER TABLE users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'reviewer', 'junior', 'client', 'member'));

-- Note: 'member' kept for backward-compat with migration 001's default.
-- Existing 'member' rows can stay — the UI will treat 'member' as
-- equivalent to 'reviewer'.

-- Seed a junior user row so Diego can log in as the junior immediately.
-- Email placeholder — Diego will edit in /settings/users or via SQL.
INSERT INTO users (id, display_name, email, role, monthly_ai_cap_eur)
VALUES ('junior', 'Junior Tester', 'junior@cifracompliance.com', 'junior', 1.00)
ON CONFLICT (id) DO UPDATE SET role = 'junior';

COMMIT;

-- ───────────────────────────── verification ────────────────────────────
--   SELECT id, display_name, role FROM users ORDER BY role;
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--     WHERE conrelid = 'users'::regclass AND contype = 'c';
