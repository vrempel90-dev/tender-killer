import { describe, expect, it } from 'vitest';
import {
  guessColumnMapping,
  mapProcurementType,
  parseCsv,
  parseDate,
  parseMarketRows,
  parseMoney,
} from '../import';

describe('разбор денежных сумм из выгрузок', () => {
  it('понимает пробелы как разделитель тысяч', () => {
    expect(parseMoney('1 234 567')).toBe(123_456_700);
    expect(parseMoney('48 500 000,50')).toBe(4_850_000_050);
  });

  it('понимает запятую как дробный разделитель', () => {
    expect(parseMoney('1234,56')).toBe(123_456);
  });

  it('понимает запятую как разделитель тысяч при трёх знаках', () => {
    expect(parseMoney('1,234')).toBe(123_400);
  });

  it('понимает смешанный формат 1,234,567.89', () => {
    expect(parseMoney('1,234,567.89')).toBe(123_456_789);
  });

  it('понимает формат 1.234.567,89', () => {
    expect(parseMoney('1.234.567,89')).toBe(123_456_789);
  });

  it('отбрасывает обозначение валюты', () => {
    expect(parseMoney('48 500 000 тг')).toBe(4_850_000_000);
    expect(parseMoney('1000 ₸')).toBe(100_000);
  });

  it('возвращает null для нечисловых значений', () => {
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('не указано')).toBeNull();
    expect(parseMoney('—')).toBeNull();
  });
});

describe('разбор дат', () => {
  it('понимает ДД.ММ.ГГГГ', () => {
    const d = parseDate('15.03.2026');
    expect(d?.toISOString().slice(0, 10)).toBe('2026-03-15');
  });

  it('понимает ГГГГ-ММ-ДД', () => {
    expect(parseDate('2026-03-15')?.toISOString().slice(0, 10)).toBe('2026-03-15');
  });

  it('понимает ДД/ММ/ГГГГ', () => {
    expect(parseDate('1/4/2026')?.toISOString().slice(0, 10)).toBe('2026-04-01');
  });

  it('возвращает null для неразборчивой даты', () => {
    expect(parseDate('')).toBeNull();
    expect(parseDate('март 2026')).toBeNull();
  });
});

describe('определение вида процедуры', () => {
  it('сопоставляет русские названия', () => {
    expect(mapProcurementType('Открытый конкурс')).toBe('OPEN_TENDER');
    expect(mapProcurementType('Запрос ценовых предложений')).toBe(
      'REQUEST_FOR_QUOTATIONS',
    );
    expect(mapProcurementType('Из одного источника')).toBe('SINGLE_SOURCE');
    expect(mapProcurementType('Аукцион')).toBe('AUCTION');
  });

  it('неизвестное значение относит к «иное»', () => {
    expect(mapProcurementType('нечто непонятное')).toBe('OTHER');
    expect(mapProcurementType('')).toBe('OTHER');
  });
});

describe('сопоставление колонок', () => {
  it('распознаёт типовые заголовки выгрузки портала закупок', () => {
    const mapping = guessColumnMapping([
      'Номер объявления',
      'Наименование закупки',
      'Заказчик',
      'БИН заказчика',
      'Плановая сумма',
      'Сумма договора',
      'Победитель',
      'Количество участников',
      'Дата заключения договора',
      'Способ закупки',
    ]);
    expect(mapping.externalNumber).toBe(0);
    expect(mapping.title).toBe(1);
    expect(mapping.customerName).toBe(2);
    expect(mapping.customerBin).toBe(3);
    expect(mapping.startPrice).toBe(4);
    expect(mapping.finalPrice).toBe(5);
    expect(mapping.winnerName).toBe(6);
    expect(mapping.participantsCount).toBe(7);
    expect(mapping.awardedAt).toBe(8);
    expect(mapping.procurementType).toBe(9);
  });

  it('распознаёт англоязычные заголовки', () => {
    const mapping = guessColumnMapping([
      'title',
      'customer',
      'start_price',
      'final_price',
      'winner',
    ]);
    expect(mapping.title).toBe(0);
    expect(mapping.startPrice).toBe(2);
    expect(mapping.finalPrice).toBe(3);
  });

  it('не сопоставляет колонку дважды', () => {
    const mapping = guessColumnMapping(['Цена договора', 'Сумма договора']);
    const indices = Object.values(mapping);
    expect(new Set(indices).size).toBe(indices.length);
  });
});

describe('разбор CSV', () => {
  it('понимает точку с запятой как разделитель', () => {
    const rows = parseCsv('a;b;c\n1;2;3');
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('понимает запятую как разделитель', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('учитывает кавычки и разделитель внутри них', () => {
    const rows = parseCsv('name;price\n"ТОО ""Альфа""; филиал";1000');
    expect(rows[1]![0]).toBe('ТОО "Альфа"; филиал');
    expect(rows[1]![1]).toBe('1000');
  });

  it('убирает BOM', () => {
    expect(parseCsv('﻿a;b')[0]![0]).toBe('a');
  });
});

describe('разбор строк закупок', () => {
  const table = [
    [
      'Номер объявления',
      'Наименование закупки',
      'Заказчик',
      'БИН заказчика',
      'Плановая сумма',
      'Сумма договора',
      'Победитель',
      'Количество участников',
      'Дата заключения договора',
      'Способ закупки',
    ],
    [
      '77712345-1',
      'Поставка компьютерной техники',
      'ГУ Управление образования',
      '123456789012',
      '50 000 000',
      '46 000 000',
      'ТОО «Техноснаб»',
      '4',
      '15.03.2026',
      'Открытый конкурс',
    ],
    [
      '77712346-1',
      'Поставка мебели',
      'ГУ Управление образования',
      '123456789012',
      '12 000 000',
      '',
      '',
      '2',
      '',
      'Запрос ценовых предложений',
    ],
  ];

  it('разбирает заполненную строку полностью', () => {
    const result = parseMarketRows(table);
    expect(result.rows).toHaveLength(2);
    const first = result.rows[0]!;
    expect(first.externalNumber).toBe('77712345-1');
    expect(first.title).toBe('Поставка компьютерной техники');
    expect(first.customerBin).toBe('123456789012');
    expect(first.startPriceMinor).toBe(5_000_000_000);
    expect(first.finalPriceMinor).toBe(4_600_000_000);
    expect(first.winnerName).toBe('ТОО «Техноснаб»');
    expect(first.participantsCount).toBe(4);
    expect(first.awardedAt?.toISOString().slice(0, 10)).toBe('2026-03-15');
    expect(first.procurementType).toBe('OPEN_TENDER');
  });

  it('оставляет незаполненные поля пустыми, а не нулями', () => {
    const second = parseMarketRows(table).rows[1]!;
    expect(second.finalPriceMinor).toBeNull();
    expect(second.winnerName).toBeNull();
    expect(second.awardedAt).toBeNull();
    // при этом заполненное значение сохранено
    expect(second.startPriceMinor).toBe(1_200_000_000);
  });

  it('пропускает строку без наименования и объясняет причину', () => {
    const withBad = [...table, ['999', '', 'Заказчик', '', '1000', '', '', '', '', '']];
    const result = parseMarketRows(withBad);
    expect(result.rows).toHaveLength(2);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.reason).toContain('наименование');
    expect(result.skipped[0]!.rowNumber).toBe(4);
  });

  it('игнорирует полностью пустые строки без ошибки', () => {
    const withEmpty = [...table, ['', '', '', '', '', '', '', '', '', '']];
    const result = parseMarketRows(withEmpty);
    expect(result.rows).toHaveLength(2);
    expect(result.skipped).toHaveLength(0);
  });

  it('сообщает, какие поля не найдены в файле', () => {
    const result = parseMarketRows([
      ['Наименование'],
      ['Поставка техники'],
    ]);
    expect(result.rows).toHaveLength(1);
    expect(result.missingFields).toContain('startPrice');
    expect(result.missingFields).toContain('winnerName');
    expect(result.missingFields).not.toContain('title');
  });

  it('нормализует БИН: только 12 цифр', () => {
    const result = parseMarketRows([
      ['Наименование', 'БИН заказчика'],
      ['Закупка', '12345'],
      ['Закупка 2', '123 456 789 012'],
    ]);
    expect(result.rows[0]!.customerBin).toBeNull();
    expect(result.rows[1]!.customerBin).toBe('123456789012');
  });
});
