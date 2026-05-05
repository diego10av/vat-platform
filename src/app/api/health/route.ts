import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

// GET /api/health
//   - Default: cheap liveness — returns env presence and a DB ping only.
//   - With `x-debug-secret: <DEBUG_SECRET>` header: also pings Anthropic
//     with a 5-token message. The gate exists because a stray poll would
//     otherwise burn Anthropic credits on every request.

function maskKey(key: string | undefined): string {
  if (!key) return 'MISSING';
  const trimmed = key.trim();
  if (trimmed.length < 16) return 'TOO_SHORT';
  return trimmed.substring(0, 8) + '...' + trimmed.substring(trimmed.length - 4);
}

export async function GET(request: NextRequest) {
  const checks: Record<string, unknown> = {
    ANTHROPIC_key: maskKey(process.env.ANTHROPIC_API_KEY),
    DATABASE_URL: process.env.DATABASE_URL ? 'set' : 'MISSING',
    SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ? 'set' : 'MISSING',
    SERVICE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ? 'set' : 'MISSING',
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ? 'set' : 'MISSING',
    AUTH_SECRET: process.env.AUTH_SECRET ? 'set' : 'MISSING',
  };

  try {
    const rows = await query<{ now: string }>('SELECT NOW()::text AS now');
    checks.database = 'connected: ' + rows[0]?.now;
  } catch (e) {
    checks.database = 'ERROR: ' + (e instanceof Error ? e.message : String(e));
  }

  // Only ping Anthropic when explicitly requested with a debug secret.
  const debugSecret = request.headers.get('x-debug-secret');
  if (debugSecret && process.env.DEBUG_SECRET && debugSecret === process.env.DEBUG_SECRET) {
    try {
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY?.trim() });
      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 5,
        messages: [{ role: 'user', content: 'Hi' }],
      });
      const textBlock = response.content.find(b => b.type === 'text');
      checks.anthropic = 'OK: ' + (textBlock?.type === 'text' ? textBlock.text.substring(0, 30) : 'no text');
    } catch (e) {
      const err = e as { status?: number; message?: string };
      checks.anthropic = `ERROR ${err.status ?? ''}: ${err.message ?? String(e)}`;
    }
  }

  return NextResponse.json(checks);
}
