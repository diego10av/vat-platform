import { NextRequest, NextResponse } from 'next/server';
import { query, execute, generateId, logAudit } from '@/lib/db';

// GET  /api/tax-ops/entities
//   ?year=2026&q=<name>&group_id=<id>&is_active=1
//   Returns: { entities: [...], groups: [...] } — grouped client-side.
// POST /api/tax-ops/entities  — create new entity
//
// Each entity carries:
//   - obligations_count (active)
//   - filings_pct_filed_ytd (of YTD filings, % with status='filed')
//   - last_assessment_year (most recent tax_assessment_received_at year)

interface EntityListRow {
  id: string;
  legal_name: string;
  vat_number: string | null;
  matricule: string | null;
  rcs_number: string | null;
  is_active: boolean;
  liquidation_date: string | null;
  group_id: string | null;
  group_name: string | null;
  csp_count: number;
  obligations_count: number;
  filings_ytd: number;
  filings_filed_ytd: number;
  last_assessment_year: number | null;
  /** Stint 49.C1 — list of distinct active tax_types per entity, for
   *  the chips column on /tax-ops/entities. Aggregated from
   *  tax_obligations where is_active = TRUE. */
  tax_types: string[];
  /** Stint 49.B2 — full active-obligation list per entity, returned
   *  only when ?with_obligations=1 is set. The matrix's "Add existing
   *  entity" flow uses this to filter out entities that already have
   *  the obligation being added. */
  obligations?: Array<{
    tax_type: string;
    period_pattern: string;
    service_kind: string;
    is_active: boolean;
  }>;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const year = Number(url.searchParams.get('year') ?? new Date().getFullYear());
  const q = url.searchParams.get('q')?.trim() ?? '';
  const groupId = url.searchParams.get('group_id');
  const isActiveParam = url.searchParams.get('is_active');
  const isActive = isActiveParam === '0' ? false : true;  // default active only
  // Stint 49.B2 — when set, include full active-obligations list per row
  // so the AddEntityRow "add existing" flow can filter eligible entities.
  const withObligations = url.searchParams.get('with_obligations') === '1';

  const where: string[] = [];
  const params: unknown[] = [year];  // $1 fixed
  let pi = 2;

  if (isActiveParam !== null) {
    where.push(`e.is_active = $${pi}`);
    params.push(isActive); pi += 1;
  } else {
    where.push(`e.is_active = TRUE`);
  }
  if (groupId) { where.push(`e.client_group_id = $${pi}`); params.push(groupId); pi += 1; }
  if (q) { where.push(`(e.legal_name ILIKE $${pi} OR e.vat_number ILIKE $${pi})`); params.push(`%${q}%`); pi += 1; }

  const whereSQL = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const entities = await query<EntityListRow>(
    `SELECT e.id, e.legal_name, e.vat_number, e.matricule, e.rcs_number, e.is_active,
            e.liquidation_date::text AS liquidation_date,
            g.id AS group_id, g.name AS group_name,
            JSONB_ARRAY_LENGTH(e.csp_contacts) AS csp_count,
            (SELECT COUNT(*)::int FROM tax_obligations o
              WHERE o.entity_id = e.id AND o.is_active) AS obligations_count,
            (SELECT COUNT(*)::int FROM tax_filings f
              JOIN tax_obligations o2 ON o2.id = f.obligation_id
              WHERE o2.entity_id = e.id AND f.period_year = $1) AS filings_ytd,
            (SELECT COUNT(*)::int FROM tax_filings f
              JOIN tax_obligations o2 ON o2.id = f.obligation_id
              WHERE o2.entity_id = e.id AND f.period_year = $1
                AND f.status IN ('filed','paid','assessment_received')) AS filings_filed_ytd,
            (SELECT EXTRACT(YEAR FROM MAX(f.tax_assessment_received_at))::int
               FROM tax_filings f
               JOIN tax_obligations o3 ON o3.id = f.obligation_id
              WHERE o3.entity_id = e.id) AS last_assessment_year,
            -- Stint 49.C1 — distinct active tax_types per entity for the
            -- chips column on /tax-ops/entities.
            COALESCE((
              SELECT JSONB_AGG(DISTINCT o4.tax_type ORDER BY o4.tax_type)
                FROM tax_obligations o4
               WHERE o4.entity_id = e.id AND o4.is_active = TRUE
            ), '[]'::jsonb) AS tax_types
            ${withObligations ? `,
            -- Stint 49.B2 — full active-obligations list (gated by ?with_obligations=1)
            COALESCE((
              SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
                'tax_type', o5.tax_type,
                'period_pattern', o5.period_pattern,
                'service_kind', o5.service_kind,
                'is_active', o5.is_active
              ) ORDER BY o5.tax_type)
                FROM tax_obligations o5
               WHERE o5.entity_id = e.id AND o5.is_active = TRUE
            ), '[]'::jsonb) AS obligations` : ''}
       FROM tax_entities e
       LEFT JOIN tax_client_groups g ON g.id = e.client_group_id
       ${whereSQL}
      -- Stint 51.D — drag-drop display_order wins, fallback to alphabetical
      ORDER BY g.name ASC NULLS LAST, e.display_order ASC NULLS LAST, e.legal_name ASC`,
    params,
  );

  const groups = await query<{ id: string; name: string; is_active: boolean; entity_count: number }>(
    `SELECT g.id, g.name, g.is_active,
            (SELECT COUNT(*)::int FROM tax_entities e
              WHERE e.client_group_id = g.id AND e.is_active = TRUE) AS entity_count
       FROM tax_client_groups g
      WHERE g.is_active = TRUE
      ORDER BY g.name ASC`,
  );

  return NextResponse.json({ entities, groups, year });
}

export async function POST(request: NextRequest) {
  const body = await request.json() as {
    legal_name?: string;
    client_group_id?: string | null;
    vat_number?: string | null;
    matricule?: string | null;
    rcs_number?: string | null;
    notes?: string | null;
    csp_contacts?: Array<{ name: string; email?: string; role?: string }>;
  };
  if (!body.legal_name?.trim()) {
    return NextResponse.json({ error: 'legal_name_required' }, { status: 400 });
  }

  // Stint 67.G — name hygiene: strip trailing punctuation/whitespace and
  // collapse internal whitespace runs. The stint-34 importer (Excel CSV
  // round-trip) introduced 2 names with trailing `;` and 2 with double
  // spaces; cleaning at write time prevents the pattern from re-entering
  // via manual create / future re-imports. The DB unique normalization
  // already lowercases + strips non-alnum, but it doesn't rewrite the
  // displayed legal_name — only this normalization does.
  body.legal_name = body.legal_name
    .trim()
    .replace(/[\s;:,.\-]+$/g, '')   // trailing punctuation
    .replace(/\s+/g, ' ');         // collapse runs to single space

  // Stint 50.C/D — pre-check for duplicates against the same normalization
  // rule used by the UNIQUE partial index `tax_entities_norm_unique`
  // (migration 065 — stricter than mig 064). Returns 409 + the existing
  // entity id so the frontend can offer "use existing" instead of
  // surfacing a raw 500 from the constraint violation.
  // Normalization: TRANSLATE strips Latin-1 accents, REGEXP_REPLACE
  // collapses all non-alphanumeric, LOWER folds case. Catches "S.à r.l."
  // vs "SARL", trailing punctuation, mixed case.
  const NORM_EXPR = `LOWER(REGEXP_REPLACE(
    TRANSLATE(%s,
      'àáâãäåèéêëìíîïòóôõöùúûüñçÀÁÂÃÄÅÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÑÇ',
      'aaaaaaeeeeiiiiooooouuuuncAAAAAAEEEEIIIIOOOOOUUUUNC'),
    '[^a-zA-Z0-9]+', '', 'g'
  ))`;
  const existing = await query<{ id: string; legal_name: string }>(
    `SELECT id, legal_name FROM tax_entities
      WHERE is_active = TRUE
        AND ${NORM_EXPR.replace('%s', 'legal_name')}
            = ${NORM_EXPR.replace('%s', '$1')}
        AND COALESCE(client_group_id, '__no_group__') = COALESCE($2, '__no_group__')
      LIMIT 1`,
    [body.legal_name.trim(), body.client_group_id ?? null],
  );
  if (existing[0]) {
    return NextResponse.json(
      {
        error: 'entity_already_exists',
        existing_entity_id: existing[0].id,
        existing_legal_name: existing[0].legal_name,
      },
      { status: 409 },
    );
  }

  const id = generateId();
  // postgres-js auto-encodes JS arrays as jsonb when the cast is `::jsonb`
  // (with `prepare: false`). Pre-stringifying via JSON.stringify would double-
  // encode → jsonb-string instead of jsonb-array. Bug discovered + healed in
  // stint 50.B; this passes the array directly.
  await execute(
    `INSERT INTO tax_entities (id, legal_name, client_group_id, vat_number, matricule, rcs_number, notes, csp_contacts)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [
      id, body.legal_name.trim(),
      body.client_group_id ?? null,
      body.vat_number ?? null,
      body.matricule ?? null,
      body.rcs_number ?? null,
      body.notes ?? null,
      body.csp_contacts ?? [],
    ],
  );
  await logAudit({
    userId: 'founder',
    action: 'tax_entity_create',
    targetType: 'tax_entity',
    targetId: id,
    newValue: JSON.stringify({ legal_name: body.legal_name }),
  });
  return NextResponse.json({ id });
}
