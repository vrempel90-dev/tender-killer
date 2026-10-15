import { readJson } from '@/lib/security/request';
/**
 * Коммерческие предложения поставщиков.
 *
 * Предложение можно либо ввести вручную, либо импортировать из загруженного
 * XLSX-прайса. Цены, поставщики и остатки не придумываются: всё вводит
 * пользователь или берётся из его файла.
 */

import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireSession, requireWriteAccess } from '@/lib/auth/guard';
import { writeAudit } from '@/lib/audit';
import { clientIp, handleApiError, jsonError, jsonOk } from '@/lib/http';

type Params = { params: Promise<{ id: string }> };

const QuoteItemSchema = z.object({
  name: z.string().min(1).max(500),
  unit: z.string().max(32).default('шт'),
  quantity: z.number().min(0).max(1e9),
  /** Цена за единицу в единицах валюты (не в минорных). */
  unitPrice: z.number().min(0).max(1e13),
  lineItemId: z.string().nullable().optional(),
  specMatch: z.enum(['MATCH', 'PARTIAL', 'MISMATCH', 'UNKNOWN']).default('UNKNOWN'),
  specMatchNote: z.string().max(1000).nullable().optional(),
  leadTimeDays: z.number().int().min(0).max(3650).nullable().optional(),
});

const CreateQuoteSchema = z.object({
  supplierName: z.string().min(2, 'Укажите поставщика').max(300),
  supplierBin: z
    .string()
    .regex(/^\d{12}$/, 'БИН состоит из 12 цифр')
    .nullable()
    .optional(),
  contact: z.string().max(300).nullable().optional(),
  /** Документ-основание: загруженное КП или прайс. */
  documentId: z.string().nullable().optional(),
  currency: z.string().length(3).default('KZT'),
  fxRate: z.number().min(0).max(1e6).nullable().optional(),
  pricesIncludeVat: z.boolean().default(true),
  validUntil: z.iso.date().nullable().optional(),
  deliveryDays: z.number().int().min(0).max(3650).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  items: z.array(QuoteItemSchema).min(1, 'Добавьте хотя бы одну позицию'),
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

    const quotes = await prisma.supplierQuote.findMany({
      where: { tenderId: id },
      orderBy: { createdAt: 'desc' },
      include: {
        items: true,
        document: { select: { originalName: true } },
      },
    });

    return jsonOk(
      quotes.map((q) => ({
        ...q,
        fxRate: q.fxRate === null ? null : Number(q.fxRate),
        items: q.items.map((item) => ({
          ...item,
          quantity: Number(item.quantity),
          unitPriceMinor: Number(item.unitPriceMinor),
        })),
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
    const data = CreateQuoteSchema.parse(await readJson(request));

    const tender = await prisma.tender.findFirst({
      where: { id, companyId: session.companyId },
      select: { id: true },
    });
    if (!tender) return jsonError('Тендер не найден', 404);

    // Документ-основание должен принадлежать этой компании.
    if (data.documentId) {
      const document = await prisma.document.findFirst({
        where: {
          id: data.documentId,
          companyId: session.companyId,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!document) return jsonError('Документ-основание не найден', 404);
    }

    // Валюта, отличная от тенге, требует курса: иначе себестоимость
    // посчитать нельзя, а подставлять курс «по рынку» недопустимо.
    if (data.currency !== 'KZT' && (data.fxRate === null || data.fxRate === undefined)) {
      return jsonError(
        `Для валюты ${data.currency} укажите курс к тенге — без него `
        + 'закупочная себестоимость не рассчитывается.',
        422,
      );
    }

    // Позиции тендера, к которым привязываются строки предложения.
    const lineItemIds = data.items
      .map((i) => i.lineItemId)
      .filter((v): v is string => typeof v === 'string' && v.length > 0);
    if (lineItemIds.length > 0) {
      const count = await prisma.lineItem.count({
        where: { id: { in: lineItemIds }, tenderId: id },
      });
      if (count !== new Set(lineItemIds).size) {
        return jsonError('Некоторые позиции тендера не найдены', 404);
      }
    }

    const quote = await prisma.supplierQuote.create({
      data: {
        companyId: session.companyId,
        tenderId: id,
        supplierName: data.supplierName.trim(),
        supplierBin: data.supplierBin ?? null,
        contact: data.contact ?? null,
        documentId: data.documentId ?? null,
        // Подтверждённым считается предложение с документом-основанием.
        verification: data.documentId ? 'VERIFIED' : 'UNVERIFIED',
        currency: data.currency,
        fxRate: data.fxRate ?? null,
        pricesIncludeVat: data.pricesIncludeVat,
        validUntil: data.validUntil ? new Date(data.validUntil) : null,
        deliveryDays: data.deliveryDays ?? null,
        notes: data.notes ?? null,
        items: {
          create: data.items.map((item) => ({
            name: item.name,
            unit: item.unit,
            quantity: item.quantity,
            unitPriceMinor: BigInt(Math.round(item.unitPrice * 100)),
            lineItemId: item.lineItemId ?? null,
            specMatch: item.specMatch,
            specMatchNote: item.specMatchNote ?? null,
            leadTimeDays: item.leadTimeDays ?? null,
          })),
        },
      },
      include: { items: true },
    });

    await writeAudit({
      companyId: session.companyId,
      userId: session.userId,
      action: 'QUOTE_IMPORT',
      entity: 'SupplierQuote',
      entityId: quote.id,
      ipAddress: clientIp(request),
      metadata: {
        tenderId: id,
        supplierName: quote.supplierName,
        items: quote.items.length,
        verification: quote.verification,
      },
    });

    return jsonOk({ id: quote.id, items: quote.items.length }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const session = await requireWriteAccess();
    const { id } = await params;
    const quoteId = new URL(request.url).searchParams.get('quoteId');
    if (!quoteId) return jsonError('Не указано предложение', 400);

    const quote = await prisma.supplierQuote.findFirst({
      where: { id: quoteId, tenderId: id, companyId: session.companyId },
      select: { id: true, supplierName: true },
    });
    if (!quote) return jsonError('Предложение не найдено', 404);

    await prisma.supplierQuote.delete({ where: { id: quoteId } });

    await writeAudit({
      companyId: session.companyId,
      userId: session.userId,
      action: 'QUOTE_DELETE',
      entity: 'SupplierQuote',
      entityId: quoteId,
      ipAddress: clientIp(request),
      metadata: { supplierName: quote.supplierName },
    });

    return jsonOk({ deleted: true });
  } catch (error) {
    return handleApiError(error);
  }
}
