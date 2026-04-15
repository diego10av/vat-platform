import { NextRequest, NextResponse } from 'next/server';
import { queryOne, execute, generateId, logAudit } from '@/lib/db';
import { normaliseProviderName } from '@/config/classification-rules';
import ExcelJS from 'exceljs';

// POST /api/precedents/upload
// Multipart form: file (xlsx), entity_id
// Parses a prior-year VAT appendix and upserts precedents for the entity.

// Flexible column matching — case-insensitive, language-agnostic.
const HEADER_ALIASES: Record<string, string[]> = {
  provider: ['provider', 'supplier', 'fournisseur', 'lieferant', 'proveedor', 'dostawca', 'provenienza', 'leverancier'],
  country: ['country', 'pays', 'land', 'país', 'kraj', 'paese', 'land'],
  description: ['description', 'désignation', 'designation', 'beschreibung', 'descripción', 'descrizione', 'opis'],
  amount: ['amount', 'amount ex vat', 'eur amount ex vat', 'montant', 'montant ht', 'importe', 'kwota', 'importo'],
  vat_rate: ['vat rate', 'taux', 'taux tva', 'steuersatz', 'tasa', 'aliquota', 'stawka'],
  treatment: ['treatment', 'classification', 'traitement', 'behandlung', 'tratamiento', 'trattamento', 'traktowanie'],
};

function findColumn(headers: string[], key: keyof typeof HEADER_ALIASES): number {
  const aliases = HEADER_ALIASES[key];
  for (let i = 0; i < headers.length; i++) {
    const h = (headers[i] || '').toString().trim().toLowerCase();
    if (aliases.some(a => h === a || h.includes(a))) return i;
  }
  return -1;
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const entityId = formData.get('entity_id') as string;
  const file = formData.get('file') as File | null;

  if (!entityId) return NextResponse.json({ error: 'entity_id is required' }, { status: 400 });
  if (!file) return NextResponse.json({ error: 'file is required' }, { status: 400 });

  const entity = await queryOne('SELECT id, name FROM entities WHERE id = $1', [entityId]);
  if (!entity) return NextResponse.json({ error: 'Entity not found' }, { status: 404 });

  const arrayBuffer = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(arrayBuffer);
  } catch (e) {
    return NextResponse.json({ error: 'Could not parse Excel file: ' + (e instanceof Error ? e.message : 'unknown') }, { status: 400 });
  }

  const imported: { provider: string; country: string; treatment: string }[] = [];
  const skipped: string[] = [];

  for (const sheet of workbook.worksheets) {
    // Find the header row: the first row that contains at least "provider" or "treatment"
    let headerRowIdx = -1;
    let headers: string[] = [];
    for (let r = 1; r <= Math.min(sheet.rowCount, 20); r++) {
      const row = sheet.getRow(r);
      const values = row.values as (string | number | null | undefined)[];
      const cells = values.slice(1).map(v => (v == null ? '' : String(v).trim().toLowerCase()));
      if (findColumn(cells, 'provider') >= 0 && findColumn(cells, 'treatment') >= 0) {
        headerRowIdx = r;
        headers = cells;
        break;
      }
    }
    if (headerRowIdx < 0) continue;

    const colProvider = findColumn(headers, 'provider');
    const colCountry = findColumn(headers, 'country');
    const colDesc = findColumn(headers, 'description');
    const colAmount = findColumn(headers, 'amount');
    const colTreatment = findColumn(headers, 'treatment');

    for (let r = headerRowIdx + 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const values = (row.values as unknown[]).slice(1);
      const provider = String(values[colProvider] ?? '').trim();
      const treatment = String(values[colTreatment] ?? '').trim();
      if (!provider || !treatment) continue;

      const country = colCountry >= 0 ? String(values[colCountry] ?? '').trim().toUpperCase().slice(0, 2) : '';
      const description = colDesc >= 0 ? String(values[colDesc] ?? '').trim() : null;
      const amount = colAmount >= 0 ? Number(values[colAmount]) || null : null;

      const normalisedProvider = normaliseProviderName(provider);
      if (!normalisedProvider) { skipped.push(provider); continue; }

      // Upsert precedent
      const existing = await queryOne<{ id: string; times_used: number }>(
        `SELECT id, times_used FROM precedents
          WHERE entity_id = $1 AND provider = $2 AND COALESCE(country,'') = COALESCE($3,'')`,
        [entityId, provider, country || null]
      );

      if (existing) {
        await execute(
          `UPDATE precedents
              SET treatment = $1, description = COALESCE($2, description),
                  last_amount = COALESCE($3, last_amount), last_used = CURRENT_DATE,
                  times_used = times_used + 1, updated_at = NOW()
            WHERE id = $4`,
          [treatment, description, amount, existing.id]
        );
      } else {
        await execute(
          `INSERT INTO precedents (id, entity_id, provider, country, treatment, description,
             last_amount, last_used, times_used)
           VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_DATE, 1)
           ON CONFLICT (entity_id, provider, country) DO UPDATE
             SET treatment = EXCLUDED.treatment,
                 description = COALESCE(EXCLUDED.description, precedents.description),
                 last_amount = COALESCE(EXCLUDED.last_amount, precedents.last_amount),
                 last_used = CURRENT_DATE,
                 times_used = precedents.times_used + 1,
                 updated_at = NOW()`,
          [generateId(), entityId, provider, country || null, treatment, description, amount]
        );
      }

      imported.push({ provider, country, treatment });
    }
  }

  await logAudit({
    entityId,
    action: 'create',
    targetType: 'precedent_batch',
    targetId: entityId,
    newValue: JSON.stringify({ count: imported.length, skipped: skipped.length }),
  });

  return NextResponse.json({
    imported: imported.length,
    skipped: skipped.length,
    sample: imported.slice(0, 5),
  });
}
