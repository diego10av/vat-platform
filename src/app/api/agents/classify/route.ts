import { NextRequest, NextResponse } from 'next/server';
import { queryOne, execute } from '@/lib/db';
import { classifyDeclaration } from '@/lib/classify';

export async function POST(request: NextRequest) {
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
