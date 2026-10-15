import { describe, expect, it } from 'vitest';
import {
  formatMinorKzt,
  formatPercent,
  formatRatioAsPercent,
  mulMinor,
  percentOf,
  safeDiv,
  toMajor,
  toMinor,
} from '../../money';

describe('денежные операции', () => {
  it('переводит тенге в тиын и обратно без потерь', () => {
    expect(toMinor(1_200_000)).toBe(120_000_000);
    expect(toMajor(120_000_000)).toBe(1_200_000);
  });

  it('округляет дробные тиыны до целого', () => {
    expect(toMinor(0.015)).toBe(2); // 1,5 тиын → 2
    expect(toMinor(0.014)).toBe(1);
  });

  it('не создаёт накопленной ошибки при сложении многих позиций', () => {
    // 1000 позиций по 1234,56 ₸ — в тиын сумма точная
    const line = toMinor(1234.56);
    let total = 0;
    for (let i = 0; i < 1000; i += 1) total += line;
    expect(total).toBe(123_456_000);
    expect(toMajor(total)).toBe(1_234_560);
  });

  it('считает процент от суммы', () => {
    expect(percentOf(100_000_000, 16)).toBe(16_000_000);
    expect(percentOf(100_000_000, 0)).toBe(0);
    expect(percentOf(0, 16)).toBe(0);
  });

  it('умножает на коэффициент с округлением', () => {
    expect(mulMinor(333, 1 / 3)).toBe(111);
    expect(mulMinor(100, 0.005)).toBe(1); // 0,5 → 1
  });

  it('safeDiv возвращает null при делении на ноль, а не Infinity', () => {
    expect(safeDiv(10, 0)).toBeNull();
    expect(safeDiv(10, 2)).toBe(5);
    expect(safeDiv(Number.NaN, 2)).toBeNull();
  });

  it('пустые значения форматируются как прочерк, а не как 0', () => {
    expect(formatMinorKzt(null)).toBe('—');
    expect(formatMinorKzt(undefined)).toBe('—');
    expect(formatRatioAsPercent(null)).toBe('—');
    expect(formatPercent(null)).toBe('—');
    // а настоящий ноль — это ноль
    expect(formatMinorKzt(0)).toContain('0');
  });
});
