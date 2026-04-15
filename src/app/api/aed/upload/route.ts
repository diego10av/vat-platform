import { NextRequest, NextResponse } from 'next/server';
import { execute, generateId, logAudit } from '@/lib/db';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'fs/promises';
import path from 'path';

export const maxDuration = 90;

function supabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

const HAIKU = 'claude-haiku-4-5-20251001';

// POST /api/aed/upload — multipart: file, optional entity_id
// Stores the file, runs the AED reader agent, persists the classification.
export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const entityId = (formData.get('entity_id') as string) || null;
  if (!file) return NextResponse.json({ error: 'file required' }, { status: 400 });

  const id = generateId();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `aed/${entityId || 'unassigned'}/${Date.now()}_${safeName}`;
  const bytes = await file.arrayBuffer();

  const sb = supabase();
  const { error: upErr } = await sb.storage.from('documents').upload(storagePath, Buffer.from(bytes), {
    contentType: file.type || 'application/octet-stream',
  });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  await execute(
    `INSERT INTO aed_communications (id, entity_id, filename, file_path, file_size, status)
     VALUES ($1, $2, $3, $4, $5, 'received')`,
    [id, entityId, file.name, storagePath, file.size]
  );

  // Run AED reader (best-effort; failures don't block the upload)
  try {
    const promptPath = path.join(process.cwd(), 'prompts', 'aed-reader.md');
    const systemPrompt = await readFile(promptPath, 'utf-8');
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (apiKey && file.type === 'application/pdf') {
      const client = new Anthropic({ apiKey });
      const base64 = Buffer.from(bytes).toString('base64');
      const resp = await client.messages.create({
        model: HAIKU,
        max_tokens: 700,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
            { type: 'text', text: 'Classify this AED letter.' },
          ],
        }],
      });
      const text = resp.content.find(b => b.type === 'text')?.text || '';
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        type Parsed = { type?: string; reference?: string; amount?: number; deadline_date?: string; urgency?: string; summary?: string };
        const parsed: Parsed = JSON.parse(match[0]);
        await execute(
          `UPDATE aed_communications
              SET type = $1, reference = $2, amount = $3, deadline_date = $4,
                  urgency = $5, summary = $6, updated_at = NOW()
            WHERE id = $7`,
          [parsed.type ?? null, parsed.reference ?? null, parsed.amount ?? null,
           parsed.deadline_date ?? null, parsed.urgency ?? null, parsed.summary ?? null, id]
        );
      }
    }
  } catch (e) {
    console.error('[aed/upload] reader failed', e);
  }

  if (entityId) {
    await logAudit({
      entityId,
      action: 'create', targetType: 'aed_communication', targetId: id,
      newValue: file.name,
    });
  }

  return NextResponse.json({ id, success: true });
}
