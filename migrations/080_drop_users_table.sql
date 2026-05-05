-- ═══════════════════════════════════════════════════════════════════════
-- Migration 080 · Drop users table (single-user reset)
--
-- Diego pivots cifra to dogfood-first single-user. There is no longer a
-- need for a multi-user model. This migration:
--
--   1. DROPs the `users` table CASCADE — also removes the FK constraint
--      on api_calls.user_id and chat_threads.user_id (the columns
--      themselves are preserved with their existing values, e.g.
--      'founder', so the chat + cost-tracking code keeps working without
--      schema-aware queries).
--   2. Leaves `api_calls` intact for budget tracking. The `user_id`
--      column becomes plain text without a FK; `requireBudget()` only
--      sums over created_at, so user_id is unused.
--   3. Leaves `chat_threads.user_id` intact for the same reason; the
--      chat endpoints already use a hard-coded MOCK_USER_ID = 'founder'.
--
-- IDEMPOTENT: DROP TABLE IF EXISTS. Safe to re-run.
--
-- Author: Claude (reset 2026-05-05)
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

DROP TABLE IF EXISTS users CASCADE;

COMMIT;

-- ───────────────────────────── verification ────────────────────────────
--
--   SELECT to_regclass('public.users');                  -- NULL (table gone)
--
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'api_calls' AND column_name = 'user_id';   -- still 1 row
--
--   SELECT COUNT(*) FROM api_calls;                      -- spend history preserved
--   SELECT COUNT(*) FROM chat_threads;                   -- threads preserved
