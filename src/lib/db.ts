import { neon } from '@neondatabase/serverless';
import { v4 as uuidv4 } from 'uuid';

function getSql() {
  return neon(process.env.DATABASE_URL!);
}

export async function query<T = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const sql = getSql();
  // Use sql.query() for parameterized queries (not tagged template)
  const rows = await sql.query(text, params);
  return rows as T[];
}

export async function queryOne<T = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] || null;
}

export async function execute(text: string, params?: unknown[]): Promise<void> {
  const sql = getSql();
  await sql.query(text, params);
}

export async function initializeSchema(): Promise<void> {
  // Tables already created during setup. No-op.
}

export function generateId(): string {
  return uuidv4();
}

export async function logAudit(params: {
  userId?: string;
  entityId?: string;
  declarationId?: string;
  action: string;
  targetType: string;
  targetId: string;
  field?: string;
  oldValue?: string;
  newValue?: string;
}): Promise<void> {
  await execute(
    `INSERT INTO audit_log (id, user_id, entity_id, declaration_id, action, target_type, target_id, field, old_value, new_value)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      generateId(),
      params.userId || 'founder',
      params.entityId || null,
      params.declarationId || null,
      params.action,
      params.targetType,
      params.targetId,
      params.field || null,
      params.oldValue || null,
      params.newValue || null,
    ]
  );
}
