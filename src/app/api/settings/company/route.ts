import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/guard';
import { writeAudit } from '@/lib/audit';
import { clientIp, handleApiError, jsonOk } from '@/lib/http';
import { CAN_BE_VAT_PAYER } from '@/lib/finance/tax-config';
import type { TaxRegimeCode } from '@/lib/finance/types';

const Schema = z.object({
  name: z.string().min(2).max(200),
  bin: z
    .string()
    .regex(/^\d{12}$/, 'БИН/ИИН состоит из 12 цифр')
    .or(z.literal('')),
  taxRegime: z.enum([
    'GENERAL_VAT',
    'GENERAL_NO_VAT',
    'SIMPLIFIED',
    'RETAIL_TAX',
    'INDIVIDUAL_ENTREPRENEUR',
  ]),
  isVatPayer: z.boolean(),
  isSmallBusiness: z.boolean(),
});

export async function PATCH(request: Request) {
  try {
    const session = await requireRole('ADMIN');
    const data = Schema.parse(await request.json());

    // Режим может запрещать статус плательщика НДС — приводим к допустимому.
    const isVatPayer =
      data.isVatPayer && CAN_BE_VAT_PAYER[data.taxRegime as TaxRegimeCode];

    await prisma.company.update({
      where: { id: session.companyId },
      data: {
        name: data.name.trim(),
        bin: data.bin.length > 0 ? data.bin : null,
        taxRegime: data.taxRegime,
        isVatPayer,
        isSmallBusiness: data.isSmallBusiness,
      },
    });

    await writeAudit({
      companyId: session.companyId,
      userId: session.userId,
      action: 'TAX_CONFIG_UPDATE',
      entity: 'Company',
      entityId: session.companyId,
      ipAddress: clientIp(request),
      metadata: { taxRegime: data.taxRegime, isVatPayer },
    });

    return jsonOk({ updated: true, isVatPayer });
  } catch (error) {
    return handleApiError(error);
  }
}
