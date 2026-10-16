/**
 * Чувствительность прибыли к снижению цены и росту затрат.
 * Отвечает на вопрос «на сколько можно подвинуться в цене, не уйдя в минус».
 */

import { computeCore } from './core';
import { safeDiv, mulMinor } from '../money';
import type { FinanceInput, SensitivityResult, SensitivityRow } from './types';

const DEFAULT_PRICE_DROPS = [-1, -3, -5, -7, -10, -15, -20];
const DEFAULT_COST_INCREASES = [5, 10, 15, 20, 30];

export interface SensitivityOptions {
  priceDropPercents?: number[];
  costIncreasePercents?: number[];
  financingCostOverrideMinor?: number;
}

function row(
  input: FinanceInput,
  changePercent: number,
  priceMinor: number,
  costFactor: number,
  financingCostOverrideMinor?: number,
): SensitivityRow {
  const core = computeCore(input, {
    bidPriceOverrideMinor: priceMinor,
    costFactor,
    financingCostOverrideMinor,
  });
  return {
    changePercent,
    priceMinor,
    netProfitMinor: core.profit.netMinor,
    netMarginRatio: safeDiv(core.profit.netMinor, core.revenue.netMinor),
    isProfitable: core.profit.netMinor > 0,
  };
}

export function computeSensitivity(
  input: FinanceInput,
  options: SensitivityOptions = {},
): SensitivityResult {
  const basePrice = input.tender.bidPriceMinor;
  const priceDrops = options.priceDropPercents ?? DEFAULT_PRICE_DROPS;
  const costIncreases = options.costIncreasePercents ?? DEFAULT_COST_INCREASES;

  if (basePrice === null || basePrice <= 0) {
    return {
      priceDrop: [],
      costIncrease: [],
      priceDropToZeroRatio: null,
      costIncreaseToZeroRatio: null,
    };
  }

  const priceDrop = priceDrops.map((p) =>
    row(
      input,
      p,
      mulMinor(basePrice, 1 + p / 100),
      1,
      options.financingCostOverrideMinor,
    ),
  );

  const costIncrease = costIncreases.map((p) =>
    row(input, p, basePrice, 1 + p / 100, options.financingCostOverrideMinor),
  );

  return {
    priceDrop,
    costIncrease,
    priceDropToZeroRatio: findZeroPriceDrop(
      input,
      basePrice,
      options.financingCostOverrideMinor,
    ),
    costIncreaseToZeroRatio: findZeroCostIncrease(
      input,
      basePrice,
      options.financingCostOverrideMinor,
    ),
  };
}

/**
 * Какое снижение цены (доля от текущей) обнуляет прибыль.
 * Бисекция по доле снижения в диапазоне [0, 1].
 */
function findZeroPriceDrop(
  input: FinanceInput,
  basePrice: number,
  financingCostOverrideMinor?: number,
): number | null {
  const profitAt = (dropRatio: number) =>
    computeCore(input, {
      bidPriceOverrideMinor: mulMinor(basePrice, 1 - dropRatio),
      financingCostOverrideMinor,
    }).profit.netMinor;

  if (profitAt(0) <= 0) return 0;
  if (profitAt(1) > 0) return null; // прибыльно даже при нулевой цене — нет затрат

  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    if (profitAt(mid) > 0) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Какой рост затрат (доля) обнуляет прибыль. */
function findZeroCostIncrease(
  input: FinanceInput,
  basePrice: number,
  financingCostOverrideMinor?: number,
): number | null {
  const profitAt = (increaseRatio: number) =>
    computeCore(input, {
      bidPriceOverrideMinor: basePrice,
      costFactor: 1 + increaseRatio,
      financingCostOverrideMinor,
    }).profit.netMinor;

  if (profitAt(0) <= 0) return 0;

  let lo = 0;
  let hi = 1;
  let expand = 0;
  while (profitAt(hi) > 0 && expand < 20) {
    hi *= 2;
    expand += 1;
  }
  if (profitAt(hi) > 0) return null;

  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    if (profitAt(mid) > 0) lo = mid;
    else hi = mid;
  }
  return lo;
}
