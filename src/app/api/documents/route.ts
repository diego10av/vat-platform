import { NextRequest, NextResponse } from 'next/server';
import { query, initializeSchema } from '@/lib/db';

// GET /api/documents?declaration_id=xxx
export async function GET(request: NextRequest) {
  await initializeSchema();
  const declarationId = request.nextUrl.searchParams.get('declaration_id');
  if (!declarationId) return NextResponse.json({ error: 'declaration_id is required' }, { status: 400 });

  const documents = await query(
    'SELECT * FROM documents WHERE declaration_id = $1 ORDER BY uploaded_at ASC',
    [declarationId]
  );
  return NextResponse.json(documents);
}
