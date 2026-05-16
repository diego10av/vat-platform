-- ════════════════════════════════════════════════════════════════════════
-- Migration 091 — auth_login_log
--
-- Applied via Supabase MCP on 2026-05-16. This file mirrors the
-- migration for repo trackability. See docs/SECURITY_AUDIT_2026-05-16.md
-- §2 and docs/INCIDENT_RESPONSE.md §2.
--
-- Captures every login attempt on /api/auth/login so Diego (or anyone
-- auditing later) can spot unfamiliar IPs / user-agents quickly.
-- Single-user dogfood: this is the lightest possible "who's logging
-- in" signal short of MFA, which Diego explicitly rejected for
-- friction reasons.
--
-- Append-only by convention. RLS deny-all for anon/authenticated;
-- the app writes via service_role (BYPASSRLS). Querying is via
-- direct SQL editor or future admin route.
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS auth_login_log (
  id          BIGSERIAL PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip          TEXT,
  user_agent  TEXT,
  success     BOOLEAN NOT NULL,
  failure_reason TEXT  -- 'bad_password' | 'rate_limited' | null on success
);

CREATE INDEX IF NOT EXISTS auth_login_log_created_at_idx
  ON auth_login_log (created_at DESC);

COMMENT ON TABLE auth_login_log IS
  'Append-only audit of /api/auth/login attempts. Written by service_role; RLS denies anon + authenticated by default. See docs/SECURITY.md §6 and docs/INCIDENT_RESPONSE.md §2.';

ALTER TABLE auth_login_log ENABLE ROW LEVEL SECURITY;
