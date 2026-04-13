import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne, execute, generateId, logAudit, initializeSchema } from '@/lib/db';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'fs/promises';
import path from 'path';

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

function getClient(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function readPromptFile(name: string): Promise<string> {
  const promptPath = path.join(process.cwd(), 'prompts', name);
  return readFile(promptPath, 'utf-8');
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

  const documents = await query(
    "SELECT * FROM documents WHERE declaration_id = $1 AND status = 'uploaded'",
    [declaration_id]
  );
  if (documents.length === 0) return NextResponse.json({ message: 'No documents to process' });

  const client = getClient();
  const supabase = getSupabase();
  let triagePrompt: string, extractPrompt: string;

  try {
    triagePrompt = await readPromptFile('triage.md');
    extractPrompt = await readPromptFile('extractor.md');
  } catch {
    return NextResponse.json({ error: 'Agent prompt files not found' }, { status: 500 });
  }

  const results = [];

  for (const doc of documents) {
    try {
      await execute("UPDATE documents SET status = 'triaging' WHERE id = $1", [doc.id]);

      // Download file from Supabase Storage
      const { data: fileData, error: dlError } = await supabase.storage
        .from('documents')
        .download(doc.file_path);

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

      // Step 1: Triage
      const triageResponse = await client.messages.create({
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
      });

      const triageText = triageResponse.content.find(b => b.type === 'text')?.text || '';
      let triageResult: { type: string; confidence: number };
      try {
        triageResult = JSON.parse(triageText);
      } catch {
        const match = triageText.match(/\{[\s\S]*?\}/);
        triageResult = match ? JSON.parse(match[0]) : { type: 'invoice', confidence: 0.5 };
      }

      const triageType = triageResult.type || 'invoice';
      const triageConfidence = triageResult.confidence || 0.5;

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

        const extractResponse = await client.messages.create({
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
        });

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
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      await execute("UPDATE documents SET status = 'error', error_message = $1 WHERE id = $2", [errMsg, doc.id]);
      results.push({ id: doc.id, filename: doc.filename, error: errMsg });
    }
  }

  // Update declaration status to review
  const allDocs = await query("SELECT status FROM documents WHERE declaration_id = $1", [declaration_id]);
  if (allDocs.some(d => d.status === 'extracted')) {
    await execute("UPDATE declarations SET status = 'review', updated_at = NOW() WHERE id = $1", [declaration_id]);
  }

  return NextResponse.json({ results, processed: results.length });
}
