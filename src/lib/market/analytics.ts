/**
 * Аналитика исторических закупок.
 *
 * ПРИНЦИПЫ:
 *  • статистика считается только по импортированным записям; количество
 *    записей всегда показывается рядом с выводом;
 *  • историческое снижение цены — это описание прошлого, а НЕ вероятность
 *    победы. Формулировок вида «шанс победы N %» в системе нет;
 *  • при малой выборке результат помечается как недостаточный для выводов.
 */

import { safeDiv } from '../money';

export interface MarketRecord {
  id: string;
  title: string;
  customerName: string | null;
  customerBin: string | null;
  region: string | null;
  startPriceMinor: number | null;
  finalPriceMinor: number | null;
  winnerName: string | null;
  winnerBin: string | null;
  participantsCount: number | null;
  awardedAt: Date | null;
  procurementType: string;
  sourceRef: string;
}

/** Выборка меньше этого размера не даёт оснований для выводов. */
export const MIN_SAMPLE_FOR_CONCLUSIONS = 5;

export interface DiscountStats {
  /** Сколько записей участвовало в расчёте. */
  sampleSize: number;
  /** Сколько записей отброшено из-за отсутствия цен. */
  excludedCount: number;
  /** Среднее снижение цены, доля (0.12 = 12 %). */
  averageDiscountRatio: number | null;
  /** Медианное снижение. */
  medianDiscountRatio: number | null;
  /** Минимальное и максимальное снижение. */
  minDiscountRatio: number | null;
  maxDiscountRatio: number | null;
  /** Достаточна ли выборка для осмысленных выводов. */
  sufficientSample: boolean;
  note: string;
}

/** Статистика снижения цены: (начальная − итоговая) / начальная. */
export function computeDiscountStats(records: MarketRecord[]): DiscountStats {
  const ratios: number[] = [];
  let excluded = 0;

  for (const record of records) {
    if (
      record.startPriceMinor === null ||
      record.finalPriceMinor === null ||
      record.startPriceMinor <= 0
    ) {
      excluded += 1;
      continue;
    }
    const ratio = safeDiv(
      record.startPriceMinor - record.finalPriceMinor,
      record.startPriceMinor,
    );
    if (ratio === null) {
      excluded += 1;
      continue;
    }
    ratios.push(ratio);
  }

  if (ratios.length === 0) {
    return {
      sampleSize: 0,
      excludedCount: excluded,
      averageDiscountRatio: null,
      medianDiscountRatio: null,
      minDiscountRatio: null,
      maxDiscountRatio: null,
      sufficientSample: false,
      note:
        excluded > 0
          ? `Ни в одной из ${excluded} записей нет пары «начальная цена — итоговая цена». `
            + 'Снижение цены рассчитать нельзя.'
          : 'Нет импортированных записей.',
    };
  }

  const sorted = [...ratios].sort((a, b) => a - b);
  const sum = ratios.reduce((acc, value) => acc + value, 0);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
      : (sorted[middle] ?? 0);

  const sufficient = ratios.length >= MIN_SAMPLE_FOR_CONCLUSIONS;

  return {
    sampleSize: ratios.length,
    excludedCount: excluded,
    averageDiscountRatio: sum / ratios.length,
    medianDiscountRatio: median,
    minDiscountRatio: sorted[0] ?? null,
    maxDiscountRatio: sorted[sorted.length - 1] ?? null,
    sufficientSample: sufficient,
    note:
      (sufficient
        ? `Расчёт по ${ratios.length} записям.`
        : `Выборка мала (${ratios.length} записей): для выводов нужно не менее `
          + `${MIN_SAMPLE_FOR_CONCLUSIONS}. Показанные значения описывают только `
          + 'эти записи.')
      // Сведения об исключённых записях нужны при любом размере выборки.
      + (excluded > 0
        ? ` Ещё ${excluded} записей без пары «начальная цена — итоговая цена» не учтены.`
        : ''),
  };
}

export interface WinnerStats {
  name: string;
  bin: string | null;
  winsCount: number;
  totalFinalPriceMinor: number;
  averageDiscountRatio: number | null;
  /** Закупки, где цены неизвестны, в сумму не входят. */
  recordsWithoutPrice: number;
}

/** Победители по количеству закупок. */
export function computeWinners(records: MarketRecord[]): WinnerStats[] {
  const map = new Map<string, WinnerStats & { discounts: number[] }>();

  for (const record of records) {
    const name = record.winnerName?.trim();
    if (!name) continue;
    const key = record.winnerBin ?? name.toLowerCase();

    let entry = map.get(key);
    if (!entry) {
      entry = {
        name,
        bin: record.winnerBin,
        winsCount: 0,
        totalFinalPriceMinor: 0,
        averageDiscountRatio: null,
        recordsWithoutPrice: 0,
        discounts: [],
      };
      map.set(key, entry);
    }

    entry.winsCount += 1;
    if (record.finalPriceMinor !== null) {
      entry.totalFinalPriceMinor += record.finalPriceMinor;
    } else {
      entry.recordsWithoutPrice += 1;
    }
    if (
      record.startPriceMinor !== null &&
      record.finalPriceMinor !== null &&
      record.startPriceMinor > 0
    ) {
      entry.discounts.push(
        (record.startPriceMinor - record.finalPriceMinor) / record.startPriceMinor,
      );
    }
  }

  return [...map.values()]
    .map(({ discounts, ...stats }) => ({
      ...stats,
      averageDiscountRatio:
        discounts.length > 0
          ? discounts.reduce((a, b) => a + b, 0) / discounts.length
          : null,
    }))
    .sort((a, b) => b.winsCount - a.winsCount || b.totalFinalPriceMinor - a.totalFinalPriceMinor);
}

export interface CustomerStats {
  name: string;
  bin: string | null;
  tendersCount: number;
  totalStartPriceMinor: number;
  averageDiscountRatio: number | null;
  averageParticipants: number | null;
}

/** Статистика по заказчикам. */
export function computeCustomers(records: MarketRecord[]): CustomerStats[] {
  const map = new Map<
    string,
    CustomerStats & { discounts: number[]; participants: number[] }
  >();

  for (const record of records) {
    const name = record.customerName?.trim();
    if (!name) continue;
    const key = record.customerBin ?? name.toLowerCase();

    let entry = map.get(key);
    if (!entry) {
      entry = {
        name,
        bin: record.customerBin,
        tendersCount: 0,
        totalStartPriceMinor: 0,
        averageDiscountRatio: null,
        averageParticipants: null,
        discounts: [],
        participants: [],
      };
      map.set(key, entry);
    }

    entry.tendersCount += 1;
    if (record.startPriceMinor !== null) {
      entry.totalStartPriceMinor += record.startPriceMinor;
    }
    if (
      record.startPriceMinor !== null &&
      record.finalPriceMinor !== null &&
      record.startPriceMinor > 0
    ) {
      entry.discounts.push(
        (record.startPriceMinor - record.finalPriceMinor) / record.startPriceMinor,
      );
    }
    if (record.participantsCount !== null) {
      entry.participants.push(record.participantsCount);
    }
  }

  return [...map.values()]
    .map(({ discounts, participants, ...stats }) => ({
      ...stats,
      averageDiscountRatio:
        discounts.length > 0
          ? discounts.reduce((a, b) => a + b, 0) / discounts.length
          : null,
      averageParticipants:
        participants.length > 0
          ? participants.reduce((a, b) => a + b, 0) / participants.length
          : null,
    }))
    .sort((a, b) => b.tendersCount - a.tendersCount);
}

export interface PriceModelingInput {
  /** Начальная цена рассматриваемой закупки, тиын. */
  startPriceMinor: number;
  /** Собственная безубыточная цена из финансового расчёта, тиын. */
  breakEvenPriceMinor: number | null;
  /** Историческая статистика снижения. */
  discountStats: DiscountStats;
}

export interface PriceScenario {
  label: string;
  /** Снижение от начальной цены, доля. */
  discountRatio: number;
  priceMinor: number;
  /** Выше ли цена собственной безубыточной. */
  aboveBreakEven: boolean | null;
  /** Запас над безубыточной ценой, доля. */
  marginOverBreakEvenRatio: number | null;
  basis: string;
}

export interface PriceModelingResult {
  scenarios: PriceScenario[];
  /** Максимально допустимое снижение по собственной экономике. */
  maxAffordableDiscountRatio: number | null;
  warnings: string[];
}

/**
 * Моделирование допустимых ценовых предложений.
 *
 * Сопоставляет историческое снижение цены с собственной безубыточной ценой.
 * НЕ оценивает вероятность победы: исторические данные говорят о том, как
 * закупки завершались раньше, а не о том, чем закончится эта.
 */
export function modelPriceOptions(
  input: PriceModelingInput,
): PriceModelingResult {
  const warnings: string[] = [];
  const scenarios: PriceScenario[] = [];
  const { startPriceMinor, breakEvenPriceMinor, discountStats } = input;

  const maxAffordableDiscountRatio =
    breakEvenPriceMinor !== null && startPriceMinor > 0
      ? Math.max(0, (startPriceMinor - breakEvenPriceMinor) / startPriceMinor)
      : null;

  const candidates: Array<{ label: string; ratio: number | null; basis: string }> = [
    {
      label: 'Без снижения',
      ratio: 0,
      basis: 'начальная цена закупки',
    },
    {
      label: 'Медианное историческое снижение',
      ratio: discountStats.medianDiscountRatio,
      basis: `медиана по ${discountStats.sampleSize} импортированным записям`,
    },
    {
      label: 'Среднее историческое снижение',
      ratio: discountStats.averageDiscountRatio,
      basis: `среднее по ${discountStats.sampleSize} импортированным записям`,
    },
    {
      label: 'Максимальное историческое снижение',
      ratio: discountStats.maxDiscountRatio,
      basis: `наибольшее снижение среди ${discountStats.sampleSize} записей`,
    },
    {
      label: 'Предел вашей экономики',
      ratio: maxAffordableDiscountRatio,
      basis: 'безубыточная цена из вашего финансового расчёта',
    },
  ];

  for (const candidate of candidates) {
    if (candidate.ratio === null) continue;
    const ratio = Math.min(Math.max(candidate.ratio, 0), 1);
    const priceMinor = Math.round(startPriceMinor * (1 - ratio));
    const aboveBreakEven =
      breakEvenPriceMinor === null ? null : priceMinor >= breakEvenPriceMinor;
    scenarios.push({
      label: candidate.label,
      discountRatio: ratio,
      priceMinor,
      aboveBreakEven,
      marginOverBreakEvenRatio:
        breakEvenPriceMinor === null || priceMinor <= 0
          ? null
          : (priceMinor - breakEvenPriceMinor) / priceMinor,
      basis: candidate.basis,
    });
  }

  if (breakEvenPriceMinor === null) {
    warnings.push(
      'Безубыточная цена неизвестна: сохраните финансовый расчёт по тендеру, '
      + 'чтобы сопоставить историческое снижение с собственной экономикой.',
    );
  } else if (
    discountStats.medianDiscountRatio !== null &&
    maxAffordableDiscountRatio !== null &&
    discountStats.medianDiscountRatio > maxAffordableDiscountRatio
  ) {
    warnings.push(
      'Историческое снижение цены по этим закупкам превышает предел вашей '
      + 'экономики: при таком снижении сделка становится убыточной.',
    );
  }

  if (!discountStats.sufficientSample && discountStats.sampleSize > 0) {
    warnings.push(discountStats.note);
  }

  warnings.push(
    'Историческая статистика описывает завершённые закупки и НЕ является '
    + 'оценкой вероятности победы в текущей закупке.',
  );

  return { scenarios, maxAffordableDiscountRatio, warnings };
}
