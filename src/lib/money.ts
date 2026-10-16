/**
 * Деньги в проекте хранятся и считаются в МИНОРНЫХ единицах (тиын),
 * чтобы исключить ошибки округления double при сложении сотен позиций.
 *
 * 1 тенге = 100 тиын. Все финансовые вычисления движка работают с числами
 * тиын (целые). Number безопасно держит целые до 2^53-1 ≈ 9.007e15 тиын
 * ≈ 90 трлн тенге, чего с огромным запасом хватает для тендеров.
 */

import Decimal from 'decimal.js';

export const MoneyDecimal = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export const MINOR_UNITS_PER_MAJOR = 100;

export function checkedMinor(value: Decimal.Value): number {
  const rounded = new MoneyDecimal(value).toDecimalPlaces(0);
  if (!rounded.isFinite() || rounded.abs().greaterThan(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('Money is not a safe integer');
  }
  return rounded.toNumber();
}

export function ratioMinor(minor: number, numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(minor) || !Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    throw new RangeError('Invalid monetary ratio');
  }
  return checkedMinor(new MoneyDecimal(minor).times(numerator).div(denominator));
}

export function interestMinor(minor: number, annualPercent: number, days: number): number {
  return checkedMinor(new MoneyDecimal(minor).times(annualPercent).times(days).div(100).div(365));
}

export function assertMinorFields(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (key.endsWith('Minor') && typeof item === 'number' && !Number.isSafeInteger(item)) {
      throw new RangeError('Monetary result exceeds safe integer range');
    }
    if (typeof item === 'object') assertMinorFields(item);
  }
}

/** Тенге → тиын. Округление до целого тиына. */
export function toMinor(major: number): number {
  if (!Number.isFinite(major)) throw new RangeError('Invalid monetary amount');
  return checkedMinor(new MoneyDecimal(major).times(MINOR_UNITS_PER_MAJOR));
}

/** Тиын → тенге (может быть нецелым). */
export function toMajor(minor: number): number {
  return minor / MINOR_UNITS_PER_MAJOR;
}

/**
 * Умножение денежной суммы на коэффициент с округлением до тиына.
 * Используется для ставок, процентов, долей.
 */
export function mulMinor(minor: number, factor: number): number {
  if (!Number.isSafeInteger(minor) || !Number.isFinite(factor)) throw new RangeError('Invalid monetary factor');
  return checkedMinor(new MoneyDecimal(minor).times(factor));
}

/** Процент от суммы: percentOf(1_000_000, 12) === 120_000 */
export function percentOf(minor: number, percent: number): number {
  return ratioMinor(minor, percent, 100);
}

/** Безопасное деление: при нулевом знаменателе возвращает null, а не Infinity. */
export function safeDiv(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (denominator === 0) return null;
  return numerator / denominator;
}

/** Форматирование тиын в читаемую строку тенге: 120050000 → «1 200 500 ₸» */
export function formatMinorKzt(
  minor: number | null | undefined,
  options: { withDecimals?: boolean; withSymbol?: boolean } = {},
): string {
  if (minor === null || minor === undefined || !Number.isFinite(minor)) {
    return '—';
  }
  const { withDecimals = false, withSymbol = true } = options;
  const major = toMajor(minor);
  const formatted = new Intl.NumberFormat('ru-KZ', {
    minimumFractionDigits: withDecimals ? 2 : 0,
    maximumFractionDigits: withDecimals ? 2 : 0,
  }).format(major);
  return withSymbol ? `${formatted} ₸` : formatted;
}

/** Форматирование процента: 0.1234 (доля) → «12,3 %» */
export function formatRatioAsPercent(
  ratio: number | null | undefined,
  fractionDigits = 1,
): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return '—';
  return `${new Intl.NumberFormat('ru-KZ', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(ratio * 100)} %`;
}

/** Форматирование числа процентов: 12.5 → «12,5 %» */
export function formatPercent(
  percent: number | null | undefined,
  fractionDigits = 1,
): string {
  if (percent === null || percent === undefined || !Number.isFinite(percent)) {
    return '—';
  }
  return `${new Intl.NumberFormat('ru-KZ', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(percent)} %`;
}
