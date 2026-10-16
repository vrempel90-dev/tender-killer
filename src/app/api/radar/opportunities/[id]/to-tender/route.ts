/**
 * TENDER RADAR → финансовый модуль.
 *
 * Создаёт тендер из найденного объявления. Переносятся только те данные,
 * которые есть в выгрузке; ничего не достраивается. Если в объявлении нет
 * суммы, тендер создаётся без начальной цены, и пользователь увидит это в
 * финансовом модуле как незаполненное поле, а не как ноль.
 *
 * Связь объявление↔тендер хранится: в расчёте всегда видно, из какого
 * объявления и какого источника он возник.
 */

import { prisma, dbTransaction } from '@/lib/db';
import { requireWriteAccess } from '@/lib/auth/guard';
import { writeAudit } from '@/lib/audit';
import { clientIp, handleApiError, jsonError, jsonOk } from '@/lib/http';

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const session = await requireWriteAccess();
    const { id } = await params;

    const opportunity = await prisma.procurementOpportunity.findFirst({
      // Фильтр по компании: идентификатор пришёл от клиента.
      where: { id, companyId: session.companyId },
      include: {
        import: { select: { sourceName: true, sourceUrl: true, actualAt: true, fileName: true } },
      },
    });
    if (!opportunity) return jsonError('Объявление не найдено', 404);

    if (opportunity.tenderId !== null) {
      return jsonError('Объявление уже передано в расчёт', 409, {
        tenderId: opportunity.tenderId,
      });
    }

    const noteLines = [
      `Создано из объявления TENDER RADAR.`,
      `Источник: ${opportunity.import.sourceName}`,
      `Файл выгрузки: ${opportunity.import.fileName}`,
      `Данные актуальны на: ${opportunity.import.actualAt.toISOString().slice(0, 10)}`,
    ];
    if (opportunity.import.sourceUrl) {
      noteLines.push(`Страница источника: ${opportunity.import.sourceUrl}`);
    }
    if (opportunity.priceMinor === null) {
      noteLines.push(
        'ВНИМАНИЕ: в выгрузке не было плановой суммы — начальная цена не заполнена.',
      );
    }

    const tender = await dbTransaction(async (tx) => {
      const created = await tx.tender.create({
        data: {
          companyId: session.companyId,
          title: opportunity.title,
          externalNumber: opportunity.externalId,
          sourceUrl: opportunity.sourceUrl,
          customerName: opportunity.customerName,
          customerBin: opportunity.customerBin,
          procurementType: opportunity.procurementType,
          startPriceMinor: opportunity.priceMinor,
          currency: opportunity.currency,
          submissionDeadline: opportunity.deadline,
          deliveryDeadline: opportunity.deliveryDeadline,
          region: opportunity.region,
          notes: noteLines.join('\n'),
        },
      });
      await tx.procurementOpportunity.update({
        where: { id: opportunity.id },
        data: { tenderId: created.id },
      });
      return created;
    });

    await writeAudit({
      companyId: session.companyId,
      userId: session.userId,
      action: 'RADAR_TENDER_CREATED',
      entity: 'Tender',
      entityId: tender.id,
      ipAddress: clientIp(request),
      metadata: {
        opportunityId: opportunity.id,
        externalId: opportunity.externalId,
        sourceName: opportunity.import.sourceName,
        priceKnown: opportunity.priceMinor !== null,
      },
    });

    return jsonOk(
      {
        tenderId: tender.id,
        title: tender.title,
        priceKnown: opportunity.priceMinor !== null,
      },
      201,
    );
  } catch (error) {
    return handleApiError(error);
  }
}
