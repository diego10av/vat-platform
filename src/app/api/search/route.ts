import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

// GET /api/search?q=
// Searches entities, declarations, and providers (via invoices). Returns up to
// 20 results across the three categories. Deliberately small and fast — meant
// for a header omnibox.
export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get('q') || '').trim();
  if (!q || q.length < 2) return NextResponse.json({ results: [] });
  const term = `%${q.toLowerCase()}%`;

  const entities = await query<{ id: string; name: string; client_name: string | null; regime: string }>(
    `SELECT id, name, client_name, regime FROM entities
      WHERE deleted_at IS NULL
        AND (LOWER(name) LIKE $1 OR LOWER(COALESCE(client_name,'')) LIKE $1
             OR LOWER(COALESCE(vat_number,'')) LIKE $1 OR LOWER(COALESCE(matricule,'')) LIKE $1)
      ORDER BY name ASC LIMIT 8`,
    [term]
  );

  const declarations = await query<{ id: string; year: number; period: string; status: string; entity_name: string }>(
    `SELECT d.id, d.year, d.period, d.status, e.name AS entity_name
       FROM declarations d JOIN entities e ON d.entity_id = e.id
      WHERE LOWER(e.name) LIKE $1
         OR LOWER(d.period) LIKE $1
         OR CAST(d.year AS TEXT) = $2
         OR LOWER(COALESCE(d.filing_ref,'')) LIKE $1
      ORDER BY d.year DESC, d.period DESC LIMIT 6`,
    [term, q]
  );

  const providers = await query<{ provider: string; entity_name: string; entity_id: string; declaration_id: string; year: number; period: string }>(
    `SELECT DISTINCT ON (LOWER(i.provider))
            i.provider, e.name AS entity_name, e.id AS entity_id,
            d.id AS declaration_id, d.year, d.period
       FROM invoices i
       JOIN declarations d ON i.declaration_id = d.id
       JOIN entities e ON d.entity_id = e.id
      WHERE i.provider IS NOT NULL
        AND (LOWER(i.provider) LIKE $1 OR LOWER(COALESCE(i.invoice_number,'')) LIKE $1)
      ORDER BY LOWER(i.provider), d.year DESC LIMIT 6`,
    [term]
  );

  return NextResponse.json({
    entities: entities.map(e => ({ kind: 'entity', ...e })),
    declarations: declarations.map(d => ({ kind: 'declaration', ...d })),
    providers: providers.map(p => ({ kind: 'provider', ...p })),
  });
}
