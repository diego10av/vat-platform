-- ═══════════════════════════════════════════════════════════════════════
-- Migration 001 · Per-user AI budget tracking + chat backing tables
--
-- Adds:
--   1. users table — per-user monthly AI cap in euros (Diego's "€2/user/mo"
--      governance rule, per docs/MODELS.md §4). Today single-user (founder);
--      the schema is ready for multi-tenant when we get there.
--   2. api_calls.user_id column — so SUM(cost_eur) WHERE user_id = $1
--      AND created_at >= first-of-month is a cheap indexed query.
--   3. chat_threads + chat_messages — backing store for the in-product
--      chat MVP (ROADMAP P0 #9). Threads scope to (user, optional entity,
--      optional declaration); messages store model + tokens + cost per row
--      so we can show "this thread cost you €0.43".
--
-- IDEMPOTENT: every DDL uses IF NOT EXISTS / IF NOT EXISTS column guards,
-- so re-running the file is safe. Copy-paste into Supabase SQL Editor and
-- hit Run.
--
-- Rollback: DROP TABLE chat_messages, chat_threads, users cascade; ALTER
-- TABLE api_calls DROP COLUMN user_id; — but don't actually rollback once
-- rows are written.
--
-- Author: Claude (overnight sprint 2026-04-17 → 2026-04-18)
-- Required by: src/lib/budget-guard.ts (requireUserBudget), src/app/api/chat/*
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- ───────────────────────────── 1. users table ─────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  -- Display-friendly fields. Kept minimal; real auth is handled by the
  -- HMAC cookie in src/lib/auth.ts. If/when we add Supabase Auth or
  -- SSO, this table becomes a profile extension of auth.users.
  display_name  TEXT NOT NULL DEFAULT '',
  email         TEXT,
  -- Role within the firm. 'admin' can raise other users' caps.
  role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  -- Per-user monthly AI spend cap in euros. Hard-blocking at 100%. Default
  -- €2 matches the Firm tier. Admin raises this per user via /settings/users.
  -- Valid ladder per docs/MODELS.md §4: 1 / 2 / 5 / 10 / 20 / 30.
  monthly_ai_cap_eur  NUMERIC(6,2) NOT NULL DEFAULT 2.00
    CHECK (monthly_ai_cap_eur >= 0 AND monthly_ai_cap_eur <= 100),
  -- Soft fields
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  active        BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_active ON users(active) WHERE active;

-- Seed the founder row so requireUserBudget('founder') finds something.
INSERT INTO users (id, display_name, email, role, monthly_ai_cap_eur)
VALUES ('founder', 'Diego Gonzalez Manso', 'gonzmans@gmail.com', 'admin', 50.00)
ON CONFLICT (id) DO NOTHING;

-- ──────────────────────── 2. api_calls.user_id column ─────────────────────

ALTER TABLE api_calls
  ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT 'founder'
  REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET DEFAULT;

-- Note: the foreign key uses ON DELETE SET DEFAULT so deleting a user
-- never orphans cost rows — they fall back to 'founder', preserving the
-- audit trail. This is correct for a multi-tenant billing story too:
-- departed users' costs stay on the books.

-- Monthly-spend queries are the hot path for requireUserBudget(). An
-- index on (user_id, created_at DESC) lets Postgres range-scan just
-- the current month's rows per user.
CREATE INDEX IF NOT EXISTS idx_api_calls_user_month
  ON api_calls(user_id, created_at DESC)
  WHERE status != 'error';

-- ───────────────────────── 3. chat tables (MVP) ─────────────────────────

-- A thread = a conversation. Scoped to a user, optionally to a
-- declaration / entity so we can ask "what questions has Diego asked
-- about declaration X?".
CREATE TABLE IF NOT EXISTS chat_threads (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
  title           TEXT NOT NULL DEFAULT 'New conversation',
  -- Context anchors. NULL = thread not scoped to anything particular.
  entity_id       TEXT REFERENCES entities(id) ON DELETE SET NULL,
  declaration_id  TEXT REFERENCES declarations(id) ON DELETE SET NULL,
  -- Token + cost accumulators for the whole thread. Updated after each
  -- assistant message. Redundant with SUM over chat_messages but cheap
  -- and avoids a JOIN on every list-screen render.
  total_cost_eur  NUMERIC(8,4) NOT NULL DEFAULT 0,
  total_input_tokens   INTEGER NOT NULL DEFAULT 0,
  total_output_tokens  INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_chat_threads_user_updated
  ON chat_threads(user_id, updated_at DESC)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_chat_threads_declaration
  ON chat_threads(declaration_id)
  WHERE declaration_id IS NOT NULL;

-- One row per user-or-assistant message. Messages carry the model + cost
-- so we can show per-message spend in the UI and reconcile against api_calls.
CREATE TABLE IF NOT EXISTS chat_messages (
  id              TEXT PRIMARY KEY,
  thread_id       TEXT NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  -- 'user' (human typed it) | 'assistant' (Claude generated it) |
  -- 'system' (reserved — not persisted today but schema supports it).
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content         TEXT NOT NULL,
  -- Only set on assistant messages. NULL for user messages.
  model           TEXT,
  input_tokens    INTEGER,
  output_tokens   INTEGER,
  cache_read_tokens   INTEGER,
  cost_eur        NUMERIC(8,4),
  -- Opus-escalation marker. If a user pressed "Ask Opus", the assistant
  -- message has escalated=true, and the UI shows a badge.
  escalated_to_opus BOOLEAN NOT NULL DEFAULT FALSE,
  -- Link to the api_calls row for full traceability. NULL if the message
  -- never triggered a model call (e.g. cached reply, future use).
  api_call_id     TEXT REFERENCES api_calls(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_thread
  ON chat_messages(thread_id, created_at);

-- ──────────────────────── 4. updated_at auto-touch ────────────────────────

-- Generic trigger — touch updated_at on any row change. If the function
-- already exists from earlier migrations, we REPLACE (safe).
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach to users + chat_threads. DROP-and-CREATE pattern since CREATE
-- TRIGGER IF NOT EXISTS isn't supported in all Postgres versions.
DROP TRIGGER IF EXISTS trg_users_touch_updated_at ON users;
CREATE TRIGGER trg_users_touch_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_chat_threads_touch_updated_at ON chat_threads;
CREATE TRIGGER trg_chat_threads_touch_updated_at
  BEFORE UPDATE ON chat_threads
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

COMMIT;

-- ───────────────────────────── verification ────────────────────────────
-- After running, these should all return rows / the expected shape:
--
--   SELECT * FROM users;                              -- founder row + caps
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name = 'api_calls' AND column_name = 'user_id';
--   SELECT COUNT(*) FROM chat_threads;                -- 0
--   SELECT COUNT(*) FROM chat_messages;               -- 0
--   \d api_calls                                      -- user_id col present
