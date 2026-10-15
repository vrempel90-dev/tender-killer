/** Сохранение и чтение финансовых моделей тендера. */

import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireSession, requireWriteAccess } from '@/lib/auth/guard';
import { writeAudit } from '@/lib/audit';
import { clientIp, handleApiError, jsonError, jsonOk } from '@/lib/http';
import { calculateFinance, ENGINE_VERSION } from '@/lib/finance/engine';
import { FinanceInputSchema } from '@/lib/finance/schema';
import type { FinanceInput } from '@/lib/finance/types';

type Params = { params: Promise<{ id: string }> };

const SaveSchema = z.object({
  name: z.string().min(1).max(200).default('Базовый расчёт'),
  modelId: z.string().optional(),
  input: FinanceInputSchema,
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

    const models = await prisma.financialModel.findMany({
      where: { tenderId: id },
      orderBy: { updatedAt: 'desc' },
    });
    return jsonOk(models);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const session = await requireWriteAccess();
    const { id } = await params;
    const tender = await prisma.tender.findFirst({
      where: { id, companyId: session.companyId },
      select: { id: true },
    });
    if (!tender) return jsonError('Тендер не найден', 404);

    const data = SaveSchema.parse(await request.json());
    const input = data.input as FinanceInput;

    // Результат пересчитывается на сервере: клиентскому результату не доверяем.
    const result = calculateFinance(input);

    const model = data.modelId
      ? await prisma.financialModel.update({
          where: { id: data.modelId },
          data: {
            name: data.name,
            inputs: input as unknown as object,
            result: result as unknown as object,
            engineVersion: ENGINE_VERSION,
            taxConfigVersion: input.tax.configVersion,
          },
        })
      : await prisma.financialModel.create({
          data: {
            tenderId: id,
            name: data.name,
            inputs: input as unknown as object,
            result: result as unknown as object,
            engineVersion: ENGINE_VERSION,
            taxConfigVersion: input.tax.configVersion,
          },
        });

    await writeAudit({
      companyId: session.companyId,
      userId: session.userId,
      action: 'FINANCE_SAVE',
      entity: 'FinancialModel',
      entityId: model.id,
      ipAddress: clientIp(request),
      metadata: {
        tenderId: id,
        netProfitMinor: result.profit.netMinor,
        engineVersion: ENGINE_VERSION,
      },
    });

    return jsonOk({ id: model.id, result });
  } catch (error) {
    return handleApiError(error);
  }
}
