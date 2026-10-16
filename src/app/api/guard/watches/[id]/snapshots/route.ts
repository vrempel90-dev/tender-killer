/**
 * TENDER GUARD: регистрация новой редакции условий.
 *
 * Новую редакцию приносит пользователь: либо документ (тогда берётся
 * извлечённый из него текст задания), либо новые сроки и цена вручную.
 * Автоматически узнать об изменении приложение не может — законного
 * доступа к API порталов у него нет, и притворяться обратным нельзя.
 */

import { z } from 'zod';
import { dbTransaction, prisma } from '@/lib/db';
import { requireWriteAccess } from '@/lib/auth/guard';
import { writeAudit } from '@/lib/audit';
import { clientIp, handleApiError, jsonError, jsonOk } from '@/lib/http';
import { readJson } from '@/lib/security/request';
import { consumeQuota } from '@/lib/security/quota';
import { toMinor } from '@/lib/money';
import {
  buildSnapshotSource,
  latestFinanceInput,
  registerRevision,
} from '@/lib/guard/service';

type Params = { params: Promise<{ id: string }> };

const RevisionSchema = z.object({
  /** Документ новой редакции технического задания. */
  documentId: z.string().min(1).max(64).optional(),
  /** Новые условия, если они пришли не из документа. */
  submissionDeadline: z.string().datetime().nullable().optional(),
  deliveryDeadline: z.string().datetime().nullable().optional(),
  /** Начальная цена в тенге. */
  startPrice: z.number().finite().min(0).max(1e12).nullable().optional(),
  note: z.string().trim().max(500).optional(),
}).strict();

export async function POST(request: Request, { params }: Params) {
  try {
    const session = await requireWriteAccess();
    const { id } = await params;
    await consumeQuota('guard-revision', session.companyId, 60, 3600);

    const data = RevisionSchema.parse(await readJson(request));

    const watch = await prisma.tenderWatch.findFirst({
      // Фильтр по компании: идентификатор пришёл от клиента.
      where: { id, companyId: session.companyId },
      select: { id: true, tenderId: true, isActive: true },
    });
    if (!watch) return jsonError('Наблюдение не найдено', 404);
    if (!watch.isActive) {
      return jsonError(
        'Наблюдение снято. Поставьте тендер на контроль заново, чтобы '
        + 'фиксировать новые редакции.',
        409,
      );
    }

    const source = await buildSnapshotSource({
      companyId: session.companyId,
      tenderId: watch.tenderId,
      documentId: data.documentId ?? null,
      overrides: {
        ...(data.submissionDeadline !== undefined
          ? {
            submissionDeadline:
                data.submissionDeadline === null ? null : new Date(data.submissionDeadline),
          }
          : {}),
        ...(data.deliveryDeadline !== undefined
          ? {
            deliveryDeadline:
                data.deliveryDeadline === null ? null : new Date(data.deliveryDeadline),
          }
          : {}),
        ...(data.startPrice !== undefined
          ? {
            startPriceMinor: data.startPrice === null ? null : toMinor(data.startPrice),
          }
          : {}),
      },
    });
    if (!source) return jsonError('Тендер не найден', 404);

    // Переоценка считается по последнему сохранённому расчёту. Если его
    // нет, переоценка честно объявляется невозможной.
    const financeInput = await latestFinanceInput({
      companyId: session.companyId,
      tenderId: watch.tenderId,
    });

    const result = await dbTransaction(async (tx) => {
      const revision = await registerRevision({
        tx,
        watchId: watch.id,
        source,
        sourceKind: data.documentId ? 'DOCUMENT' : 'MANUAL',
        capturedById: session.userId,
        note: data.note ?? null,
        financeInput,
      });
      await tx.tenderWatch.update({
        where: { id: watch.id },
        data: { updatedAt: new Date() },
      });
      return revision;
    });

    await writeAudit({
      companyId: session.companyId,
      userId: session.userId,
      action: 'WATCH_REVISION',
      entity: 'TenderWatch',
      entityId: watch.id,
      ipAddress: clientIp(request),
      metadata: {
        revision: result.revision,
        changes: result.changes.length,
        severities: result.changes.map((change) => change.severity),
        recalcRequired: result.changes.some((change) => change.requiresRecalc),
      },
    });

    return jsonOk(
      {
        revision: result.revision,
        // Пустой перечень изменений — отдельный результат, а не «ничего
        // не проверяли».
        changes: result.changes,
        risk: result.risk,
        limitation: result.specMissingReason,
        isBaseline: result.revision === 1,
      },
      201,
    );
  } catch (error) {
    return handleApiError(error);
  }
}
