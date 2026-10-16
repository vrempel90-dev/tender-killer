import { readJson } from '@/lib/security/request';
import { prisma } from '@/lib/db';
import { requireSession, requireWriteAccess } from '@/lib/auth/guard';
import { writeAudit } from '@/lib/audit';
import { clientIp, handleApiError, jsonOk } from '@/lib/http';
import {
  dateOrNull,
  emptyToNull,
  TenderCreateSchema,
} from '@/lib/validation/tender';

export async function GET() {
  try {
    const session = await requireSession();
    const tenders = await prisma.tender.findMany({
      // Изоляция данных: выборка всегда ограничена компанией из сессии.
      where: { companyId: session.companyId },
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: { select: { documents: true, requirements: true, lineItems: true } },
      },
    });
    return jsonOk(
      tenders.map((t) => ({
        ...t,
        startPriceMinor: t.startPriceMinor === null ? null : Number(t.startPriceMinor),
      })),
    );
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireWriteAccess();
    const body = await readJson(request);
    const data = TenderCreateSchema.parse(body);

    const tender = await prisma.tender.create({
      data: {
        companyId: session.companyId,
        title: data.title.trim(),
        externalNumber: emptyToNull(data.externalNumber),
        sourceUrl: emptyToNull(data.sourceUrl),
        customerName: emptyToNull(data.customerName),
        customerBin: emptyToNull(data.customerBin),
        procurementType: data.procurementType,
        startPriceMinor:
          data.startPrice === null || data.startPrice === undefined
            ? null
            : BigInt(data.startPrice),
        submissionDeadline: dateOrNull(data.submissionDeadline),
        deliveryDeadline: dateOrNull(data.deliveryDeadline),
        region: emptyToNull(data.region),
        notes: emptyToNull(data.notes),
      },
    });

    await writeAudit({
      companyId: session.companyId,
      userId: session.userId,
      action: 'TENDER_CREATE',
      entity: 'Tender',
      entityId: tender.id,
      ipAddress: clientIp(request),
      metadata: { title: tender.title },
    });

    return jsonOk({ id: tender.id }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
