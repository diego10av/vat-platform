import { NextRequest, NextResponse } from 'next/server';
import { queryOne, execute, generateId, logAudit, initializeSchema } from '@/lib/db';
import { createClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

const log = logger.bind('documents/upload');

function getFileType(filename: string): 'pdf' | 'image' | 'word' {
  const ext = filename.toLowerCase().split('.').pop();
  if (ext === 'pdf') return 'pdf';
  if (['png', 'jpg', 'jpeg', 'gif', 'tiff', 'bmp'].includes(ext || '')) return 'image';
  if (['doc', 'docx'].includes(ext || '')) return 'word';
  return 'pdf';
}

function getSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(request: NextRequest) {
  await initializeSchema();
  const formData = await request.formData();
  const declarationId = formData.get('declaration_id') as string;
  const files = formData.getAll('files') as File[];

  if (!declarationId) return NextResponse.json({ error: 'declaration_id is required' }, { status: 400 });
  if (files.length === 0) return NextResponse.json({ error: 'No files provided' }, { status: 400 });

  const declaration = await queryOne('SELECT * FROM declarations WHERE id = $1', [declarationId]);
  if (!declaration) return NextResponse.json({ error: 'Declaration not found' }, { status: 404 });

  // Update to uploading if created
  if (declaration.status === 'created') {
    await execute("UPDATE declarations SET status = 'uploading', updated_at = NOW() WHERE id = $1", [declarationId]);
  }

  const supabase = getSupabaseClient();
  const documents = [];

  for (const file of files) {
    const id = generateId();
    const fileType = getFileType(file.name);
    const storagePath = `${declarationId}/${id}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

    // Upload to Supabase Storage
    const bytes = await file.arrayBuffer();
    const { error: uploadError } = await supabase.storage
      .from('documents')
      .upload(storagePath, Buffer.from(bytes), {
        contentType: file.type || 'application/octet-stream',
      });

    if (uploadError) {
      log.error('Supabase upload failed', uploadError, { filename: file.name });
      // Continue with other files
      continue;
    }

    await execute(
      `INSERT INTO documents (id, declaration_id, filename, file_path, file_type, file_size, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'uploaded')`,
      [id, declarationId, file.name, storagePath, fileType, file.size]
    );

    await logAudit({
      entityId: declaration.entity_id as string,
      declarationId, action: 'create', targetType: 'document', targetId: id,
      newValue: JSON.stringify({ filename: file.name, size: file.size, type: fileType }),
    });

    documents.push({ id, filename: file.name, file_type: fileType, file_size: file.size, status: 'uploaded' });
  }

  return NextResponse.json({ documents, count: documents.length }, { status: 201 });
}
