import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

// POST /api/crm/matters/conflict-check
//
// Body: {
//   client_name?: string,           // by name (when opening a matter for a new company)
//   client_company_id?: string,     // by id (when the client is already in the CRM)
//   counterparty_name?: string,
//   related_parties?: string[],
//   exclude_matter_id?: string,     // skip self when running on an existing matter
// }
//
// Returns: { hits: [{matter_id, matter_reference, field, party, client_name, status}], checked_at }
//
// Strategy: SQL ILIKE scan over all active/on_hold matters. For each
// party (client_name + counterparty + related), look for matches in:
//   - crm_matters.client_company_id.company_name
//   - crm_matters.counterparty_name
//   - crm_matters.related_parties  (array intersect)
// Case-insensitive, substring match. False positives are expected;
// reviewer acknowledges per-row in the UI (stored on the matter's
// conflict_check_result.false_positive_ids).

interface Hit {
  matter_id: string;
  matter_reference: string;
  status: string;
  field: 'client' | 'counterparty' | 'related';
  party: string;       // the search term that matched
  match_value: string; // the stored value that matched
  client_name: string | null;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const parties: string[] = [];

  // Resolve client name if given by id.
  let clientName: string | null = body.client_name || null;
  if (!clientName && body.client_company_id) {
    const rows = await query<{ company_name: string }>(
      `SELECT company_name FROM crm_companies WHERE id = $1`,
      [body.client_company_id],
    );
    clientName = rows[0]?.company_name ?? null;
  }
  if (clientName) parties.push(clientName);
  if (typeof body.counterparty_name === 'string' && body.counterparty_name.trim()) {
    parties.push(body.counterparty_name.trim());
  }
  if (Array.isArray(body.related_parties)) {
    for (const p of body.related_parties) {
      if (typeof p === 'string' && p.trim()) parties.push(p.trim());
    }
  }
  if (parties.length === 0) {
    return NextResponse.json({ hits: [], checked_at: new Date().toISOString(), note: 'No parties provided.' });
  }

  const excludeId = typeof body.exclude_matter_id === 'string' ? body.exclude_matter_id : null;

  // Build one query per party for clarity; N is small (<5 typically).
  const hits: Hit[] = [];
  const seen = new Set<string>();  // dedup on (matter_id, field, party)

  for (const party of parties) {
    const pattern = `%${party}%`;

    // Match against client company name.
    const clientMatches = await query<{ id: string; matter_reference: string; status: string; company_name: string | null }>(
      `SELECT m.id, m.matter_reference, m.status, c.company_name
         FROM crm_matters m
         LEFT JOIN crm_companies c ON c.id = m.client_company_id
        WHERE m.deleted_at IS NULL
          AND m.status IN ('active', 'on_hold')
          AND ($2::text IS NULL OR m.id != $2)
          AND c.company_name ILIKE $1`,
      [pattern, excludeId],
    );
    for (const m of clientMatches) {
      const key = `${m.id}:client:${party}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({
        matter_id: m.id,
        matter_reference: m.matter_reference,
        status: m.status,
        field: 'client',
        party,
        match_value: m.company_name ?? '',
        client_name: m.company_name,
      });
    }

    // Match against counterparty_name.
    const cpMatches = await query<{ id: string; matter_reference: string; status: string; counterparty_name: string | null; company_name: string | null }>(
      `SELECT m.id, m.matter_reference, m.status, m.counterparty_name, c.company_name
         FROM crm_matters m
         LEFT JOIN crm_companies c ON c.id = m.client_company_id
        WHERE m.deleted_at IS NULL
          AND m.status IN ('active', 'on_hold')
          AND ($2::text IS NULL OR m.id != $2)
          AND m.counterparty_name ILIKE $1`,
      [pattern, excludeId],
    );
    for (const m of cpMatches) {
      const key = `${m.id}:counterparty:${party}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({
        matter_id: m.id,
        matter_reference: m.matter_reference,
        status: m.status,
        field: 'counterparty',
        party,
        match_value: m.counterparty_name ?? '',
        client_name: m.company_name,
      });
    }

    // Match against related_parties array — use unnest to explode + ILIKE.
    const relMatches = await query<{ id: string; matter_reference: string; status: string; matched_party: string; company_name: string | null }>(
      `SELECT m.id, m.matter_reference, m.status, unn.elem AS matched_party, c.company_name
         FROM crm_matters m
         LEFT JOIN crm_companies c ON c.id = m.client_company_id
         CROSS JOIN LATERAL unnest(COALESCE(m.related_parties, '{}'::text[])) AS unn(elem)
        WHERE m.deleted_at IS NULL
          AND m.status IN ('active', 'on_hold')
          AND ($2::text IS NULL OR m.id != $2)
          AND unn.elem ILIKE $1`,
      [pattern, excludeId],
    );
    for (const m of relMatches) {
      const key = `${m.id}:related:${party}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({
        matter_id: m.id,
        matter_reference: m.matter_reference,
        status: m.status,
        field: 'related',
        party,
        match_value: m.matched_party,
        client_name: m.company_name,
      });
    }
  }

  return NextResponse.json({
    hits,
    checked_at: new Date().toISOString(),
    parties_checked: parties,
  });
}
