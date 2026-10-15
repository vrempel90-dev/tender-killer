/** Извлечение товарных позиций из технической спецификации (AI) и их правка. */

import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireSession, requireWriteAccess } from '@/lib/auth/guard';
import { writeAudit } from '@/lib/audit';
import { clientIp, handleApiError, jsonError, jsonOk } from '@/lib/http';
import { extractLineItems } from '@/lib/ai/analyze';
import { AiNotConfiguredError, AiResponseError } from '@/lib/ai/client';
import { toSourceDocuments } from '@/lib/ai/to-source-documents';

type Params = { params: Promise<{ id: string }> };

const ExtractSchema = z.object({
  documentIds: z.array(z.string()).min(1, 'Выберите хотя бы один документ'),
  replaceExisting: z.boolean().optional().default(false),
});

const ManualItemSchema = z.object({
  name: z.string().min(1).max(500),
  specification: z.string().max(4000).nullable().optional(),
  unit: z.string().max(32).default('шт'),
  quantity: z.number().min(0).max(1e9),
});

const UpdateSchema = z.object({
  lineItemId: z.string(),
  confirmedByUser: z.boolean().optional(),
  name: z.string().min(1).max(500).optional(),
  specification: z.string().max(4000).nullable().optional(),
  unit: z.string().max(32).optional(),
  quantity: z.number().min(0).max(1e9).optional(),
  /** Выбранное предложение поставщика — подтверждённая закупочная цена. */
  selectedQuoteItemId: z.string().nullable().optional(),
});

export async function GET(_request: Request, { params }: Params) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const tender = await prisma.tender.findFirst({
      where: { id, companyId: session.companyId },
      select: { id: true },
    });
    if (!tender) return jsonError('Тендер не найден', 404);

    const items = await prisma.lineItem.findMany({
      where: { tenderId: id },
      orderBy: { position: 'asc' },
      include: {
        selectedQuoteItem: { include: { quote: true } },
        quoteItems: { include: { quote: true } },
      },
    });
    return jsonOk(
      items.map((item) => ({
        ...item,
        quantity: Number(item.quantity),
        customerUnitPriceMinor:
          item.customerUnitPriceMinor === null
            ? null
            : Number(item.customerUnitPriceMinor),
      })),
    );
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const session = await requireWriteAccess();
    const { id } = await params;
    const raw = await request.json();

    const tender = await prisma.tender.findFirst({
      where: { id, companyId: session.companyId },
      select: { id: true },
    });
    if (!tender) return jsonError('Тендер не найден', 404);

    // Ручное добавление позиции
    if (raw && typeof raw === 'object' && 'name' in raw) {
      const data = ManualItemSchema.parse(raw);
      const maxPosition = await prisma.lineItem.aggregate({
        where: { tenderId: id },
        _max: { position: true },
      });
      const item = await prisma.lineItem.create({
        data: {
          tenderId: id,
          position: (maxPosition._max.position ?? 0) + 1,
          name: data.name,
          specification: data.specification ?? null,
          unit: data.unit,
          quantity: data.quantity,
          origin: 'MANUAL',
          confirmedByUser: true,
        },
      });
      return jsonOk({ id: item.id }, 201);
    }

    // Извлечение позиций через AI
    const body = ExtractSchema.parse(raw);
    const documents = await prisma.document.findMany({
      where: {
        id: { in: body.documentIds },
        tenderId: id,
        companyId: session.companyId,
        deletedAt: null,
      },
      select: {
        id: true,
        originalName: true,
        extraction: {
          select: { status: true, text: true, unreadablePages: true },
        },
      },
    });
    if (documents.length === 0) {
      return jsonError('Выбранные документы не найдены', 404);
    }

    try {
      const { items, meta } = await extractLineItems({
        documents: toSourceDocuments(documents),
      });

      if (body.replaceExisting) {
        await prisma.lineItem.deleteMany({
          where: { tenderId: id, origin: 'AI', confirmedByUser: false },
        });
      }

      const maxPosition = await prisma.lineItem.aggregate({
        where: { tenderId: id },
        _max: { position: true },
      });
      let position = (maxPosition._max.position ?? 0) + 1;

      await prisma.lineItem.createMany({
        data: items.map((item) => ({
          tenderId: id,
          position: position++,
          name: item.name,
          specification: item.specification,
          unit: item.unit,
          quantity: item.quantity,
          customerUnitPriceMinor:
            item.customerUnitPriceMinor === null
              ? null
              : BigInt(item.customerUnitPriceMinor),
          pageNumber: item.pageNumber,
          sourceQuote: item.sourceQuote,
          origin: 'AI',
          confirmedByUser: false,
        })),
      });

      await writeAudit({
        companyId: session.companyId,
        userId: session.userId,
        action: 'AI_REQUIREMENTS_RUN',
        entity: 'Tender',
        entityId: id,
        ipAddress: clientIp(request),
        metadata: {
          kind: 'LINE_ITEMS',
          extracted: items.length,
          unverifiedQuotes: items.filter((i) => !i.quoteVerified).length,
          model: meta.model,
          tokenUsage: meta.tokenUsage,
        },
      });

      return jsonOk({
        extracted: items.length,
        unverifiedQuotes: items.filter((i) => !i.quoteVerified).length,
        withoutQuantity: items.filter((i) => i.quantity === 0).length,
        limitations: meta.limitations,
        model: meta.model,
      });
    } catch (error) {
      if (error instanceof AiNotConfiguredError) {
        return jsonError(error.message, 503);
      }
      if (error instanceof AiResponseError) {
        return jsonError(error.message, 502);
      }
      throw error;
    }
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const session = await requireWriteAccess();
    const { id } = await params;
    const data = UpdateSchema.parse(await request.json());

    const item = await prisma.lineItem.findFirst({
      where: {
        id: data.lineItemId,
        tenderId: id,
        tender: { companyId: session.companyId },
      },
      select: { id: true },
    });
    if (!item) return jsonError('Позиция не найдена', 404);

    // Предложение поставщика должно принадлежать этому же тендеру.
    if (data.selectedQuoteItemId) {
      const quoteItem = await prisma.supplierQuoteItem.findFirst({
        where: {
          id: data.selectedQuoteItemId,
          quote: { tenderId: id, companyId: session.companyId },
        },
        select: { id: true },
      });
      if (!quoteItem) {
        return jsonError('Выбранное предложение поставщика не найдено', 404);
      }
    }

    await prisma.lineItem.update({
      where: { id: data.lineItemId },
      data: {
        ...(data.confirmedByUser !== undefined
          ? { confirmedByUser: data.confirmedByUser }
          : {}),
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.specification !== undefined
          ? { specification: data.specification }
          : {}),
        ...(data.unit !== undefined ? { unit: data.unit } : {}),
        ...(data.quantity !== undefined ? { quantity: data.quantity } : {}),
        ...(data.selectedQuoteItemId !== undefined
          ? { selectedQuoteItemId: data.selectedQuoteItemId }
          : {}),
      },
    });

    return jsonOk({ updated: true });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const session = await requireWriteAccess();
    const { id } = await params;
    const lineItemId = new URL(request.url).searchParams.get('lineItemId');
    if (!lineItemId) return jsonError('Не указана позиция', 400);

    const item = await prisma.lineItem.findFirst({
      where: {
        id: lineItemId,
        tenderId: id,
        tender: { companyId: session.companyId },
      },
      select: { id: true },
    });
    if (!item) return jsonError('Позиция не найдена', 404);

    await prisma.lineItem.delete({ where: { id: lineItemId } });
    return jsonOk({ deleted: true });
  } catch (error) {
    return handleApiError(error);
  }
}
