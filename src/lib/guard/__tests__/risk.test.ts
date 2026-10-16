import { describe, expect, it } from 'vitest';
import { createEmptyFinanceInput } from '../../finance/defaults';
import type { FinanceInput } from '../../finance/types';
import { reassessRisk } from '../risk';
import type { DetectedChange } from '../compare';

function baseInput(): FinanceInput {
  const input = createEmptyFinanceInput({
    regime: 'GENERAL_NO_VAT',
    isVatPayer: false,
    startPriceMinor: 10_000_000_00,
  });
  input.tender.bidPriceMinor = 9_000_000_00;
  input.costs.items = [
    {
      label: 'Поставка оборудования',
      quantity: 1,
      unitCostMinor: 6_000_000_00,
      vatMode: 'INCLUSIVE',
      supplierChargesVat: false,
      verified: true,
    },
  ];
  input.schedule.contractDurationDays = 60;
  input.schedule.deliveryDay = 40;
  input.schedule.paymentDelayDays = 15;
  return input;
}

const priceDrop = (afterMinor: number): DetectedChange => ({
  kind: 'START_PRICE_CHANGED',
  severity: 'CRITICAL',
  summary: 'Начальная цена снижена',
  detail: { beforeMinor: 10_000_000_00, afterMinor, deltaMinor: afterMinor - 10_000_000_00 },
  requiresRecalc: true,
});

const deliveryShift = (shiftDays: number): DetectedChange => ({
  kind: 'DELIVERY_DEADLINE_MOVED',
  severity: shiftDays < 0 ? 'CRITICAL' : 'MAJOR',
  summary: 'Срок поставки изменён',
  detail: { shiftDays },
  requiresRecalc: true,
});

const specChange: DetectedChange = {
  kind: 'SPEC_CHANGED',
  severity: 'MAJOR',
  summary: 'Техническое задание изменено: добавлено требований 2',
  detail: { addedCount: 2, removedCount: 0, similarity: 0.9 },
  requiresRecalc: true,
};

describe('без сохранённого расчёта', () => {
  it('ГЛАВНОЕ: переоценка не выдумывается, а объявляется невозможной', () => {
    const result = reassessRisk({ input: null, changes: [priceDrop(8_000_000_00)] });
    expect(result.verdict).toBe('NOT_POSSIBLE');
    expect(result.before).toBeNull();
    expect(result.after).toBeNull();
    expect(result.notes[0]).toMatch(/расчёт по этому тендеру ещё не сохранён/);
  });
});

describe('изменение начальной цены', () => {
  it('пересчитывает прибыль по новой цене', () => {
    const result = reassessRisk({
      input: baseInput(),
      changes: [priceDrop(8_500_000_00)],
    });
    expect(result.applied.join(' ')).toMatch(/начальная цена/);
    expect(result.before).not.toBeNull();
    expect(result.after).not.toBeNull();
    // Цена предложения 9 млн выше новой начальной 8,5 млн — ограничивается.
    expect(result.bidExceedsNewStartPrice).toBe(true);
    expect(result.after!.bidPriceMinor).toBe(8_500_000_00);
    expect(result.deltaNetMinor).toBeLessThan(0);
  });

  it('ГЛАВНОЕ: если прежнюю цену подать нельзя, это сказано прямо', () => {
    const result = reassessRisk({
      input: baseInput(),
      changes: [priceDrop(8_000_000_00)],
    });
    expect(result.notes.join(' ')).toMatch(/подать её нельзя/);
  });

  it('снижение цены ниже себестоимости даёт вердикт «убыток»', () => {
    const result = reassessRisk({
      input: baseInput(),
      changes: [priceDrop(5_000_000_00)],
    });
    expect(result.verdict).toBe('NOW_LOSS');
    expect(result.after!.netMinor).toBeLessThan(0);
    expect(result.notes.join(' ')).toMatch(/уходит в убыток/);
  });

  it('повышение начальной цены не ограничивает предложение', () => {
    const result = reassessRisk({
      input: baseInput(),
      changes: [priceDrop(12_000_000_00)],
    });
    expect(result.bidExceedsNewStartPrice).toBe(false);
    expect(result.after!.bidPriceMinor).toBe(9_000_000_00);
  });
});

describe('изменение срока поставки', () => {
  it('сдвигает срок исполнения и день акта', () => {
    const result = reassessRisk({
      input: baseInput(),
      changes: [deliveryShift(-20)],
    });
    expect(result.applied).toContain('срок исполнения договора → 40 дн.');
    expect(result.applied).toContain('день подписания акта → 20');
  });

  it('срок не уходит в отрицательные значения', () => {
    const result = reassessRisk({
      input: baseInput(),
      changes: [deliveryShift(-500)],
    });
    expect(result.applied).toContain('срок исполнения договора → 1 дн.');
    expect(result.applied).toContain('день подписания акта → 1');
  });

  it('без заданного графика переоценка оставляет это человеку', () => {
    const input = baseInput();
    input.schedule.contractDurationDays = null;
    input.schedule.deliveryDay = null;
    const result = reassessRisk({ input, changes: [deliveryShift(-10)] });
    expect(result.manual.join(' ')).toMatch(/график платежей нужно задать вручную/);
  });
});

describe('изменение технического задания', () => {
  it('ГЛАВНОЕ: затраты не придумываются, изменение уходит на ручной пересмотр', () => {
    const result = reassessRisk({ input: baseInput(), changes: [specChange] });
    expect(result.verdict).toBe('NEEDS_MANUAL_REVIEW');
    expect(result.manual.join(' ')).toMatch(/Состав затрат нужно пересмотреть вручную/);
    // Исходные данные расчёта не менялись, поэтому «после» не считается.
    expect(result.after).toBeNull();
    expect(result.deltaNetMinor).toBeNull();
  });

  it('вместе с изменением цены пересчёт выполняется, но помечается', () => {
    const result = reassessRisk({
      input: baseInput(),
      changes: [priceDrop(9_500_000_00), specChange],
    });
    expect(result.verdict).toBe('NEEDS_MANUAL_REVIEW');
    expect(result.after).not.toBeNull();
    expect(result.manual.length).toBeGreaterThan(0);
    expect(result.notes.join(' ')).toMatch(/проверьте состав затрат/);
  });
});

describe('изменения без влияния на расчёт', () => {
  it('срок подачи заявки на экономику сделки не влияет', () => {
    const result = reassessRisk({
      input: baseInput(),
      changes: [
        {
          kind: 'SUBMISSION_DEADLINE_MOVED',
          severity: 'MAJOR',
          summary: 'Срок подачи сдвинут',
          detail: { shiftDays: -5 },
          requiresRecalc: false,
        },
      ],
    });
    expect(result.verdict).toBe('NO_FINANCIAL_EFFECT');
    expect(result.notes.join(' ')).toMatch(/не затрагивают исходные данные/);
  });

  it('исходный расчёт не изменяется переоценкой', () => {
    const input = baseInput();
    const snapshot = structuredClone(input);
    reassessRisk({ input, changes: [priceDrop(7_000_000_00), deliveryShift(-10)] });
    expect(input).toEqual(snapshot);
  });
});
