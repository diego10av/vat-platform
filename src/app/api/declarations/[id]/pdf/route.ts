import { NextRequest, NextResponse } from 'next/server';
import { buildFrontPagePDF } from '@/lib/front-page-pdf';

// PDFKit needs the Node.js runtime (not Edge) for filesystem font loading.
export const runtime = 'nodejs';
export const maxDuration = 60;

// GET /api/declarations/:id/pdf — streams the front-page PDF.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { buffer, filename } = await buildFrontPagePDF(id);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
