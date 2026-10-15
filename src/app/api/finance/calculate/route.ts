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

const RequestSchema = z.object({
  input: FinanceInputSchema,
  withScenarios: z.boolean().optional().default(true),
});

export async function POST(request: Request) {
  try {
    // Расчёт не меняет данные, но доступен только авторизованным.
    await requireSession();
    const { input, withScenarios } = RequestSchema.parse(await request.json());
    const typed = input as FinanceInput;

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
