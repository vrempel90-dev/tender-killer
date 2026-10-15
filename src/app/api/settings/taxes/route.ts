import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/guard';
import { writeAudit } from '@/lib/audit';
import { clientIp, handleApiError, jsonError, jsonOk } from '@/lib/http';

const Schema = z.object({
  rateId: z.string().min(1),
  ratePercent: z.number().min(0).max(1_000_000).finite(),
});

export async function PATCH(request: Request) {
  try {
    const session = await requireRole('ADMIN');
    const data = Schema.parse(await request.json());

    const existing = await prisma.taxRateConfig.findUnique({
      where: { id: data.rateId },
      select: { id: true, key: true, label: true, ratePercent: true, notes: true },
    });
    if (!existing) return jsonError('Ставка не найдена', 404);

    await prisma.taxRateConfig.update({
      where: { id: data.rateId },
      data: {
        ratePercent: data.ratePercent,
        // После ручной правки пометка о необходимости сверки снимается:
        // значение изменил человек, который его проверил.
        notes:
          existing.notes && existing.notes.includes('ТРЕБУЕТ СВЕРКИ')
            ? `${existing.notes.replace('⚠️ ТРЕБУЕТ СВЕРКИ С ПЕРВОИСТОЧНИКОМ. ', '')} `
              + `Значение изменено вручную ${new Date().toISOString().slice(0, 10)}.`
            : existing.notes,
      },
    });

    await writeAudit({
      companyId: session.companyId,
      userId: session.userId,
      action: 'TAX_CONFIG_UPDATE',
      entity: 'TaxRateConfig',
      entityId: data.rateId,
      ipAddress: clientIp(request),
      metadata: {
        key: existing.key,
        previous: Number(existing.ratePercent),
        next: data.ratePercent,
      },
    });

    return jsonOk({ updated: true });
  } catch (error) {
    return handleApiError(error);
  }
}
