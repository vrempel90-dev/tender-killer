/**
 * Сравнение коммерческих предложений поставщиков и расчёт полной
 * закупочной себестоимости позиции.
 *
 * Правило: непроверенные позиции (без документа-основания) обозначаются явно.
 * Выдуманных поставщиков, цен и остатков в системе нет.
 */

import { mulMinor, ratioMinor } from '../money';

export type SpecMatch = 'MATCH' | 'PARTIAL' | 'MISMATCH' | 'UNKNOWN';

export interface QuoteOption {
  quoteItemId: string;
  quoteId: string;
  supplierName: string;
  /** Подтверждено документом поставщика. */
  verified: boolean;
  /** Цена за единицу в валюте предложения, минорные единицы. */
  unitPriceMinor: number;
  currency: string;
  /** Курс к тенге, если валюта не KZT. */
  fxRate: number | null;
  /** Включает ли цена НДС. */
  pricesIncludeVat: boolean;
  quantity: number;
  specMatch: SpecMatch;
  specMatchNote: string | null;
  leadTimeDays: number | null;
  validUntil: Date | null;
}

export interface LogisticsTariff {
  /** Доставка за единицу, тиын. */
  perUnitMinor: number;
  /** Доставка за всю партию, тиын. */
  flatMinor: number;
  /** Доля таможенных платежей от стоимости, % (при импорте). */
  customsPercent: number;
}

export interface QuoteEvaluation extends QuoteOption {
  /** Цена за единицу, приведённая к тенге. */
  unitPriceKztMinor: number | null;
  /** Стоимость партии в тенге. */
  totalKztMinor: number | null;
  /** Логистика, отнесённая на позицию. */
  logisticsMinor: number;
  /** Полная закупочная себестоимость позиции с логистикой и таможней. */
  landedCostMinor: number | null;
  /** Полная себестоимость за единицу. */
  landedUnitCostMinor: number | null;
  /** Причины, по которым предложение нельзя считать подтверждённым. */
  issues: string[];
  /** Предложение просрочено. */
  expired: boolean;
}

/**
 * Расчёт полной закупочной себестоимости по предложению.
 * Если валюта не KZT и курс не задан, сумма не рассчитывается —
 * курс не подставляется «по рынку».
 */
export function evaluateQuote(
  option: QuoteOption,
  logistics: LogisticsTariff,
  now: Date = new Date(),
): QuoteEvaluation {
  const issues: string[] = [];

  let unitPriceKztMinor: number | null;
  if (option.currency === 'KZT') {
    unitPriceKztMinor = option.unitPriceMinor;
  } else if (option.fxRate !== null && option.fxRate > 0) {
    unitPriceKztMinor = mulMinor(option.unitPriceMinor, option.fxRate);
  } else {
    unitPriceKztMinor = null;
    issues.push(
      `Цена указана в ${option.currency}, курс к тенге не задан — `
      + 'себестоимость не рассчитана.',
    );
  }

  if (!option.verified) {
    issues.push('Цена не подтверждена документом поставщика.');
  }
  if (option.specMatch === 'MISMATCH') {
    issues.push('Товар не соответствует техническим требованиям.');
  }
  if (option.specMatch === 'PARTIAL') {
    issues.push('Товар соответствует требованиям частично.');
  }
  if (option.specMatch === 'UNKNOWN') {
    issues.push('Соответствие техническим требованиям не проверено.');
  }

  const expired =
    option.validUntil !== null && option.validUntil.getTime() < now.getTime();
  if (expired) {
    issues.push('Срок действия предложения истёк.');
  }

  const totalKztMinor =
    unitPriceKztMinor === null
      ? null
      : mulMinor(unitPriceKztMinor, option.quantity);

  const logisticsMinor =
    mulMinor(logistics.perUnitMinor, option.quantity) + logistics.flatMinor;

  const customsMinor =
    totalKztMinor === null
      ? 0
      : mulMinor(totalKztMinor, logistics.customsPercent / 100);

  const landedCostMinor =
    totalKztMinor === null ? null : totalKztMinor + logisticsMinor + customsMinor;

  return {
    ...option,
    unitPriceKztMinor,
    totalKztMinor,
    logisticsMinor,
    landedCostMinor,
    landedUnitCostMinor:
      landedCostMinor === null || option.quantity <= 0
        ? null
        : ratioMinor(landedCostMinor, 1, option.quantity),
    issues,
    expired,
  };
}

export interface ComparisonResult {
  options: QuoteEvaluation[];
  /** Лучшее предложение: минимальная полная себестоимость при соответствии. */
  bestOptionId: string | null;
  /** Почему выбор не сделан автоматически. */
  selectionNote: string | null;
}

/**
 * Сравнение предложений по одной позиции.
 *
 * Автоматически выбирается только предложение, которое подтверждено
 * документом, соответствует требованиям и не просрочено. Иначе выбор
 * оставляется человеку с объяснением причины.
 */
export function compareQuotes(
  options: QuoteOption[],
  logistics: LogisticsTariff,
  now: Date = new Date(),
): ComparisonResult {
  const evaluated = options
    .map((option) => evaluateQuote(option, logistics, now))
    .sort((a, b) => {
      if (a.landedCostMinor === null) return 1;
      if (b.landedCostMinor === null) return -1;
      return a.landedCostMinor - b.landedCostMinor;
    });

  const acceptable = evaluated.filter(
    (e) =>
      e.landedCostMinor !== null &&
      e.verified &&
      e.specMatch === 'MATCH' &&
      !e.expired,
  );

  if (acceptable.length > 0) {
    return {
      options: evaluated,
      bestOptionId: acceptable[0]!.quoteItemId,
      selectionNote: null,
    };
  }

  if (evaluated.length === 0) {
    return {
      options: evaluated,
      bestOptionId: null,
      selectionNote: 'Предложений поставщиков нет.',
    };
  }

  const cheapest = evaluated.find((e) => e.landedCostMinor !== null);
  return {
    options: evaluated,
    bestOptionId: null,
    selectionNote:
      'Ни одно предложение не является полностью подтверждённым и '
      + 'соответствующим требованиям — выберите вариант вручную.'
      + (cheapest
        ? ` Минимальная цена у «${cheapest.supplierName}», но: ${cheapest.issues.join(' ')}`
        : ''),
  };
}
