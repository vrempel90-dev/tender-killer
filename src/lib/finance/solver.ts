/**
 * Поиск цены по заданной прибыли.
 *
 * Аналитически решить нельзя в общем виде: от цены зависят одновременно
 * выручка, банковская комиссия (% от поступлений), обеспечение исполнения
 * (% от суммы договора), гарантийный резерв и налог (при СНР — от оборота).
 * Поэтому используется численный метод на монотонной функции прибыли.
 *
 * Точность — 1 тиын, метод — бисекция с проверкой монотонности.
 */

import { netProfitAtPrice } from './core';
import type { FinanceInput } from './types';

export interface SolveOptions {
  costFactor?: number;
  financingCostOverrideMinor?: number;
  /** Максимальное число итераций (защита от зацикливания). */
  maxIterations?: number;
}

export interface SolveResult {
  priceMinor: number | null;
  solved: boolean;
  iterations: number;
  note?: string;
}

/**
 * Находит цену предложения (в той же трактовке НДС, что задана во входных
 * данных), при которой чистая прибыль равна `targetNetProfitMinor`.
 */
export function solvePriceForNetProfit(
  input: FinanceInput,
  targetNetProfitMinor: number,
  options: SolveOptions = {},
): SolveResult {
  const maxIterations = options.maxIterations ?? 200;
  const f = (price: number) => {
    try { return netProfitAtPrice(input, price, {
      costFactor: options.costFactor,
      financingCostOverrideMinor: options.financingCostOverrideMinor,
    }) - targetNetProfitMinor; }
    catch (error) { if (error instanceof RangeError) return Number.NEGATIVE_INFINITY; throw error; }
  };

  // Верхняя граница: грубая оценка «затраты × 4 + начальная цена × 4»,
  // но не меньше разумного минимума. Функция прибыли возрастает по цене,
  // поэтому достаточно расширять границу, пока f(hi) < 0.
  let lo = 0;
  let hi = Math.max(
    1_000_000, // 10 000 ₸
    (input.tender.startPriceMinor ?? 0) * 4,
    netProfitSeedUpperBound(input, options),
  );

  if (f(lo) >= 0) {
    // Прибыль достигается уже при нулевой цене — это бессмысленный вход
    // (нет затрат) либо целевая прибыль отрицательна.
    return {
      priceMinor: 0,
      solved: true,
      iterations: 0,
      note:
        'Целевая прибыль достигается при нулевой цене: проверьте, заполнены ли затраты.',
    };
  }

  let expand = 0;
  const priceLimit = Math.floor(Number.MAX_SAFE_INTEGER / 16);
  hi = Math.min(hi, priceLimit);
  while (f(hi) < 0 && expand < 60 && hi < priceLimit) {
    hi = Math.min(hi * 2, priceLimit);
    expand += 1;
  }
  if (f(hi) < 0) {
    return {
      priceMinor: null,
      solved: false,
      iterations: expand,
      note:
        'Целевая прибыль недостижима при любой разумной цене. Проверьте затраты и '
        + 'налоговый режим: при налоге с оборота рост цены увеличивает и налог.',
    };
  }

  let iterations = 0;
  while (hi - lo > 1 && iterations < maxIterations) {
    const mid = Math.floor((lo + hi) / 2);
    if (f(mid) < 0) {
      lo = mid;
    } else {
      hi = mid;
    }
    iterations += 1;
  }

  return { priceMinor: hi, solved: true, iterations };
}

/** Грубая верхняя оценка цены для старта бисекции. */
function netProfitSeedUpperBound(
  input: FinanceInput,
  options: SolveOptions,
): number {
  const costFactor = options.costFactor ?? 1;
  const items = input.costs.items.reduce(
    (s, i) => s + i.quantity * i.unitCostMinor,
    0,
  );
  const simple = [
    ...input.costs.otherDirect,
    ...input.costs.logistics,
    ...input.costs.subcontractors,
    ...input.costs.overhead,
  ].reduce((s, l) => s + l.amountMinor, 0);
  const rest =
    input.costs.payroll.grossPayrollMinor +
    input.costs.customs.dutyMinor +
    input.costs.customs.feesMinor +
    input.costs.customs.importVatMinor;
  return Math.round((items + simple + rest) * costFactor * 4);
}

/** Безубыточная цена: чистая прибыль = 0. */
export function solveBreakEvenPrice(
  input: FinanceInput,
  options: SolveOptions = {},
): SolveResult {
  return solvePriceForNetProfit(input, 0, options);
}
