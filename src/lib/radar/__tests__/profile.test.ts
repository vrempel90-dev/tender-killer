import { describe, expect, it } from 'vitest';
import {
  ProfileSchema,
  profileCompleteness,
  toMatchProfile,
  toStoredProfile,
} from '../profile';

const minimal = {
  keywords: ['кабель'],
  excludedKeywords: [],
  regions: [],
  procurementTypes: [],
  minPrice: null,
  maxPrice: null,
  minDeliveryDays: null,
  excludedCustomerBins: [],
  preferredCustomerBins: [],
  minDaysToDeadline: null,
  notes: null,
};

describe('проверка профиля', () => {
  it('принимает заполненный профиль', () => {
    expect(() => ProfileSchema.parse(minimal)).not.toThrow();
  });

  it('отклоняет минимальную сумму больше максимальной', () => {
    expect(() =>
      ProfileSchema.parse({ ...minimal, minPrice: 1000, maxPrice: 100 }),
    ).toThrow(/больше максимальной/);
  });

  it('отклоняет некорректный БИН', () => {
    expect(() =>
      ProfileSchema.parse({ ...minimal, excludedCustomerBins: ['123'] }),
    ).toThrow();
  });

  it('отклоняет посторонние поля', () => {
    expect(() => ProfileSchema.parse({ ...minimal, admin: true })).toThrow();
  });

  it('отклоняет слишком короткое ключевое слово', () => {
    expect(() => ProfileSchema.parse({ ...minimal, keywords: ['к'] })).toThrow();
  });
});

describe('перевод в хранимый вид', () => {
  it('деньги переводятся в тиын', () => {
    const stored = toStoredProfile(
      ProfileSchema.parse({ ...minimal, minPrice: 1000, maxPrice: 2000.55 }),
    );
    expect(stored.minPriceMinor).toBe(100_000n);
    expect(stored.maxPriceMinor).toBe(200_055n);
  });

  it('повторы убираются без учёта регистра, написание сохраняется', () => {
    const stored = toStoredProfile(
      ProfileSchema.parse({ ...minimal, keywords: ['Кабель', 'кабель', 'Провод'] }),
    );
    expect(stored.keywords).toEqual(['Кабель', 'Провод']);
  });
});

describe('перевод в профиль сопоставления', () => {
  it('пустой профиль не ограничивает ничего', () => {
    const match = toMatchProfile(null);
    expect(match.keywords).toEqual([]);
    expect(match.minPriceMinor).toBeNull();
    expect(match.maxPriceMinor).toBeNull();
    expect(match.minDaysToDeadline).toBeNull();
  });

  it('границы суммы переносятся числом', () => {
    const match = toMatchProfile({
      ...toStoredProfile(ProfileSchema.parse({ ...minimal, minPrice: 1000 })),
    });
    expect(match.minPriceMinor).toBe(100_000);
  });
});

describe('заполненность профиля', () => {
  it('пустой профиль: ничего не заполнено', () => {
    const result = profileCompleteness(null);
    expect(result.filled).toBe(0);
    expect(result.total).toBe(5);
    expect(result.missing).toContain('что поставляет компания');
  });

  it('частично заполненный профиль перечисляет, чего не хватает', () => {
    const stored = toStoredProfile(
      ProfileSchema.parse({ ...minimal, regions: ['Алматы'] }),
    );
    const result = profileCompleteness(stored);
    expect(result.filled).toBe(2);
    expect(result.missing).toContain('границы суммы договора');
    expect(result.missing).not.toContain('регионы поставки');
  });
});
