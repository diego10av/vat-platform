import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne, execute, generateId, logAudit, initializeSchema } from '@/lib/db';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'fs/promises';
import path from 'path';
import { classifyInvoiceLine } from '@/config/classification-rules';

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

// Allow up to 5 minutes for batch extraction on Vercel Pro (or 60s on free tier)
export const maxDuration = 300;

// Small delay between sequential API calls to avoid transient auth issues
// when multiple requests share the same key at near-identical timestamps.
const INTER_CALL_DELAY_MS = 500;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function maskKey(key: string | undefined): string {
  if (!key) return 'MISSING';
  const t = key.trim();
  if (t.length < 12) return 'TOO_SHORT';
  return `${t.substring(0, 8)}...${t.substring(t.length - 4)} (len=${t.length})`;
}

function getClient(): Anthropic {
  const rawKey = process.env.ANTHROPIC_API_KEY;
  if (!rawKey) throw new Error('ANTHROPIC_API_KEY not set');
  // Trim whitespace — Vercel env vars sometimes pick up trailing newlines/spaces
  const apiKey = rawKey.trim();
  return new Anthropic({ apiKey });
}

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function readPromptFile(name: string): Promise<string> {
  const promptPath = path.join(process.cwd(), 'prompts', name);
  return readFile(promptPath, 'utf-8');
}

// Wraps a messages.create call with one retry on 401 (transient auth-header corruption).
// Fresh client each retry to force a new SDK state.
async function callWithRetry(
  body: Anthropic.MessageCreateParamsNonStreaming,
  label: string
): Promise<Anthropic.Message> {
  try {
    return await getClient().messages.create(body);
  } catch (e) {
    const err = e as { status?: number; message?: string };
    if (err.status === 401) {
      console.warn(`[extract] ${label} got 401, retrying after 1s with fresh client`);
      await sleep(1000);
      return await getClient().messages.create(body);
    }
    throw e;
  }
}

export async function POST(request: NextRequest) {
  await initializeSchema();
  const { declaration_id } = await request.json();

  const declaration = await queryOne(
    `SELECT d.*, e.name as entity_name, e.vat_number, e.regime
     FROM declarations d JOIN entities e ON d.entity_id = e.id WHERE d.id = $1`,
    [declaration_id]
  );
  if (!declaration) return NextResponse.json({ error: 'Declaration not found' }, { status: 404 });

  // ATOMIC claim: flip documents from 'uploaded'/'error' to 'triaging' in a single UPDATE...RETURNING.
  // Prevents double-processing (and double API billing) if the user clicks "Extract All" twice,
  // or if two tabs/devices submit simultaneously. Also caps the batch at 200 docs per invocation
  // as a safety net against accidental mass uploads.
  const MAX_BATCH_SIZE = 200;
  const documents = await query(
    `UPDATE documents
       SET status = 'triaging', error_message = NULL
     WHERE id IN (
       SELECT id FROM documents
        WHERE declaration_id = $1
          AND status IN ('uploaded','error')
        LIMIT $2
     )
     RETURNING *`,
    [declaration_id, MAX_BATCH_SIZE]
  );
  if (documents.length === 0) return NextResponse.json({ message: 'No documents to process' });

  console.log(`[extract] Starting batch for declaration=${declaration_id}, docs=${documents.length}, key=${maskKey(process.env.ANTHROPIC_API_KEY)}`);

  const supabase = getSupabase();
  let triagePrompt: string, extractPrompt: string;

  try {
    triagePrompt = await readPromptFile('triage.md');
    extractPrompt = await readPromptFile('extractor.md');
  } catch {
    return NextResponse.json({ error: 'Agent prompt files not found' }, { status: 500 });
  }

  const results = [];

  for (let docIndex = 0; docIndex < documents.length; docIndex++) {
    const doc = documents[docIndex];
    try {
      // status is already 'triaging' — claimed atomically above

      // Download file from Supabase Storage
      const { data: fileData, error: dlError } = await supabase.storage
        .from('documents')
        .download(doc.file_path as string);

      if (dlError || !fileData) {
        throw new Error(`Failed to download: ${dlError?.message || 'no data'}`);
      }

      const buffer = Buffer.from(await fileData.arrayBuffer());
      const base64 = buffer.toString('base64');
      const fileType = doc.file_type as string;

      let mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | 'application/pdf';
      if (fileType === 'pdf') {
        mediaType = 'application/pdf';
      } else if (fileType === 'image') {
        const ext = (doc.filename as string).toLowerCase().split('.').pop();
        mediaType = ext === 'png' ? 'image/png' : 'image/jpeg';
      } else {
        await execute("UPDATE documents SET status = 'triaged', triage_result = 'invoice', triage_confidence = 0.5 WHERE id = $1", [doc.id]);
        results.push({ id: doc.id, filename: doc.filename, triage: 'invoice', note: 'Word doc - limited extraction' });
        continue;
      }

      // If the user has already overridden triage ("Include as Invoice"), skip the
      // triage API call entirely. Otherwise run the triage agent.
      let triageType: string;
      let triageConfidence: number;

      if (doc.triage_result && Number(doc.triage_confidence) >= 1.0) {
        triageType = doc.triage_result as string;
        triageConfidence = Number(doc.triage_confidence);
      } else {
        // Space sequential calls slightly to avoid bursty-auth edge cases (intermittent 401s
        // observed when many requests share the same key at near-identical timestamps).
        if (docIndex > 0) await sleep(INTER_CALL_DELAY_MS);

        const triageResponse = await callWithRetry({
          model: HAIKU_MODEL,
          max_tokens: 500,
          system: triagePrompt,
          messages: [{
            role: 'user',
            content: [
              {
                type: fileType === 'pdf' ? 'document' : 'image',
                source: { type: 'base64', media_type: mediaType, data: base64 },
              } as Anthropic.DocumentBlockParam | Anthropic.ImageBlockParam,
              { type: 'text', text: `Entity: ${declaration.entity_name} (VAT: ${declaration.vat_number})\nClassify this document.` },
            ],
          }],
        }, `triage(${doc.filename})`);

        const triageText = triageResponse.content.find(b => b.type === 'text')?.text || '';
        let triageResult: { type: string; confidence: number };
        try {
          triageResult = JSON.parse(triageText);
        } catch {
          const match = triageText.match(/\{[\s\S]*?\}/);
          triageResult = match ? JSON.parse(match[0]) : { type: 'invoice', confidence: 0.5 };
        }
        triageType = triageResult.type || 'invoice';
        triageConfidence = triageResult.confidence || 0.5;
      }

      await execute(
        "UPDATE documents SET status = 'triaged', triage_result = $1, triage_confidence = $2 WHERE id = $3",
        [triageType, triageConfidence, doc.id]
      );

      await logAudit({
        entityId: declaration.entity_id as string, declarationId: declaration_id,
        action: 'triage', targetType: 'document', targetId: doc.id as string,
        newValue: JSON.stringify({ type: triageType, confidence: triageConfidence }),
      });

      // Step 2: Extract (only invoices/credit notes)
      if (triageType === 'invoice' || triageType === 'credit_note') {
        await execute("UPDATE documents SET status = 'extracting' WHERE id = $1", [doc.id]);

        // Extra delay before the second API call for the same document.
        await sleep(INTER_CALL_DELAY_MS);

        const extractResponse = await callWithRetry({
          model: HAIKU_MODEL,
          max_tokens: 2000,
          system: extractPrompt,
          messages: [{
            role: 'user',
            content: [
              {
                type: fileType === 'pdf' ? 'document' : 'image',
                source: { type: 'base64', media_type: mediaType, data: base64 },
              } as Anthropic.DocumentBlockParam | Anthropic.ImageBlockParam,
              { type: 'text', text: `Extract all invoice data. Entity: ${declaration.entity_name} (${declaration.regime} regime).` },
            ],
          }],
        }, `extract(${doc.filename})`);

        const extractText = extractResponse.content.find(b => b.type === 'text')?.text || '';
        let invoiceData: Record<string, unknown>;
        try {
          invoiceData = JSON.parse(extractText);
        } catch {
          const match = extractText.match(/\{[\s\S]*\}/);
          invoiceData = match ? JSON.parse(match[0]) : {};
        }

        const invoiceId = generateId();
        await execute(
          `INSERT INTO invoices (id, document_id, declaration_id, provider, provider_vat, country,
            invoice_date, invoice_number, direction, total_ex_vat, total_vat, total_incl_vat,
            currency, currency_amount, extraction_source)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'ai')`,
          [
            invoiceId, doc.id, declaration_id,
            invoiceData.provider || 'Unknown', invoiceData.provider_vat || null,
            invoiceData.country || 'LU', invoiceData.invoice_date || null,
            invoiceData.invoice_number || null, invoiceData.direction || 'incoming',
            invoiceData.total_ex_vat || 0, invoiceData.total_vat || 0,
            invoiceData.total_incl_vat || 0, invoiceData.currency || null,
            invoiceData.currency_amount || null,
          ]
        );

        const lines = (invoiceData.lines as Array<Record<string, unknown>>) || [{
          description: invoiceData.provider || 'Services',
          amount_eur: invoiceData.total_ex_vat || 0,
          vat_rate: invoiceData.total_vat && invoiceData.total_ex_vat
            ? Number(invoiceData.total_vat) / Number(invoiceData.total_ex_vat) : null,
          vat_applied: invoiceData.total_vat || null,
          rc_amount: null,
          amount_incl: invoiceData.total_incl_vat || invoiceData.total_ex_vat || 0,
        }];

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          await execute(
            `INSERT INTO invoice_lines (id, invoice_id, declaration_id, description, amount_eur,
              vat_rate, vat_applied, rc_amount, amount_incl, sort_order, state)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'extracted')`,
            [
              generateId(), invoiceId, declaration_id,
              line.description || '', line.amount_eur || 0,
              line.vat_rate || null, line.vat_applied || null,
              line.rc_amount || null, line.amount_incl || line.amount_eur || 0, i,
            ]
          );
        }

        await execute("UPDATE documents SET status = 'extracted' WHERE id = $1", [doc.id]);
        await logAudit({
          entityId: declaration.entity_id as string, declarationId: declaration_id,
          action: 'extract', targetType: 'invoice', targetId: invoiceId,
          newValue: JSON.stringify({ provider: invoiceData.provider, lines: lines.length }),
        });

        results.push({ id: doc.id, filename: doc.filename, triage: triageType, extracted: true, lines: lines.length });
      } else {
        await execute("UPDATE documents SET status = 'rejected' WHERE id = $1", [doc.id]);
        results.push({ id: doc.id, filename: doc.filename, triage: triageType, extracted: false });
      }
    } catch (error) {
      // Log full error to Vercel logs for debugging
      console.error(`[extract] ERROR processing ${doc.filename} (id=${doc.id}):`, error);

      let errMsg = 'Unknown error';
      if (error instanceof Anthropic.APIError) {
        errMsg = `Anthropic API ${error.status}: ${error.message}`;
      } else if (error instanceof Error) {
        errMsg = error.message;
        // Include stack snippet for non-API errors
        if (error.stack) {
          const stackLine = error.stack.split('\n').slice(1, 3).join(' | ');
          errMsg = `${errMsg} [${stackLine}]`;
        }
      } else {
        errMsg = String(error);
      }

      await execute("UPDATE documents SET status = 'error', error_message = $1 WHERE id = $2", [errMsg, doc.id]);
      results.push({ id: doc.id, filename: doc.filename, error: errMsg });
    }
  }

  // ===== Auto-classify with deterministic rules =====
  // Runs the rules engine over all unclassified, non-manual lines in this declaration.
  let classificationSummary: Record<string, unknown> | null = null;
  try {
    const classifyLines = await query<{
      id: string;
      direction: string;
      country: string | null;
      vat_rate: number | null;
      vat_applied: number | null;
      description: string | null;
      treatment_source: string | null;
      treatment: string | null;
    }>(
      `SELECT il.id, i.direction, i.country, il.vat_rate, il.vat_applied, il.description,
              il.treatment_source, il.treatment
         FROM invoice_lines il
         JOIN invoices i ON il.invoice_id = i.id
        WHERE il.declaration_id = $1
          AND il.state != 'deleted'
          AND (il.treatment_source IS NULL OR il.treatment_source != 'manual')`,
      [declaration_id]
    );

    const byRule: Record<string, number> = {};
    for (const line of classifyLines) {
      const result = classifyInvoiceLine({
        direction: line.direction as 'incoming' | 'outgoing',
        country: line.country,
        vat_rate: line.vat_rate == null ? null : Number(line.vat_rate),
        vat_applied: line.vat_applied == null ? null : Number(line.vat_applied),
        description: line.description,
      });
      await execute(
        `UPDATE invoice_lines
            SET treatment = $1,
                treatment_source = 'rule',
                classification_rule = $2,
                flag = $3,
                flag_reason = $4,
                state = CASE WHEN state = 'extracted' THEN 'classified' ELSE state END,
                updated_at = NOW()
          WHERE id = $5`,
        [result.treatment, result.rule, result.flag, result.flag_reason ?? null, line.id]
      );
      byRule[result.rule] = (byRule[result.rule] || 0) + 1;
    }
    classificationSummary = { processed: classifyLines.length, by_rule: byRule };
  } catch (e) {
    console.error('[extract] classification failed:', e);
  }

  // Update declaration status to review
  const allDocs = await query("SELECT status FROM documents WHERE declaration_id = $1", [declaration_id]);
  if (allDocs.some(d => d.status === 'extracted')) {
    await execute("UPDATE declarations SET status = 'review', updated_at = NOW() WHERE id = $1", [declaration_id]);
  }

  return NextResponse.json({ results, processed: results.length, classification: classificationSummary });
}
