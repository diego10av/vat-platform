# Database migrations

This folder contains SQL migration scripts for the Supabase Postgres
database backing cifra.

## How to apply

1. Open **Supabase Studio** → your project → **SQL Editor**
2. Paste the contents of the next unapplied migration file
3. Hit **Run**
4. Verify with the `-- verification` queries at the bottom of each file

Migrations are **idempotent** (guarded by `IF NOT EXISTS` / `ON CONFLICT
DO NOTHING`), so re-running a file is safe and a no-op after the first
successful apply.

## File naming

`NNN_short_description.sql` — sequentially numbered. Don't renumber
applied migrations.

## Rollback

Inline at the top of each file as comments, if reversible. Some changes
(new NOT NULL columns with backfill, cascading deletes) are not cleanly
reversible once in production — think carefully before running.

## Why a folder and not the Supabase MCP?

Because Diego needs to eyeball the SQL before it touches prod. Auto-
applying migrations via a tool is faster but strips the 10-second
human review that catches "oh, that cascade was wrong".

When we outgrow this (weekly migrations, multiple environments), we'll
move to a proper migration tool (supabase CLI, drizzle-kit, pgroll).
Not today.

## Applied migrations (checklist)

- [ ] `001_per_user_ai_budget_and_chat.sql` — users + per-user cap +
      chat tables. Required by chat MVP.
