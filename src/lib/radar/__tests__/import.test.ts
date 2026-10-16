import { describe, expect, it } from 'vitest';
import { parseCsv } from '../../market/import';
import { guessRadarMapping, parseOpportunityRows } from '../import';

const HEADERS = [
  'Номер объявления',
  'Наименование закупки',
  'Заказчик',
  'БИН заказчика',
  'Плановая сумма',
  'Способ закупки',
  'Регион',
  'Окончание приёма заявок',
  'Срок поставки',
  'Ссылка',
];

describe('сопоставление колонок', () => {
  it('распознаёт типовые заголовки выгрузки', () => {
    const mapping = guessRadarMapping(HEADERS);
    expect(mapping).toEqual({
      externalId: 0,
      title: 1,
      customerName: 2,
      customerBin: 3,
      price: 4,
      procurementType: 5,
      region: 6,
      deadline: 7,
      deliveryDeadline: 8,
      sourceUrl: 9,
    });
  });

  it('ГЛАВНОЕ: «БИН заказчика» не попадает в поле «Заказчик»', () => {
    const mapping = guessRadarMapping(['БИН заказчика', 'Заказчик', 'Наименование']);
    expect(mapping.customerBin).toBe(0);
    expect(mapping.customerName).toBe(1);
  });

  it('срок поставки не путается с окончанием приёма заявок', () => {
    const mapping = guessRadarMapping([
      'Наименование',
      'Срок поставки товара',
      'Дата окончания приёма заявок',
    ]);
    expect(mapping.deliveryDeadline).toBe(1);
    expect(mapping.deadline).toBe(2);
  });

  it('понимает англоязычные заголовки', () => {
    const mapping = guessRadarMapping(['Lot number', 'Title', 'Customer', 'Deadline']);
    expect(mapping.externalId).toBe(0);
    expect(mapping.title).toBe(1);
    expect(mapping.customerName).toBe(2);
    expect(mapping.deadline).toBe(3);
  });

  it('сообщает об отсутствующих полях', () => {
    const result = parseOpportunityRows([['Наименование'], ['Закупка кабеля']]);
    expect(result.missingFields).toContain('deadline');
    expect(result.missingFields).toContain('price');
    expect(result.missingFields).not.toContain('title');
  });
});

describe('разбор строк', () => {
  const table = [
    HEADERS,
    [
      '12345-1',
      'Поставка кабеля силового',
      'ГУ «Управление образования»',
      '123456789012',
      '5 400 000,00',
      'открытый конкурс',
      'г. Алматы',
      '25.10.2026',
      '31.12.2026',
      'https://portal.example.kz/ann/12345',
    ],
  ];

  it('переводит значения в типы системы', () => {
    const { rows } = parseOpportunityRows(table);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.externalId).toBe('12345-1');
    expect(row.title).toBe('Поставка кабеля силового');
    expect(row.customerBin).toBe('123456789012');
    // Деньги хранятся в тиын.
    expect(row.priceMinor).toBe(540_000_000);
    expect(row.procurementType).toBe('OPEN_TENDER');
    expect(row.deadline?.toISOString().slice(0, 10)).toBe('2026-10-25');
    expect(row.deliveryDeadline?.toISOString().slice(0, 10)).toBe('2026-12-31');
    expect(row.sourceUrl).toBe('https://portal.example.kz/ann/12345');
  });

  it('сохраняет исходную строку целиком для проверки по источнику', () => {
    const { rows } = parseOpportunityRows(table);
    expect(rows[0]!.raw['Наименование закупки']).toBe('Поставка кабеля силового');
    expect(rows[0]!.raw['Плановая сумма']).toBe('5 400 000,00');
  });

  it('некорректный БИН не сохраняется как есть', () => {
    const broken = [HEADERS, [...table[1]!]];
    broken[1]![3] = '12345';
    expect(parseOpportunityRows(broken).rows[0]!.customerBin).toBeNull();
  });

  it('ссылка принимается только http(s)', () => {
    const malicious = [HEADERS, [...table[1]!]];
    malicious[1]![9] = 'javascript:alert(1)';
    expect(parseOpportunityRows(malicious).rows[0]!.sourceUrl).toBeNull();
  });

  it('строка без наименования пропускается с причиной', () => {
    const broken = [HEADERS, [...table[1]!]];
    broken[1]![1] = '';
    const result = parseOpportunityRows(broken);
    expect(result.rows).toHaveLength(0);
    expect(result.skipped[0]).toEqual({
      rowNumber: 2,
      reason: 'не заполнено наименование закупки',
    });
  });

  it('полностью пустые строки не считаются ошибкой', () => {
    const result = parseOpportunityRows([HEADERS, table[1]!, ['', '', '', '']]);
    expect(result.rows).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
  });

  it('ГЛАВНОЕ: нераспознанные значения не угадываются', () => {
    const vague = [HEADERS, [...table[1]!]];
    vague[1]![4] = 'по запросу';
    vague[1]![7] = 'уточняется';
    const row = parseOpportunityRows(vague).rows[0]!;
    expect(row.priceMinor).toBeNull();
    expect(row.deadline).toBeNull();
  });
});

describe('предупреждения о качестве данных', () => {
  it('нет колонки срока — отбор по срокам не работает', () => {
    const result = parseOpportunityRows([
      ['Наименование', 'Плановая сумма'],
      ['Закупка кабеля', '1000'],
    ]);
    expect(result.warnings.join(' ')).toMatch(/окончанием приёма заявок/);
  });

  it('нет колонки суммы — передача в расчёт потребует ручного ввода', () => {
    const result = parseOpportunityRows([
      ['Наименование', 'Окончание приёма заявок'],
      ['Закупка кабеля', '25.10.2026'],
    ]);
    expect(result.warnings.join(' ')).toMatch(/плановой суммой/);
  });

  it('нет номера объявления — повторный импорт создаст записи заново', () => {
    const result = parseOpportunityRows([
      ['Наименование'],
      ['Закупка кабеля'],
    ]);
    expect(result.warnings.join(' ')).toMatch(/номер объявления/i);
  });

  it('считает записи с нераспознанным сроком', () => {
    const result = parseOpportunityRows([
      ['Наименование', 'Окончание приёма заявок'],
      ['Закупка кабеля', '25.10.2026'],
      ['Закупка провода', 'уточняется'],
    ]);
    expect(result.warnings.join(' ')).toMatch(/У 1 записей не распознан срок/);
  });

  it('пустой файл описан явно', () => {
    expect(parseOpportunityRows([]).warnings).toEqual(['Файл пустой']);
  });
});

describe('разбор CSV целиком', () => {
  it('выгрузка с точкой с запятой и кавычками', () => {
    const csv = [
      'Номер объявления;Наименование закупки;Плановая сумма;Окончание приёма заявок',
      '777-1;"Поставка кабеля, силового";"1 200 000,00";20.11.2026',
    ].join('\n');
    const result = parseOpportunityRows(parseCsv(csv));
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.title).toBe('Поставка кабеля, силового');
    expect(result.rows[0]!.priceMinor).toBe(120_000_000);
  });
});
