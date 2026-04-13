import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne, execute, generateId, logAudit, initializeSchema } from '@/lib/db';

// GET /api/declarations?entity_id=xxx
export async function GET(request: NextRequest) {
  await initializeSchema();
  const entityId = request.nextUrl.searchParams.get('entity_id');

  if (entityId) {
    const declarations = await query(
      `SELECT d.*, e.name as entity_name FROM declarations d
       JOIN entities e ON d.entity_id = e.id
       WHERE d.entity_id = $1 ORDER BY d.year DESC, d.period DESC`,
      [entityId]
    );
    return NextResponse.json(declarations);
  }

  const declarations = await query(
    `SELECT d.*, e.name as entity_name FROM declarations d
     JOIN entities e ON d.entity_id = e.id ORDER BY d.created_at DESC`
  );
  return NextResponse.json(declarations);
}

// POST /api/declarations
export async function POST(request: NextRequest) {
  await initializeSchema();
  const body = await request.json();

  const entity = await queryOne('SELECT * FROM entities WHERE id = $1', [body.entity_id]);
  if (!entity) return NextResponse.json({ error: 'Entity not found' }, { status: 400 });

  const existing = await queryOne(
    'SELECT id FROM declarations WHERE entity_id = $1 AND year = $2 AND period = $3',
    [body.entity_id, body.year, body.period]
  );
  if (existing) return NextResponse.json({ error: 'Declaration already exists for this entity, year, and period' }, { status: 409 });

  const id = generateId();
  await execute(
    `INSERT INTO declarations (id, entity_id, year, period, status, notes)
     VALUES ($1, $2, $3, $4, 'created', $5)`,
    [id, body.entity_id, body.year, body.period, body.notes || null]
  );

  await logAudit({
    entityId: body.entity_id, declarationId: id,
    action: 'create', targetType: 'declaration', targetId: id,
    newValue: JSON.stringify({ year: body.year, period: body.period }),
  });

  const declaration = await queryOne(
    `SELECT d.*, e.name as entity_name FROM declarations d
     JOIN entities e ON d.entity_id = e.id WHERE d.id = $1`,
    [id]
  );
  return NextResponse.json(declaration, { status: 201 });
}
