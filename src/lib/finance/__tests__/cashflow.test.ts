import { describe, expect, it } from 'vitest';
import { computeCashflow } from '../cashflow';
import { computeCore } from '../core';
import { kzt, realisticTenderInput, simpleVatPayerInput } from './fixtures';

describe('прогноз движения денежных средств', () => {
  const input = realisticTenderInput();
  const core = computeCore(input);
  const cf = computeCashflow(input, core);

  it('строит периоды по дням в хронологическом порядке', () => {
    expect(cf.periods.length).toBeGreaterThan(0);
    const days = cf.periods.map((p) => p.day);
    expect([...days].sort((a, b) => a - b)).toEqual(days);
  });

  it('накопленный поток считается кумулятивно', () => {
    let running = 0;
    for (const p of cf.periods) {
      running += p.netMinor;
      expect(p.cumulativeMinor).toBe(running);
    }
  });

  it('возвратный залог уходит и возвращается — итог по нему нулевой', () => {
    const outflow = cf.periods
      .flatMap((p) => p.entries)
      .filter((e) => e.label.includes('обеспечения заявки') && e.kind === 'OUT')
      .reduce((s, e) => s + e.amountMinor, 0);
    const inflow = cf.periods
      .flatMap((p) => p.entries)
      .filter((e) => e.label.includes('обеспечения заявки') && e.kind === 'IN')
      .reduce((s, e) => s + e.amountMinor, 0);
    expect(outflow).toBeGreaterThan(0);
    expect(inflow).toBe(outflow);
  });

  it('выявляет пиковый кассовый разрыв и день его наступления', () => {
    expect(cf.workingCapital.requirementMinor).toBeGreaterThan(0);
    expect(cf.workingCapital.peakGapDay).not.toBeNull();
    expect(cf.minCumulativeMinor).toBeLessThan(0);
    expect(cf.workingCapital.requirementMinor).toBe(
      Math.abs(cf.minCumulativeMinor),
    );
  });

  it('учитывает замороженные обеспечения отдельно от расходов', () => {
    // денежный залог по заявке 1 % от 50 млн = 500 000 ₸
    expect(cf.workingCapital.frozenSecuritiesMinor).toBe(kzt(500_000));
  });

  it('ПРИБЫЛЬ НЕ РАВНА денежному потоку', () => {
    expect(cf.netCashMinor).not.toBe(core.profit.netMinor);
  });

  it('в потоке участвуют суммы с НДС, а в прибыли — без НДС', () => {
    const customerInflow = cf.periods
      .flatMap((p) => p.entries)
      .filter((e) => e.kind === 'IN' && e.label.includes('акта'))
      .reduce((s, e) => s + e.amountMinor, 0);
    // поступление от заказчика — это выручка С НДС
    expect(customerInflow).toBe(core.revenue.grossMinor);
    expect(customerInflow).toBeGreaterThan(core.revenue.netMinor);
  });

  it('включает уплату НДС в бюджет как отток денег', () => {
    const vatPayment = cf.periods
      .flatMap((p) => p.entries)
      .find((e) => e.label.includes('Уплата НДС'));
    expect(vatPayment).toBeDefined();
    expect(vatPayment!.amountMinor).toBe(core.vat.payableMinor);
    expect(vatPayment!.kind).toBe('OUT');
  });

  it('задержка оплаты увеличивает кассовый разрыв', () => {
    const delayed = computeCashflow(input, core, { paymentDelayAddDays: 60 });
    expect(delayed.workingCapital.daysInDeficit).toBeGreaterThanOrEqual(
      cf.workingCapital.daysInDeficit,
    );
  });

  it('аванс заказчика сокращает потребность в оборотных средствах', () => {
    const withAdvance = {
      ...input,
      schedule: { ...input.schedule, advancePercent: 30, advanceDay: 3 },
    };
    const coreAdv = computeCore(withAdvance);
    const cfAdv = computeCashflow(withAdvance, coreAdv);
    expect(cfAdv.workingCapital.requirementMinor).toBeLessThan(
      cf.workingCapital.requirementMinor,
    );
  });

  it('не создаёт движений при пустом расчёте', () => {
    const empty = simpleVatPayerInput({
      tender: {
        startPriceMinor: null,
        bidPriceMinor: null,
        bidPriceVatMode: 'INCLUSIVE',
        startPriceVatMode: 'INCLUSIVE',
        currency: 'KZT',
      },
      costs: {
        items: [],
        otherDirect: [],
        logistics: [],
        customs: {
          isImport: false,
          dutyMinor: 0,
          importVatMinor: 0,
          feesMinor: 0,
          feesVatMode: 'EXCLUSIVE',
          feesSupplierChargesVat: true,
        },
        payroll: { grossPayrollMinor: 0, payrollTaxPercentOverride: null },
        subcontractors: [],
        overhead: [],
        contingencyPercent: 0,
      },
    });
    const c = computeCore(empty);
    const r = computeCashflow(empty, c);
    expect(r.periods).toHaveLength(0);
    expect(r.workingCapital.requirementMinor).toBe(0);
  });
});
