import { prisma } from '@/lib/db';
import { requireSession, requireWriteAccess } from '@/lib/auth/guard';
import { writeAudit } from '@/lib/audit';
import { clientIp, handleApiError, jsonError, jsonOk } from '@/lib/http';
import {
  dateOrNull,
  emptyToNull,
  TenderUpdateSchema,
} from '@/lib/validation/tender';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const tender = await prisma.tender.findFirst({
      where: { id, companyId: session.companyId },
      include: {
        documents: { where: { deletedAt: null }, include: { extraction: true } },
        requirements: true,
        lineItems: true,
        financialModels: { orderBy: { updatedAt: 'desc' } },
      },
    });
    if (!tender) return jsonError('Тендер не найден', 404);
    return jsonOk({
      ...tender,
      startPriceMinor:
        tender.startPriceMinor === null ? null : Number(tender.startPriceMinor),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const session = await requireWriteAccess();
    const { id } = await params;
    const existing = await prisma.tender.findFirst({
      where: { id, companyId: session.companyId },
      select: { id: true },
    });
    if (!existing) return jsonError('Тендер не найден', 404);

    const data = TenderUpdateSchema.parse(await request.json());

    await prisma.tender.update({
      where: { id },
      data: {
        ...(data.title !== undefined ? { title: data.title.trim() } : {}),
        ...(data.externalNumber !== undefined
          ? { externalNumber: emptyToNull(data.externalNumber) }
          : {}),
        ...(data.sourceUrl !== undefined
          ? { sourceUrl: emptyToNull(data.sourceUrl) }
          : {}),
        ...(data.customerName !== undefined
          ? { customerName: emptyToNull(data.customerName) }
          : {}),
        ...(data.customerBin !== undefined
          ? { customerBin: emptyToNull(data.customerBin) }
          : {}),
        ...(data.procurementType !== undefined
          ? { procurementType: data.procurementType }
          : {}),
        ...(data.stage !== undefined ? { stage: data.stage } : {}),
        ...(data.startPrice !== undefined
          ? {
              startPriceMinor:
                data.startPrice === null ? null : BigInt(data.startPrice),
            }
          : {}),
        ...(data.submissionDeadline !== undefined
          ? { submissionDeadline: dateOrNull(data.submissionDeadline) }
          : {}),
        ...(data.deliveryDeadline !== undefined
          ? { deliveryDeadline: dateOrNull(data.deliveryDeadline) }
          : {}),
        ...(data.region !== undefined ? { region: emptyToNull(data.region) } : {}),
        ...(data.notes !== undefined ? { notes: emptyToNull(data.notes) } : {}),
      },
    });

    await writeAudit({
      companyId: session.companyId,
      userId: session.userId,
      action: 'TENDER_UPDATE',
      entity: 'Tender',
      entityId: id,
      ipAddress: clientIp(request),
      metadata: { fields: Object.keys(data) },
    });

    return jsonOk({ id });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const session = await requireWriteAccess();
    const { id } = await params;
    const existing = await prisma.tender.findFirst({
      where: { id, companyId: session.companyId },
      select: { id: true, title: true },
    });
    if (!existing) return jsonError('Тендер не найден', 404);

    await prisma.tender.delete({ where: { id } });

    await writeAudit({
      companyId: session.companyId,
      userId: session.userId,
      action: 'TENDER_DELETE',
      entity: 'Tender',
      entityId: id,
      ipAddress: clientIp(request),
      metadata: { title: existing.title },
    });

    return jsonOk({ deleted: true });
  } catch (error) {
    return handleApiError(error);
  }
}
