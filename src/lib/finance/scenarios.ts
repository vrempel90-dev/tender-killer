/**
 * Сценарии расчёта: оптимистичный, базовый, стрессовый.
 * Параметры сценариев конфигурируемы и показываются пользователю —
 * «стресс» не должен быть чёрным ящиком.
 */

import { mulMinor } from '../money';
import { calculateFinance } from './engine';
import type {
  FinanceInput,
  ScenarioAdjustment,
  ScenarioCode,
  ScenarioResult,
} from './types';

export const DEFAULT_SCENARIOS: Record<ScenarioCode, ScenarioAdjustment> = {
  OPTIMISTIC: {
    code: 'OPTIMISTIC',
    label: 'Оптимистичный',
    description:
      'Затраты на 5 % ниже плановых, оплата приходит в срок, цена предложения не меняется.',
    priceFactor: 1,
    costFactor: 0.95,
    paymentDelayAddDays: 0,
    contingencyFactor: 0.5,
  },
  BASE: {
    code: 'BASE',
    label: 'Базовый',
    description: 'Расчёт по введённым данным без корректировок.',
    priceFactor: 1,
    costFactor: 1,
    paymentDelayAddDays: 0,
    contingencyFactor: 1,
  },
  STRESS: {
    code: 'STRESS',
    label: 'Стрессовый',
    description:
      'Цена снижена на 5 % в ходе торгов, затраты выросли на 12 %, оплата задержана '
      + 'на 30 дней дополнительно.',
    priceFactor: 0.95,
    costFactor: 1.12,
    paymentDelayAddDays: 30,
    contingencyFactor: 1.5,
  },
};

function applyAdjustment(
  input: FinanceInput,
  adj: ScenarioAdjustment,
): FinanceInput {
  return {
    ...input,
    tender: {
      ...input.tender,
      bidPriceMinor:
        input.tender.bidPriceMinor === null
          ? null
          : mulMinor(input.tender.bidPriceMinor, adj.priceFactor),
    },
    costs: {
      ...input.costs,
      contingencyPercent: input.costs.contingencyPercent * adj.contingencyFactor,
    },
    schedule: {
      ...input.schedule,
      paymentDelayDays:
        input.schedule.paymentDelayDays === null
          ? null
          : input.schedule.paymentDelayDays + adj.paymentDelayAddDays,
    },
  };
}

export function calculateScenario(
  input: FinanceInput,
  code: ScenarioCode,
  adjustments: Record<ScenarioCode, ScenarioAdjustment> = DEFAULT_SCENARIOS,
): ScenarioResult {
  const adj = adjustments[code];
  const adjusted = applyAdjustment(input, adj);
  const result = calculateFinance(adjusted, {
    costFactor: adj.costFactor,
  });
  return {
    code,
    label: adj.label,
    description: adj.description,
    adjustment: adj,
    result,
  };
}

export function calculateAllScenarios(
  input: FinanceInput,
  adjustments: Record<ScenarioCode, ScenarioAdjustment> = DEFAULT_SCENARIOS,
): ScenarioResult[] {
  return (['OPTIMISTIC', 'BASE', 'STRESS'] as ScenarioCode[]).map((code) =>
    calculateScenario(input, code, adjustments),
  );
}
