/** Формирование отчёта по тендеру: данные (JSON) и выгрузка PDF. */

import { prisma } from '@/lib/db';
import { requireSession, requireWriteAccess } from '@/lib/auth/guard';
import { writeAudit } from '@/lib/audit';
import { clientIp, handleApiError, jsonError, jsonOk } from '@/lib/http';
import { buildDecisionReport } from '@/lib/reports/build-report';
import { generateDecisionPdf, PdfFontMissingError } from '@/lib/reports/pdf';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const format = new URL(request.url).searchParams.get('format') ?? 'json';

    const data = await buildDecisionReport({
      tenderId: id,
      companyId: session.companyId,
    });
    if (!data) return jsonError('Тендер не найден', 404);

    if (format === 'pdf') {
      try {
        const pdf = await generateDecisionPdf(data);
        const fileName = `Отчёт_${data.tender.title.slice(0, 60)}.pdf`;
        return new Response(new Uint8Array(pdf), {
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
            'Content-Length': String(pdf.byteLength),
            'Cache-Control': 'private, no-store',
          },
        });
      } catch (error) {
        if (error instanceof PdfFontMissingError) {
          // Шрифта нет — говорим об этом прямо, а не выдаём битый файл.
          return jsonError(error.message, 503);
        }
        throw error;
      }
    }

    return jsonOk(data);
  } catch (error) {
    return handleApiError(error);
  }
}

/** Сохранение снимка отчёта: фиксирует состояние на момент решения. */
export async function POST(request: Request, { params }: Params) {
  try {
    const session = await requireWriteAccess();
    const { id } = await params;

    const data = await buildDecisionReport({
      tenderId: id,
      companyId: session.companyId,
    });
    if (!data) return jsonError('Тендер не найден', 404);

    const report = await prisma.report.create({
      data: {
        companyId: session.companyId,
        tenderId: id,
        kind: 'DECISION',
        payload: data as unknown as object,
      },
    });

    await writeAudit({
      companyId: session.companyId,
      userId: session.userId,
      action: 'REPORT_GENERATE',
      entity: 'Report',
      entityId: report.id,
      ipAddress: clientIp(request),
      metadata: {
        tenderId: id,
        hasFinance: data.finance !== null,
        hasCompliance: data.compliance !== null,
        hasContract: data.contract !== null,
        gaps: data.gaps.length,
      },
    });

    return jsonOk({ id: report.id }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
