import { describe, expect, it } from 'vitest';
import { compareQuotes, evaluateQuote, type LogisticsTariff, type QuoteOption } from '../compare';
import { buildRfqText } from '../rfq';

const kzt = (major: number) => Math.round(major * 100);

const NO_LOGISTICS: LogisticsTariff = {
  perUnitMinor: 0,
  flatMinor: 0,
  customsPercent: 0,
};

function option(overrides: Partial<QuoteOption> = {}): QuoteOption {
  return {
    quoteItemId: 'qi-1',
    quoteId: 'q-1',
    supplierName: 'ТОО «Поставщик»',
    verified: true,
    unitPriceMinor: kzt(348_000),
    currency: 'KZT',
    fxRate: null,
    pricesIncludeVat: true,
    quantity: 100,
    specMatch: 'MATCH',
    specMatchNote: null,
    leadTimeDays: 21,
    validUntil: null,
    ...overrides,
  };
}

describe('расчёт полной закупочной себестоимости', () => {
  it('считает стоимость партии в тенге', () => {
    const r = evaluateQuote(option(), NO_LOGISTICS);
    expect(r.unitPriceKztMinor).toBe(kzt(348_000));
    expect(r.totalKztMinor).toBe(kzt(34_800_000));
    expect(r.landedCostMinor).toBe(kzt(34_800_000));
    expect(r.issues).toEqual([]);
  });

  it('добавляет логистику за единицу и за партию', () => {
    const r = evaluateQuote(option(), {
      perUnitMinor: kzt(2_000),
      flatMinor: kzt(150_000),
      customsPercent: 0,
    });
    // 100 × 2 000 + 150 000 = 350 000
    expect(r.logisticsMinor).toBe(kzt(350_000));
    expect(r.landedCostMinor).toBe(kzt(34_800_000) + kzt(350_000));
    expect(r.landedUnitCostMinor).toBe(
      Math.round((kzt(34_800_000) + kzt(350_000)) / 100),
    );
  });

  it('добавляет таможенные платежи процентом от стоимости', () => {
    const r = evaluateQuote(option(), {
      perUnitMinor: 0,
      flatMinor: 0,
      customsPercent: 5,
    });
    expect(r.landedCostMinor).toBe(kzt(34_800_000) + kzt(1_740_000));
  });

  it('НЕ подставляет курс валюты, если он не задан', () => {
    const r = evaluateQuote(
      option({ currency: 'USD', unitPriceMinor: 70_000, fxRate: null }),
      NO_LOGISTICS,
    );
    expect(r.unitPriceKztMinor).toBeNull();
    expect(r.landedCostMinor).toBeNull();
    expect(r.issues.join(' ')).toContain('курс к тенге не задан');
  });

  it('пересчитывает по заданному курсу', () => {
    const r = evaluateQuote(
      option({ currency: 'USD', unitPriceMinor: 70_000, fxRate: 520 }),
      NO_LOGISTICS,
    );
    // 700,00 USD × 520 = 364 000 ₸ за единицу
    expect(r.unitPriceKztMinor).toBe(kzt(364_000));
  });

  it('помечает неподтверждённую цену', () => {
    const r = evaluateQuote(option({ verified: false }), NO_LOGISTICS);
    expect(r.issues.join(' ')).toContain('не подтверждена документом');
  });

  it('помечает несоответствие требованиям', () => {
    expect(
      evaluateQuote(option({ specMatch: 'MISMATCH' }), NO_LOGISTICS).issues.join(' '),
    ).toContain('не соответствует');
    expect(
      evaluateQuote(option({ specMatch: 'PARTIAL' }), NO_LOGISTICS).issues.join(' '),
    ).toContain('частично');
    expect(
      evaluateQuote(option({ specMatch: 'UNKNOWN' }), NO_LOGISTICS).issues.join(' '),
    ).toContain('не проверено');
  });

  it('помечает просроченное предложение', () => {
    const r = evaluateQuote(
      option({ validUntil: new Date('2026-01-01') }),
      NO_LOGISTICS,
      new Date('2026-06-01'),
    );
    expect(r.expired).toBe(true);
    expect(r.issues.join(' ')).toContain('истёк');
  });
});

describe('сравнение предложений', () => {
  it('выбирает самое дешёвое подтверждённое и соответствующее', () => {
    const result = compareQuotes(
      [
        option({ quoteItemId: 'a', unitPriceMinor: kzt(360_000) }),
        option({ quoteItemId: 'b', unitPriceMinor: kzt(348_000) }),
        option({ quoteItemId: 'c', unitPriceMinor: kzt(352_000) }),
      ],
      NO_LOGISTICS,
    );
    expect(result.bestOptionId).toBe('b');
    expect(result.selectionNote).toBeNull();
    // отсортировано по полной себестоимости
    expect(result.options.map((o) => o.quoteItemId)).toEqual(['b', 'c', 'a']);
  });

  it('НЕ выбирает автоматически, если дешёвое предложение не подтверждено', () => {
    const result = compareQuotes(
      [
        option({ quoteItemId: 'cheap', unitPriceMinor: kzt(300_000), verified: false }),
        option({ quoteItemId: 'ok', unitPriceMinor: kzt(348_000) }),
      ],
      NO_LOGISTICS,
    );
    // выбирается подтверждённое, несмотря на более высокую цену
    expect(result.bestOptionId).toBe('ok');
  });

  it('оставляет выбор человеку, если ни одно предложение не годится', () => {
    const result = compareQuotes(
      [
        option({ quoteItemId: 'a', verified: false }),
        option({ quoteItemId: 'b', specMatch: 'PARTIAL' }),
      ],
      NO_LOGISTICS,
    );
    expect(result.bestOptionId).toBeNull();
    expect(result.selectionNote).toContain('вручную');
    expect(result.selectionNote).toContain('не подтверждена');
  });

  it('сообщает об отсутствии предложений', () => {
    const result = compareQuotes([], NO_LOGISTICS);
    expect(result.bestOptionId).toBeNull();
    expect(result.selectionNote).toContain('Предложений поставщиков нет');
  });

  it('предложения без рассчитанной цены уходят в конец списка', () => {
    const result = compareQuotes(
      [
        option({ quoteItemId: 'no-rate', currency: 'EUR', fxRate: null }),
        option({ quoteItemId: 'kzt' }),
      ],
      NO_LOGISTICS,
    );
    expect(result.options[result.options.length - 1]!.quoteItemId).toBe('no-rate');
  });
});

describe('запрос коммерческого предложения', () => {
  const base = {
    companyName: 'ТОО «Наша компания»',
    companyBin: '123456789012',
    contactName: 'Иван Петров',
    contactEmail: 'ivan@company.kz',
    tenderTitle: 'Поставка компьютерной техники',
    deliveryDeadline: new Date('2027-01-30'),
    region: 'г. Алматы',
    responseDeadline: new Date('2026-11-01'),
  };

  it('включает позиции с количеством и требованиями', () => {
    const text = buildRfqText({
      ...base,
      items: [
        {
          position: 1,
          name: 'Ноутбук 15,6"',
          specification: '16 ГБ ОЗУ, SSD 512 ГБ',
          unit: 'шт',
          quantity: 100,
        },
      ],
    });
    expect(text).toContain('Ноутбук 15,6"');
    expect(text).toContain('100 шт');
    expect(text).toContain('16 ГБ ОЗУ');
    expect(text).toContain('ТОО «Наша компания»');
    expect(text).toContain('БИН 123456789012');
  });

  it('запрашивает сведения, нужные для корректного расчёта', () => {
    const text = buildRfqText({ ...base, items: [] });
    // без этих данных нельзя правильно посчитать НДС и кассовый разрыв
    expect(text).toContain('с НДС или без НДС');
    expect(text).toContain('плательщиком НДС');
    expect(text).toContain('Условия оплаты');
    expect(text).toContain('Срок поставки');
    expect(text).toContain('Срок действия коммерческого предложения');
  });

  it('честно сообщает, если позиции не заполнены', () => {
    const text = buildRfqText({ ...base, items: [] });
    expect(text).toContain('позиции не заполнены');
  });

  it('не выдумывает количество, если его нет', () => {
    const text = buildRfqText({
      ...base,
      items: [
        {
          position: 1,
          name: 'Кабель',
          specification: null,
          unit: 'м',
          quantity: 0,
        },
      ],
    });
    expect(text).toContain('Количество: уточняется');
  });
});
