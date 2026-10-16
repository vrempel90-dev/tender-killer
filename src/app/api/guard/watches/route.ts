/**
 * TENDER GUARD: наблюдения за тендерами.
 *
 * Постановка на контроль создаёт первую редакцию — точку отсчёта.
 * Сравнивать её не с чем, и это отдельный честный результат, а не
 * «изменений нет».
 */

import { z } from 'zod';
import { dbTransaction, prisma } from '@/lib/db';
import { requireSession, requireWriteAccess } from '@/lib/auth/guard';
import { writeAudit } from '@/lib/audit';
import { clientIp, handleApiError, jsonError, jsonOk } from '@/lib/http';
import { readJson } from '@/lib/security/request';
import { buildSnapshotSource, registerRevision } from '@/lib/guard/service';

const CreateSchema = z.object({
  tenderId: z.string().min(1, 'Укажите тендер').max(64),
  note: z.string().trim().max(500).optional(),
  /** Документ с техническим заданием. По умолчанию — последний загруженный. */
  documentId: z.string().min(1).max(64).optional(),
});

export async function GET() {
  try {
    const session = await requireSession();
    const watches = await prisma.tenderWatch.findMany({
      where: { companyId: session.companyId },
      orderBy: { updatedAt: 'desc' },
      take: 200,
      select: {
        id: true,
        tenderId: true,
        isActive: true,
        note: true,
        createdAt: true,
        updatedAt: true,
        tender: {
          select: {
            title: true,
            externalNumber: true,
            stage: true,
            submissionDeadline: true,
            deliveryDeadline: true,
            startPriceMinor: true,
          },
        },
        _count: { select: { snapshots: true, changes: true } },
        changes: {
          where: { acknowledgedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            kind: true,
            severity: true,
            summary: true,
            requiresRecalc: true,
            createdAt: true,
          },
        },
        snapshots: {
          orderBy: { revision: 'desc' },
          take: 1,
          select: { revision: true, capturedAt: true, specCharCount: true },
        },
      },
    });

    return jsonOk(
      watches.map((watch) => ({
        id: watch.id,
        tenderId: watch.tenderId,
        title: watch.tender.title,
        externalNumber: watch.tender.externalNumber,
        stage: watch.tender.stage,
        isActive: watch.isActive,
        note: watch.note,
        revisions: watch._count.snapshots,
        changesTotal: watch._count.changes,
        pendingChanges: watch.changes,
        lastRevision: watch.snapshots[0] ?? null,
        startPrice:
          watch.tender.startPriceMinor === null
            ? null
            : Number(watch.tender.startPriceMinor) / 100,
        submissionDeadline: watch.tender.submissionDeadline,
        deliveryDeadline: watch.tender.deliveryDeadline,
        updatedAt: watch.updatedAt,
      })),
    );
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireWriteAccess();
    const data = CreateSchema.parse(await readJson(request));

    const existing = await prisma.tenderWatch.findFirst({
      where: { companyId: session.companyId, tenderId: data.tenderId },
      select: { id: true },
    });
    if (existing) {
      return jsonError('Тендер уже на контроле', 409, { watchId: existing.id });
    }

    const source = await buildSnapshotSource({
      companyId: session.companyId,
      tenderId: data.tenderId,
      documentId: data.documentId ?? null,
    });
    // null означает, что тендера нет или он принадлежит другой компании.
    if (!source) return jsonError('Тендер не найден', 404);

    const result = await dbTransaction(async (tx) => {
      const watch = await tx.tenderWatch.create({
        data: {
          companyId: session.companyId,
          tenderId: data.tenderId,
          note: data.note ?? null,
          watchedById: session.userId,
        },
      });
      const revision = await registerRevision({
        tx,
        watchId: watch.id,
        source,
        sourceKind: source.documentId === null ? 'MANUAL' : 'DOCUMENT',
        capturedById: session.userId,
        note: 'Точка отсчёта при постановке на контроль',
        financeInput: null,
      });
      return { watch, revision };
    });

    await writeAudit({
      companyId: session.companyId,
      userId: session.userId,
      action: 'WATCH_START',
      entity: 'TenderWatch',
      entityId: result.watch.id,
      ipAddress: clientIp(request),
      metadata: { tenderId: data.tenderId, specCaptured: source.specText !== null },
    });

    return jsonOk(
      {
        watchId: result.watch.id,
        revision: result.revision.revision,
        specCaptured: source.specText !== null,
        // Ограничение обозначается сразу, а не когда окажется, что
        // сравнивать было нечего.
        limitation: source.specMissingReason,
      },
      201,
    );
  } catch (error) {
    return handleApiError(error);
  }
}
