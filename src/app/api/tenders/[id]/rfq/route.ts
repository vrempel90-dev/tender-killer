/** Формирование текста запроса коммерческого предложения. */

import { prisma } from '@/lib/db';
import { requireSession } from '@/lib/auth/guard';
import { handleApiError, jsonError, jsonOk } from '@/lib/http';
import { buildRfqText } from '@/lib/sourcing/rfq';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession();
    const { id } = await params;

    const [tender, company, user] = await Promise.all([
      prisma.tender.findFirst({
        where: { id, companyId: session.companyId },
        include: { lineItems: { orderBy: { position: 'asc' } } },
      }),
      prisma.company.findUnique({
        where: { id: session.companyId },
        select: { name: true, bin: true },
      }),
      prisma.user.findUnique({
        where: { id: session.userId },
        select: { name: true, email: true },
      }),
    ]);

    if (!tender || !company || !user) return jsonError('Тендер не найден', 404);

    const text = buildRfqText({
      companyName: company.name,
      companyBin: company.bin,
      contactName: user.name,
      contactEmail: user.email,
      tenderTitle: tender.title,
      deliveryDeadline: tender.deliveryDeadline,
      region: tender.region,
      responseDeadline: tender.submissionDeadline
        ? new Date(tender.submissionDeadline.getTime() - 5 * 86_400_000)
        : null,
      items: tender.lineItems.map((item) => ({
        position: item.position,
        name: item.name,
        specification: item.specification,
        unit: item.unit,
        quantity: Number(item.quantity),
      })),
    });

    return jsonOk({ text, itemCount: tender.lineItems.length });
  } catch (error) {
    return handleApiError(error);
  }
}
