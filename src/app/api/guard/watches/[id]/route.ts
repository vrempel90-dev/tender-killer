import { prisma } from '@/lib/db';
import { requireSession, requireWriteAccess } from '@/lib/auth/guard';
import { writeAudit } from '@/lib/audit';
import { clientIp, handleApiError, jsonError, jsonOk } from '@/lib/http';

type Params = { params: Promise<{ id: string }> };

/** История наблюдения: редакции и изменения. */
export async function GET(_request: Request, { params }: Params) {
  try {
    const session = await requireSession();
    const { id } = await params;

    const watch = await prisma.tenderWatch.findFirst({
      // Фильтр по компании: идентификатор пришёл от клиента.
      where: { id, companyId: session.companyId },
      select: {
        id: true,
        tenderId: true,
        isActive: true,
        note: true,
        tender: { select: { title: true, externalNumber: true } },
        snapshots: {
          orderBy: { revision: 'asc' },
          select: {
            id: true,
            revision: true,
            sourceKind: true,
            documentId: true,
            submissionDeadline: true,
            deliveryDeadline: true,
            startPriceMinor: true,
            specCharCount: true,
            note: true,
            capturedAt: true,
            document: { select: { originalName: true } },
          },
        },
        changes: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            kind: true,
            severity: true,
            summary: true,
            detail: true,
            requiresRecalc: true,
            financialImpact: true,
            acknowledgedAt: true,
            createdAt: true,
            fromSnapshot: { select: { revision: true } },
            toSnapshot: { select: { revision: true } },
          },
        },
      },
    });
    if (!watch) return jsonError('Наблюдение не найдено', 404);

    return jsonOk({
      ...watch,
      snapshots: watch.snapshots.map((snapshot) => ({
        ...snapshot,
        startPrice:
          snapshot.startPriceMinor === null
            ? null
            : Number(snapshot.startPriceMinor) / 100,
        startPriceMinor: undefined,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const session = await requireWriteAccess();
    const { id } = await params;

    const watch = await prisma.tenderWatch.findFirst({
      where: { id, companyId: session.companyId },
      select: { id: true, tenderId: true },
    });
    if (!watch) return jsonError('Наблюдение не найдено', 404);

    // Наблюдение снимается, но история редакций и изменений остаётся:
    // это основание для прошлых решений.
    await prisma.tenderWatch.update({
      where: { id: watch.id },
      data: { isActive: false },
    });

    await writeAudit({
      companyId: session.companyId,
      userId: session.userId,
      action: 'WATCH_STOP',
      entity: 'TenderWatch',
      entityId: watch.id,
      ipAddress: clientIp(request),
      metadata: { tenderId: watch.tenderId },
    });

    return jsonOk({ stopped: true, historyKept: true });
  } catch (error) {
    return handleApiError(error);
  }
}
