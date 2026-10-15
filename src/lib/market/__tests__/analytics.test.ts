import { describe, expect, it } from 'vitest';
import {
  computeCustomers,
  computeDiscountStats,
  computeWinners,
  MIN_SAMPLE_FOR_CONCLUSIONS,
  modelPriceOptions,
  type MarketRecord,
} from '../analytics';

const kzt = (major: number) => Math.round(major * 100);

function record(overrides: Partial<MarketRecord> = {}): MarketRecord {
  return {
    id: Math.random().toString(36).slice(2),
    title: 'Закупка',
    customerName: 'ГУ Заказчик',
    customerBin: '123456789012',
    region: 'г. Алматы',
    startPriceMinor: kzt(10_000_000),
    finalPriceMinor: kzt(9_000_000),
    winnerName: 'ТОО Поставщик',
    winnerBin: '987654321098',
    participantsCount: 3,
    awardedAt: new Date('2026-03-15'),
    procurementType: 'OPEN_TENDER',
    sourceRef: 'выгрузка.csv',
    ...overrides,
  };
}

describe('статистика снижения цены', () => {
  it('считает среднее, медиану, минимум и максимум', () => {
    const stats = computeDiscountStats([
      record({ startPriceMinor: kzt(100), finalPriceMinor: kzt(90) }), // 10 %
      record({ startPriceMinor: kzt(100), finalPriceMinor: kzt(80) }), // 20 %
      record({ startPriceMinor: kzt(100), finalPriceMinor: kzt(70) }), // 30 %
    ]);
    expect(stats.sampleSize).toBe(3);
    expect(stats.averageDiscountRatio).toBeCloseTo(0.2, 10);
    expect(stats.medianDiscountRatio).toBeCloseTo(0.2, 10);
    expect(stats.minDiscountRatio).toBeCloseTo(0.1, 10);
    expect(stats.maxDiscountRatio).toBeCloseTo(0.3, 10);
  });

  it('ИСКЛЮЧАЕТ записи без пары цен и сообщает об этом', () => {
    const stats = computeDiscountStats([
      record({ startPriceMinor: kzt(100), finalPriceMinor: kzt(90) }),
      record({ finalPriceMinor: null }),
      record({ startPriceMinor: null }),
    ]);
    expect(stats.sampleSize).toBe(1);
    expect(stats.excludedCount).toBe(2);
    expect(stats.note).toContain('не учтены');
  });

  it('помечает малую выборку как недостаточную для выводов', () => {
    const stats = computeDiscountStats([record(), record()]);
    expect(stats.sufficientSample).toBe(false);
    expect(stats.note).toContain('Выборка мала');
    expect(stats.note).toContain(String(MIN_SAMPLE_FOR_CONCLUSIONS));
  });

  it('считает выборку достаточной от порога', () => {
    const stats = computeDiscountStats(
      Array.from({ length: MIN_SAMPLE_FOR_CONCLUSIONS }, () => record()),
    );
    expect(stats.sufficientSample).toBe(true);
  });

  it('при отсутствии данных не выдумывает числа', () => {
    const stats = computeDiscountStats([]);
    expect(stats.averageDiscountRatio).toBeNull();
    expect(stats.medianDiscountRatio).toBeNull();
    expect(stats.sufficientSample).toBe(false);
  });

  it('корректно считает медиану для чётного числа записей', () => {
    const stats = computeDiscountStats([
      record({ startPriceMinor: kzt(100), finalPriceMinor: kzt(90) }), // 10 %
      record({ startPriceMinor: kzt(100), finalPriceMinor: kzt(70) }), // 30 %
    ]);
    expect(stats.medianDiscountRatio).toBeCloseTo(0.2, 10);
  });
});

describe('анализ победителей', () => {
  it('группирует по БИН и считает победы и суммы', () => {
    const winners = computeWinners([
      record({ winnerName: 'ТОО Альфа', winnerBin: '111111111111', finalPriceMinor: kzt(1_000) }),
      record({ winnerName: 'ТОО Альфа', winnerBin: '111111111111', finalPriceMinor: kzt(2_000) }),
      record({ winnerName: 'ТОО Бета', winnerBin: '222222222222', finalPriceMinor: kzt(5_000) }),
    ]);
    expect(winners[0]!.name).toBe('ТОО Альфа');
    expect(winners[0]!.winsCount).toBe(2);
    expect(winners[0]!.totalFinalPriceMinor).toBe(kzt(3_000));
    expect(winners[1]!.winsCount).toBe(1);
  });

  it('не учитывает в сумме записи без итоговой цены и сообщает их число', () => {
    const winners = computeWinners([
      record({ winnerBin: '111111111111', finalPriceMinor: kzt(1_000) }),
      record({ winnerBin: '111111111111', finalPriceMinor: null }),
    ]);
    expect(winners[0]!.totalFinalPriceMinor).toBe(kzt(1_000));
    expect(winners[0]!.recordsWithoutPrice).toBe(1);
  });

  it('пропускает записи без победителя', () => {
    expect(computeWinners([record({ winnerName: null })])).toHaveLength(0);
  });
});

describe('анализ заказчиков', () => {
  it('считает закупки, суммы и среднее число участников', () => {
    const customers = computeCustomers([
      record({ customerBin: '555', startPriceMinor: kzt(1_000), participantsCount: 2 }),
      record({ customerBin: '555', startPriceMinor: kzt(3_000), participantsCount: 4 }),
    ]);
    expect(customers[0]!.tendersCount).toBe(2);
    expect(customers[0]!.totalStartPriceMinor).toBe(kzt(4_000));
    expect(customers[0]!.averageParticipants).toBe(3);
  });

  it('не выдумывает среднее число участников, если его нет', () => {
    const customers = computeCustomers([record({ participantsCount: null })]);
    expect(customers[0]!.averageParticipants).toBeNull();
  });
});

describe('моделирование ценовых предложений', () => {
  const stats = computeDiscountStats([
    record({ startPriceMinor: kzt(100), finalPriceMinor: kzt(92) }),
    record({ startPriceMinor: kzt(100), finalPriceMinor: kzt(90) }),
    record({ startPriceMinor: kzt(100), finalPriceMinor: kzt(88) }),
    record({ startPriceMinor: kzt(100), finalPriceMinor: kzt(85) }),
    record({ startPriceMinor: kzt(100), finalPriceMinor: kzt(80) }),
  ]);

  it('строит сценарии от начальной цены и показывает основание каждого', () => {
    const result = modelPriceOptions({
      startPriceMinor: kzt(50_000_000),
      breakEvenPriceMinor: kzt(40_000_000),
      discountStats: stats,
    });
    const labels = result.scenarios.map((s) => s.label);
    expect(labels).toContain('Без снижения');
    expect(labels).toContain('Медианное историческое снижение');
    expect(labels).toContain('Предел вашей экономики');
    for (const scenario of result.scenarios) {
      expect(scenario.basis.length).toBeGreaterThan(5);
    }
  });

  it('считает предел снижения по собственной безубыточной цене', () => {
    const result = modelPriceOptions({
      startPriceMinor: kzt(50_000_000),
      breakEvenPriceMinor: kzt(40_000_000),
      discountStats: stats,
    });
    // (50 − 40) / 50 = 20 %
    expect(result.maxAffordableDiscountRatio).toBeCloseTo(0.2, 10);
    const limit = result.scenarios.find((s) => s.label === 'Предел вашей экономики');
    expect(limit?.priceMinor).toBe(kzt(40_000_000));
  });

  it('отмечает, какие сценарии выше безубыточной цены', () => {
    const result = modelPriceOptions({
      startPriceMinor: kzt(100),
      breakEvenPriceMinor: kzt(90),
      discountStats: stats,
    });
    const median = result.scenarios.find(
      (s) => s.label === 'Медианное историческое снижение',
    );
    // медиана снижения 12 % → цена 88 < 90 → убыток
    expect(median?.aboveBreakEven).toBe(false);
  });

  it('предупреждает, если историческое снижение превышает предел экономики', () => {
    const result = modelPriceOptions({
      startPriceMinor: kzt(100),
      breakEvenPriceMinor: kzt(95),
      discountStats: stats,
    });
    expect(result.warnings.join(' ')).toContain('превышает предел вашей экономики');
  });

  it('требует финансовый расчёт, если безубыточная цена неизвестна', () => {
    const result = modelPriceOptions({
      startPriceMinor: kzt(100),
      breakEvenPriceMinor: null,
      discountStats: stats,
    });
    expect(result.maxAffordableDiscountRatio).toBeNull();
    expect(result.warnings.join(' ')).toContain('сохраните финансовый расчёт');
  });

  it('ВСЕГДА предупреждает, что это не вероятность победы', () => {
    const result = modelPriceOptions({
      startPriceMinor: kzt(100),
      breakEvenPriceMinor: kzt(90),
      discountStats: stats,
    });
    expect(result.warnings.join(' ')).toContain('НЕ является');
    expect(result.warnings.join(' ')).toContain('вероятности победы');
  });
});
