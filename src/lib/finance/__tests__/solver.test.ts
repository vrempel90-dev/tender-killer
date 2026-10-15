import { describe, expect, it } from 'vitest';
import { netProfitAtPrice } from '../core';
import { solveBreakEvenPrice, solvePriceForNetProfit } from '../solver';
import { kzt, realisticTenderInput, simpleNonVatPayerInput, simpleVatPayerInput } from './fixtures';

describe('поиск безубыточной цены', () => {
  it('в найденной точке прибыль равна нулю с точностью до тиына', () => {
    const input = simpleVatPayerInput();
    const r = solveBreakEvenPrice(input);
    expect(r.solved).toBe(true);
    expect(r.priceMinor).not.toBeNull();
    const profit = netProfitAtPrice(input, r.priceMinor!);
    // прибыль в найденной точке неотрицательна и мала
    expect(profit).toBeGreaterThanOrEqual(0);
    expect(profit).toBeLessThan(100); // меньше 1 ₸
    // на один тиын ниже — уже убыток
    expect(netProfitAtPrice(input, r.priceMinor! - 1)).toBeLessThan(0);
  });

  it('безубыточная цена для простого случая равна закупке с НДС', () => {
    // закупка 696 000 ₸ с НДС; при цене 696 000 ₸ с НДС доход = 600 000,
    // затраты = 600 000, прибыль 0
    const r = solveBreakEvenPrice(simpleVatPayerInput());
    expect(r.priceMinor).toBeGreaterThanOrEqual(kzt(696_000) - 100);
    expect(r.priceMinor).toBeLessThanOrEqual(kzt(696_000) + 100);
  });

  it('на режиме с налогом с оборота безубыточная цена ВЫШЕ', () => {
    const general = solveBreakEvenPrice(simpleNonVatPayerInput('GENERAL_NO_VAT'));
    const simplified = solveBreakEvenPrice(simpleNonVatPayerInput('SIMPLIFIED'));
    expect(simplified.priceMinor!).toBeGreaterThan(general.priceMinor!);
  });

  it('работает на реалистичном тендере с обеспечениями и кредитом', () => {
    const input = realisticTenderInput();
    const r = solveBreakEvenPrice(input);
    expect(r.solved).toBe(true);
    expect(r.priceMinor!).toBeGreaterThan(0);
    expect(r.priceMinor!).toBeLessThan(input.tender.startPriceMinor!);
  });

  it('прибыль монотонно возрастает по цене', () => {
    const input = realisticTenderInput();
    let previous = Number.NEGATIVE_INFINITY;
    for (const price of [
      kzt(30_000_000),
      kzt(35_000_000),
      kzt(40_000_000),
      kzt(46_000_000),
      kzt(50_000_000),
    ]) {
      const p = netProfitAtPrice(input, price);
      expect(p).toBeGreaterThan(previous);
      previous = p;
    }
  });
});

describe('поиск цены под целевую прибыль', () => {
  it('находит цену, дающую заданную прибыль', () => {
    const input = simpleVatPayerInput();
    const target = kzt(500_000);
    const r = solvePriceForNetProfit(input, target);
    expect(r.solved).toBe(true);
    const profit = netProfitAtPrice(input, r.priceMinor!);
    expect(Math.abs(profit - target)).toBeLessThan(200); // до 2 ₸ погрешности
  });

  it('целевая цена выше безубыточной', () => {
    const input = simpleVatPayerInput();
    const be = solveBreakEvenPrice(input);
    const target = solvePriceForNetProfit(input, kzt(300_000));
    expect(target.priceMinor!).toBeGreaterThan(be.priceMinor!);
  });

  it('сообщает о недостижимости, а не возвращает выдуманное число', () => {
    // Патологический случай: налог с оборота больше 100 %. Тогда рост цены
    // уменьшает прибыль, и цель принципиально недостижима. Решатель обязан
    // вернуть null с пояснением, а не «подобрать» число.
    const base = simpleNonVatPayerInput('SIMPLIFIED');
    const input = {
      ...base,
      tax: { ...base.tax, incomeTaxRatePercent: 120 },
    };
    const r = solvePriceForNetProfit(input, kzt(1_000_000));
    expect(r.solved).toBe(false);
    expect(r.priceMinor).toBeNull();
    expect(r.note).toBeTruthy();
  });

  it('находит цену под большую цель, если она в принципе достижима', () => {
    const input = simpleNonVatPayerInput('SIMPLIFIED');
    const target = kzt(10_000_000);
    const r = solvePriceForNetProfit(input, target);
    expect(r.solved).toBe(true);
    // прибыль в найденной точке соответствует цели
    const profit = netProfitAtPrice(input, r.priceMinor!);
    expect(Math.abs(profit - target)).toBeLessThan(1000);
  });
});
