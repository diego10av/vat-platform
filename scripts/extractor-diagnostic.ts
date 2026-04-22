// ════════════════════════════════════════════════════════════════════════
// Extractor diagnostic — run the VAT registration letter extractor
// against an arbitrary local PDF and print the JSON result to stdout.
//
// Why: cifra's extractor is called from API routes that persist data
// to Supabase. When iterating the prompt against real client paper,
// the reviewer doesn't want anything persisted — just see what the
// model produced, redact identifiers, iterate.
//
// This script:
//   - Reads a PDF from a filesystem path (passed as argv[2])
//   - Calls extractVatLetterFields() directly (same code path as prod)
//   - Prints { ok, fields, meta } to stdout
//   - Never touches Supabase, never writes to disk, never uploads
//
// Usage:
//   npx tsx scripts/extractor-diagnostic.ts ~/Desktop/some-letter.pdf
//
// Requires ANTHROPIC_API_KEY in env (reads .env.local via dotenv).
// Cost per run: one Opus 4.7 call ≈ €0.02-0.05. No budget-guard in
// this script (it's a manual diagnostic tool, not a product endpoint).
//
// Data-handling note for confidentiality:
//   - The PDF is read from the path you pass; it never leaves your
//     machine except via the Anthropic API call (same as production).
//   - The output prints to stdout only. Copy-paste to chat after
//     redacting client identifiers before sharing.
//   - This script is itself committed to git; the PDFs you feed it
//     are NOT (see .gitignore: /*.pdf, /*.PDF, scripts/extractor-
//     diagnostic/output/).
// ════════════════════════════════════════════════════════════════════════

import 'dotenv/config';
import { readFile } from 'fs/promises';
import { resolve, basename, extname } from 'path';
import { extractVatLetterFields, resolveMediaType } from '../src/lib/vat-letter-extract';

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: npx tsx scripts/extractor-diagnostic.ts <path-to-pdf>');
    process.exit(2);
  }
  const path = resolve(arg);
  const filename = basename(path);

  let buffer: Buffer;
  try {
    buffer = await readFile(path);
  } catch (err) {
    console.error(`Could not read ${path}:`, err instanceof Error ? err.message : err);
    process.exit(2);
  }

  // Infer media type from extension. We support PDFs + the image formats
  // the extractor itself accepts. Anything else → fail fast.
  const ext = extname(path).toLowerCase();
  const mimeByExt: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  };
  const mime = mimeByExt[ext];
  if (!mime) {
    console.error(`Unsupported extension ${ext}. Supported: .pdf, .jpg, .jpeg, .png, .gif, .webp`);
    process.exit(2);
  }
  const mediaType = resolveMediaType(mime);
  if (!mediaType) {
    console.error(`resolveMediaType rejected "${mime}".`);
    process.exit(2);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set. Add it to .env.local and retry.');
    process.exit(2);
  }

  const started = Date.now();
  const result = await extractVatLetterFields({
    buffer,
    mediaType,
    filename,
    entityId: null,
  });
  const durationMs = Date.now() - started;

  // Print a single JSON blob so Diego can pipe to jq or copy-paste.
  const envelope = {
    ok: result.ok,
    fields: result.ok ? result.fields : null,
    error: result.ok ? null : result.error,
    meta: {
      bytes: buffer.byteLength,
      filename,
      media_type: mediaType,
      duration_ms: durationMs,
      model: 'claude-opus-4-7',
    },
  };
  process.stdout.write(JSON.stringify(envelope, null, 2) + '\n');
  process.exit(result.ok ? 0 : 1);
}

main().catch(err => {
  console.error('Unhandled error:', err instanceof Error ? err.stack : err);
  process.exit(1);
});
