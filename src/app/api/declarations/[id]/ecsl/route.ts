import { NextRequest, NextResponse } from 'next/server';
import { buildECSLReport, buildECSLXlsx, buildECSLXml } from '@/lib/ec-sales-list';

// GET /api/declarations/[id]/ecsl?format=json|xlsx|xml (default: json summary)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const format = request.nextUrl.searchParams.get('format') || 'json';

  try {
    const report = await buildECSLReport(id);

    if (format === 'xlsx') {
      const { buffer, filename } = await buildECSLXlsx(report);
      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    if (format === 'xml') {
      const { xml, filename } = buildECSLXml(report);
      return new NextResponse(xml, {
        status: 200,
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    return NextResponse.json(report);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
