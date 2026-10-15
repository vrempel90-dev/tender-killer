import { readJson } from '@/lib/security/request';
/**
 * Расчёт финансовой модели. Выполняется на сервере, чтобы движок и налоговая
 * конфигурация были единственным источником истины (клиент не считает сам).
 */

import { z } from 'zod';
import { requireSession } from '@/lib/auth/guard';
import { handleApiError, jsonOk } from '@/lib/http';
import { calculateFinance } from '@/lib/finance/engine';
import { calculateAllScenarios } from '@/lib/finance/scenarios';
import { FinanceInputSchema } from '@/lib/finance/schema';
import type { FinanceInput } from '@/lib/finance/types';
import { canonicalFinanceInput } from '@/lib/finance/company-tax';
import { consumeQuota } from '@/lib/security/quota';

const RequestSchema = z.object({
  input: FinanceInputSchema,
  withScenarios: z.boolean().optional().default(true),
});

export async function POST(request: Request) {
  try {
    // Расчёт не меняет данные, но доступен только авторизованным.
    const session = await requireSession();
    await consumeQuota('finance', session.companyId, 120, 60);
    const { input, withScenarios } = RequestSchema.parse(await readJson(request));
    const typed = await canonicalFinanceInput(session.companyId, input as FinanceInput);

    const result = calculateFinance(typed);
    const scenarios = withScenarios ? calculateAllScenarios(typed) : [];

    return jsonOk({
      result,
      scenarios: scenarios.map((s) => ({
        code: s.code,
        label: s.label,
        description: s.description,
        adjustment: s.adjustment,
        result: s.result,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
