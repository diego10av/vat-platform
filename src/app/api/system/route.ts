import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { parseAuthUsers } from '@/lib/auth';

// GET /api/system — non-secret system status for the Settings page.
// Same shape philosophy as /api/health but never exposes raw env values.
export async function GET() {
  // Stint 67.G — Bug #17. The auth_configured row on /settings was
  // false-red since stint 62 deleted the legacy AUTH_PASSWORD env var.
  // Reuse the same parseAuthUsers() helper the login route uses so the
  // status row stays in sync with the actual auth model (AUTH_USERS +
  // per-user AUTH_PASS_<UPPER>).
  const users = parseAuthUsers();
  const usersWithPassword = users.filter(
    u => !!process.env[`AUTH_PASS_${u.username.toUpperCase()}`],
  );

  const checks: Record<string, unknown> = {
    storage: 'ok',
    database: 'ok',
    anthropic_configured: !!process.env.ANTHROPIC_API_KEY,
    supabase_configured: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    auth_configured:
      users.length > 0 &&
      usersWithPassword.length === users.length &&
      !!process.env.AUTH_SECRET,
    auth_users_count: users.length,
  };

  // DB ping
  try {
    const r = await queryOne<{ now: string }>('SELECT NOW()::text AS now');
    checks.db_time = r?.now;
  } catch (e) {
    checks.database = 'ERROR: ' + (e instanceof Error ? e.message : String(e));
  }

  // Stats
  try {
    const stats = await queryOne(
      `SELECT
         (SELECT COUNT(*) FROM entities WHERE deleted_at IS NULL)::int AS entities,
         (SELECT COUNT(*) FROM declarations)::int AS declarations,
         (SELECT COUNT(*) FROM documents)::int AS documents,
         (SELECT COUNT(*) FROM invoices)::int AS invoices,
         (SELECT COUNT(*) FROM invoice_lines WHERE state != 'deleted')::int AS lines,
         (SELECT COUNT(*) FROM precedents)::int AS precedents,
         (SELECT COUNT(*) FROM aed_communications)::int AS aed_letters,
         (SELECT COUNT(*) FROM audit_log)::int AS audit_events`
    );
    checks.stats = stats;
  } catch (e) {
    checks.stats_error = (e instanceof Error ? e.message : String(e));
  }

  return NextResponse.json(checks);
}
