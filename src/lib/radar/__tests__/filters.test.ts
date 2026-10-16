import { describe, expect, it } from 'vitest';
import {
  buildOrderBy,
  buildWhere,
  describeFilters,
  parseFilters,
} from '../filters';

const COMPANY = 'company-1';
const NOW = new Date('2026-10-15T00:00:00Z');

describe('разбор фильтров', () => {
  it('пустой вход даёт пустой набор', () => {
    expect(parseFilters(null)).toEqual({});
    expect(parseFilters(undefined)).toEqual({});
    expect(parseFilters({})).toEqual({});
  });

  it('ГЛАВНОЕ: сохранённый поиск с посторонним полем отклоняется', () => {
    // Фильтры лежат в БД как JSON. Если схема изменится, старая запись не
    // должна молча применяться в неизвестном виде.
    expect(() => parseFilters({ query: 'кабель', dropTable: true })).toThrow();
  });

  it('неизвестный способ закупки отклоняется', () => {
    expect(() => parseFilters({ procurementTypes: ['ЧТО_ТО'] })).toThrow();
  });

  it('некорректный БИН отклоняется', () => {
    expect(() => parseFilters({ customerBin: '123' })).toThrow();
  });

  it('оценка вне диапазона отклоняется', () => {
    expect(() => parseFilters({ minScore: 101 })).toThrow();
    expect(() => parseFilters({ minScore: -1 })).toThrow();
  });

  it('строка поиска обрезается по краям', () => {
    expect(parseFilters({ query: '  кабель  ' }).query).toBe('кабель');
  });
});

describe('условие выборки', () => {
  it('всегда ограничено компанией', () => {
    expect(buildWhere(COMPANY, {}, NOW)).toEqual({ companyId: COMPANY });
  });

  it('цены переводятся в тиын', () => {
    const where = buildWhere(COMPANY, { minPrice: 1000, maxPrice: 2500.5 }, NOW);
    expect(where.priceMinor).toEqual({ gte: 100_000n, lte: 250_050n });
  });

  it('только открытые — срок не раньше текущего момента', () => {
    expect(buildWhere(COMPANY, { onlyOpen: true }, NOW).deadline).toEqual({ gte: NOW });
  });

  it('при двух нижних границах берётся более поздняя', () => {
    const later = '2026-11-01T00:00:00.000Z';
    expect(
      buildWhere(COMPANY, { onlyOpen: true, deadlineFrom: later }, NOW).deadline?.gte,
    ).toEqual(new Date(later));

    const earlier = '2026-09-01T00:00:00.000Z';
    expect(
      buildWhere(COMPANY, { onlyOpen: true, deadlineFrom: earlier }, NOW).deadline?.gte,
    ).toEqual(NOW);
  });

  it('поиск идёт по наименованию, заказчику и номеру', () => {
    const where = buildWhere(COMPANY, { query: 'кабель' }, NOW);
    expect(where.OR).toHaveLength(3);
  });

  it('регионы сравниваются по вхождению', () => {
    const where = buildWhere(COMPANY, { regions: ['Алматы', 'Астана'] }, NOW);
    expect(where.AND?.[0]).toEqual({
      OR: [
        { region: { contains: 'Алматы', mode: 'insensitive' } },
        { region: { contains: 'Астана', mode: 'insensitive' } },
      ],
    });
  });

  it('не переданные в расчёт — это tenderId = null', () => {
    expect(buildWhere(COMPANY, { notTransferred: true }, NOW).tenderId).toBeNull();
  });

  it('фильтры по профилю в SQL не попадают', () => {
    const where = buildWhere(COMPANY, { onlySuitable: true, minScore: 80 }, NOW);
    expect(JSON.stringify(where)).not.toMatch(/score|suitable/i);
  });
});

describe('порядок выборки', () => {
  it('по сроку, по цене и по умолчанию', () => {
    expect(buildOrderBy({ sort: 'deadline' })).toEqual([{ deadline: 'asc' }]);
    expect(buildOrderBy({ sort: 'price' })).toEqual([{ priceMinor: 'desc' }]);
    expect(buildOrderBy({})).toEqual([{ createdAt: 'desc' }]);
    // Сортировка по оценке считается в приложении, в БД — порядок импорта.
    expect(buildOrderBy({ sort: 'score' })).toEqual([{ createdAt: 'desc' }]);
  });
});

describe('описание фильтров', () => {
  it('пустой набор описан явно', () => {
    expect(describeFilters({})).toBe('без ограничений');
  });

  it('перечисляет заданные условия', () => {
    const description = describeFilters({
      query: 'кабель',
      regions: ['Алматы'],
      procurementTypes: ['OPEN_TENDER'],
      onlyOpen: true,
      minScore: 60,
    });
    expect(description).toContain('«кабель»');
    expect(description).toContain('Алматы');
    expect(description).toContain('Открытый конкурс');
    expect(description).toContain('приём не закончен');
    expect(description).toContain('оценка от 60');
  });
});
