import { readJson } from '@/lib/security/request';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/guard';
import { writeAudit } from '@/lib/audit';
import { clientIp, handleApiError, jsonError, jsonOk } from '@/lib/http';

const Schema = z.object({
  rateId: z.string().min(1),
  ratePercent: z.number().min(0).max(99_999).finite(),
});

export async function PATCH(request: Request) {
  try {
    const session = await requireRole('ADMIN');
    const data = Schema.parse(await readJson(request));

    const existing = await prisma.taxRateConfig.findUnique({
      where: { id: data.rateId },
      select: { id: true, key: true, label: true, ratePercent: true, notes: true },
    });
    if (!existing) return jsonError('Ставка не найдена', 404);

    if (!['VAT_REGISTRATION_THRESHOLD_MCI', 'MCI_MONTHLY_CALC_INDEX_KZT'].includes(existing.key)
      && data.ratePercent > 100) return jsonError('Ставка должна быть от 0 до 100 %', 422);
    await prisma.companyTaxRate.upsert({
      where: { companyId_rateId: { companyId: session.companyId, rateId: data.rateId } },
      create: { companyId: session.companyId, rateId: data.rateId, ratePercent: data.ratePercent, confirmedBy: session.userId },
      update: { ratePercent: data.ratePercent, confirmedBy: session.userId },
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

    return jsonOk({ updated: true, status: 'USER_CONFIRMED' });
  } catch (error) {
    return handleApiError(error);
  }
}
