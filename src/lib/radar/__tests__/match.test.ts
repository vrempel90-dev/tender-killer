import { describe, expect, it } from 'vitest';
import {
  matchOpportunity,
  scoreLabel,
  type MatchCandidate,
  type MatchProfile,
} from '../match';

const NOW = new Date('2026-10-15T00:00:00Z');
const inDays = (days: number) => new Date(NOW.getTime() + days * 86_400_000);

const profile: MatchProfile = {
  keywords: ['кабель', 'электромонтаж'],
  excludedKeywords: ['медицинское оборудование'],
  regions: ['Алматы'],
  procurementTypes: ['OPEN_TENDER', 'REQUEST_FOR_QUOTATIONS'],
  minPriceMinor: 500_000_00,
  maxPriceMinor: 50_000_000_00,
  minDeliveryDays: 14,
  excludedCustomerBins: ['111111111111'],
  preferredCustomerBins: ['222222222222'],
  minDaysToDeadline: 3,
};

const candidate: MatchCandidate = {
  title: 'Поставка кабеля силового для нужд управления',
  customerBin: '333333333333',
  priceMinor: 5_000_000_00,
  procurementType: 'OPEN_TENDER',
  region: 'г. Алматы',
  deadline: inDays(10),
  deliveryDeadline: inDays(45),
};

describe('подходящая закупка', () => {
  it('набирает высокую оценку и не имеет препятствий', () => {
    const result = matchOpportunity(profile, candidate, NOW);
    expect(result.suitable).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(result.matchedKeywords).toEqual(['кабель']);
  });

  it('каждое слагаемое оценки объяснено', () => {
    const result = matchOpportunity(profile, candidate, NOW);
    const sum = result.reasons.reduce((total, r) => total + r.weight, 0);
    expect(sum).toBe(result.score);
    for (const reason of result.reasons) {
      expect(reason.detail.length).toBeGreaterThan(0);
    }
  });

  it('оценка не превышает 100 даже при всех совпадениях', () => {
    const result = matchOpportunity(
      profile,
      {
        ...candidate,
        title: 'Электромонтаж и поставка кабеля',
        customerBin: '222222222222',
      },
      NOW,
    );
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.matchedKeywords).toHaveLength(2);
  });

  it('знакомый заказчик добавляет вклад', () => {
    const neutral = matchOpportunity(profile, candidate, NOW);
    const known = matchOpportunity(
      profile,
      { ...candidate, customerBin: '222222222222' },
      NOW,
    );
    expect(known.score).toBeGreaterThan(neutral.score);
    expect(known.reasons.some((r) => r.code === 'PREFERRED_CUSTOMER')).toBe(true);
  });
});

describe('препятствия исключают закупку, а не понижают оценку', () => {
  it('исключённое слово в наименовании', () => {
    const result = matchOpportunity(
      profile,
      { ...candidate, title: 'Поставка медицинское оборудование и кабеля' },
      NOW,
    );
    expect(result.suitable).toBe(false);
    expect(result.blockers.map((b) => b.code)).toContain('EXCLUDED_KEYWORD');
  });

  it('исключённый заказчик', () => {
    const result = matchOpportunity(
      profile,
      { ...candidate, customerBin: '111111111111' },
      NOW,
    );
    expect(result.blockers.map((b) => b.code)).toContain('EXCLUDED_CUSTOMER');
  });

  it('сумма ниже минимальной и выше максимальной', () => {
    expect(
      matchOpportunity(profile, { ...candidate, priceMinor: 100_00 }, NOW)
        .blockers.map((b) => b.code),
    ).toContain('PRICE_BELOW_MIN');
    expect(
      matchOpportunity(profile, { ...candidate, priceMinor: 90_000_000_00 }, NOW)
        .blockers.map((b) => b.code),
    ).toContain('PRICE_ABOVE_MAX');
  });

  it('недопустимый способ закупки', () => {
    const result = matchOpportunity(
      profile,
      { ...candidate, procurementType: 'SINGLE_SOURCE' },
      NOW,
    );
    expect(result.blockers.map((b) => b.code)).toContain('TYPE_NOT_ALLOWED');
  });

  it('ГЛАВНОЕ: истёкший срок приёма заявок', () => {
    const result = matchOpportunity(
      profile,
      { ...candidate, deadline: inDays(-1) },
      NOW,
    );
    expect(result.suitable).toBe(false);
    expect(result.blockers.map((b) => b.code)).toContain('DEADLINE_PASSED');
  });

  it('срок приёма короче, чем нужно компании на подготовку', () => {
    const result = matchOpportunity(
      profile,
      { ...candidate, deadline: inDays(1) },
      NOW,
    );
    expect(result.blockers.map((b) => b.code)).toContain('DEADLINE_TOO_SOON');
  });

  it('срок поставки короче допустимого', () => {
    const result = matchOpportunity(
      profile,
      { ...candidate, deliveryDeadline: inDays(5) },
      NOW,
    );
    expect(result.blockers.map((b) => b.code)).toContain('DELIVERY_TOO_SHORT');
  });

  it('несколько препятствий перечисляются все', () => {
    const result = matchOpportunity(
      profile,
      {
        ...candidate,
        customerBin: '111111111111',
        priceMinor: 100_00,
        procurementType: 'AUCTION',
      },
      NOW,
    );
    expect(result.blockers.length).toBeGreaterThanOrEqual(3);
  });
});

describe('неполные данные выгрузки', () => {
  it('отсутствие суммы не блокирует, но отмечается', () => {
    const result = matchOpportunity(profile, { ...candidate, priceMinor: null }, NOW);
    expect(result.suitable).toBe(true);
    expect(result.reasons.some((r) => r.code === 'PRICE_UNKNOWN')).toBe(true);
    expect(result.score).toBeLessThan(matchOpportunity(profile, candidate, NOW).score);
  });

  it('отсутствие срока не блокирует и честно отмечается', () => {
    const result = matchOpportunity(profile, { ...candidate, deadline: null }, NOW);
    expect(result.suitable).toBe(true);
    expect(result.reasons.some((r) => r.code === 'DEADLINE_UNKNOWN')).toBe(true);
  });

  it('отсутствие региона не считается совпадением', () => {
    const result = matchOpportunity(profile, { ...candidate, region: null }, NOW);
    const reason = result.reasons.find((r) => r.code === 'REGION_OTHER');
    expect(reason?.weight).toBe(0);
    expect(reason?.detail).toMatch(/не указан/);
  });

  it('незаполненный профиль не выдаёт полное совпадение по предмету', () => {
    const empty: MatchProfile = {
      keywords: [],
      excludedKeywords: [],
      regions: [],
      procurementTypes: [],
      minPriceMinor: null,
      maxPriceMinor: null,
      minDeliveryDays: null,
      excludedCustomerBins: [],
      preferredCustomerBins: [],
      minDaysToDeadline: null,
    };
    const result = matchOpportunity(empty, candidate, NOW);
    expect(result.suitable).toBe(true);
    expect(result.score).toBeLessThan(70);
    expect(
      result.reasons.find((r) => r.code === 'NO_KEYWORD_HIT')?.detail,
    ).toMatch(/не указано/);
  });
});

describe('нормализация', () => {
  it('регистр и лишние пробелы не мешают совпадению', () => {
    const result = matchOpportunity(
      profile,
      { ...candidate, title: 'ПОСТАВКА   КАБЕЛЯ\nсилового' },
      NOW,
    );
    expect(result.matchedKeywords).toEqual(['кабель']);
  });

  it('регион сравнивается в обе стороны', () => {
    expect(
      matchOpportunity(profile, { ...candidate, region: 'Алматинская область' }, NOW)
        .reasons.some((r) => r.code === 'REGION_HIT'),
    ).toBe(true);
  });
});

describe('scoreLabel', () => {
  it('границы словесной оценки', () => {
    expect(scoreLabel(70)).toBe('ВЫСОКОЕ');
    expect(scoreLabel(69)).toBe('СРЕДНЕЕ');
    expect(scoreLabel(40)).toBe('СРЕДНЕЕ');
    expect(scoreLabel(39)).toBe('НИЗКОЕ');
  });
});

describe('словоформы русского языка', () => {
  const base: MatchProfile = {
    keywords: ['кабель', 'монтаж систем видеонаблюдения'],
    excludedKeywords: [],
    regions: [],
    procurementTypes: [],
    minPriceMinor: null,
    maxPriceMinor: null,
    minDeliveryDays: null,
    excludedCustomerBins: [],
    preferredCustomerBins: [],
    minDaysToDeadline: null,
  };
  const blank: MatchCandidate = {
    title: '',
    customerBin: null,
    priceMinor: null,
    procurementType: 'OTHER',
    region: null,
    deadline: null,
    deliveryDeadline: null,
  };

  const matched = (title: string) =>
    matchOpportunity(base, { ...blank, title }, NOW).matchedKeywords;

  it('находит слово в другом падеже', () => {
    expect(matched('Закуп кабеля силового')).toContain('кабель');
    expect(matched('Работы с кабелем')).toContain('кабель');
    expect(matched('Кабели и провода')).toContain('кабель');
  });

  it('словосочетание требует все свои слова', () => {
    expect(matched('Монтаж систем видеонаблюдения в школе')).toContain(
      'монтаж систем видеонаблюдения',
    );
    // Один «монтаж» без остального не считается совпадением.
    expect(matched('Монтаж отопления')).not.toContain(
      'монтаж систем видеонаблюдения',
    );
  });

  it('не находит несвязанное слово', () => {
    expect(matched('Поставка канцелярских товаров')).toEqual([]);
  });

  it('знаки препинания не мешают', () => {
    expect(matched('Поставка: кабель (силовой), 100 м')).toContain('кабель');
  });
});
