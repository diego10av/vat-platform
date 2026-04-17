import { NextRequest, NextResponse } from 'next/server';
import { queryOne, execute } from '@/lib/db';
import { classifyDeclaration } from '@/lib/classify';
import { checkRateLimit } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  // Rate limit: 60 classifications per minute per IP. Pure TS logic
  // (no Anthropic call) but still hits the DB hard — this is a
  // safety net against double-fires from the UI.
  const rl = checkRateLimit(request, { max: 60, windowMs: 60_000 });
  if (!rl.ok) return rl.response;

  const { declaration_id } = await request.json();
  if (!declaration_id) return NextResponse.json({ error: 'declaration_id required' }, { status: 400 });

  try {
    const report = await classifyDeclaration(declaration_id);

    // Advance declaration state if relevant
    const current = await queryOne<{ status: string }>(
      'SELECT status FROM declarations WHERE id = $1',
      [declaration_id]
    );
    if (current?.status === 'classifying' || current?.status === 'extracting') {
      await execute(
        "UPDATE declarations SET status = 'review', updated_at = NOW() WHERE id = $1",
        [declaration_id]
      );
    }

    return NextResponse.json(report);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
