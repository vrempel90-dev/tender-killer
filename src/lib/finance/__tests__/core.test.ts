import { describe, expect, it } from 'vitest';
import { computeCore } from '../core';
import { kzt, simpleNonVatPayerInput, simpleVatPayerInput } from './fixtures';

describe('ядро P&L: плательщик НДС', () => {
  const input = simpleVatPayerInput();
  const core = computeCore(input);

  it('выделяет НДС из цены предложения', () => {
    expect(core.revenue.grossMinor).toBe(kzt(1_160_000));
    expect(core.revenue.netMinor).toBe(kzt(1_000_000));
    expect(core.revenue.vatOutputMinor).toBe(kzt(160_000));
  });

  it('учитывает закупку без НДС, а входящий НДС ставит в зачёт', () => {
    expect(core.costs.directItemsNetMinor).toBe(kzt(600_000));
    expect(core.costs.vatInputTotalMinor).toBe(kzt(96_000));
    expect(core.costs.vatRecoverableMinor).toBe(kzt(96_000));
    expect(core.costs.vatNonRecoverableMinor).toBe(0);
  });

  it('не включает возмещаемый НДС в себестоимость', () => {
    expect(core.costs.totalMinor).toBe(kzt(600_000));
  });

  it('считает прибыль по цепочке валовая → операционная → до налога → чистая', () => {
    expect(core.profit.grossMinor).toBe(kzt(400_000));
    expect(core.profit.operatingMinor).toBe(kzt(400_000));
    expect(core.profit.preTaxMinor).toBe(kzt(400_000));
    // КПН 20 %
    expect(core.profit.incomeTaxMinor).toBe(kzt(80_000));
    expect(core.profit.netMinor).toBe(kzt(320_000));
  });

  it('считает НДС к уплате как исходящий минус зачёт', () => {
    expect(core.vat.payableMinor).toBe(kzt(160_000) - kzt(96_000));
  });

  it('соблюдает инвариант: выручка без НДС − полная себестоимость = прибыль до налога', () => {
    expect(core.revenue.netMinor - core.costs.totalMinor).toBe(
      core.profit.preTaxMinor,
    );
  });
});

describe('ядро P&L: НЕплательщик НДС', () => {
  const input = simpleNonVatPayerInput();
  const core = computeCore(input);

  it('не выделяет НДС из собственной цены — вся сумма является доходом', () => {
    expect(core.revenue.netMinor).toBe(kzt(1_160_000));
    expect(core.revenue.vatOutputMinor).toBe(0);
  });

  it('показывает входящий НДС поставщика отдельной суммой и относит его на расходы', () => {
    // поставщик-плательщик НДС всё равно предъявляет налог
    expect(core.costs.vatInputTotalMinor).toBe(kzt(96_000));
    expect(core.costs.vatRecoverableMinor).toBe(0);
    expect(core.costs.vatNonRecoverableMinor).toBe(kzt(96_000));
  });

  it('включает невозмещаемый НДС в полную себестоимость', () => {
    expect(core.costs.totalMinor).toBe(kzt(696_000));
  });

  it('даёт прибыль до налога = 1 160 000 − 696 000', () => {
    expect(core.profit.preTaxMinor).toBe(kzt(464_000));
  });

  it('соблюдает тот же инвариант', () => {
    expect(core.revenue.netMinor - core.costs.totalMinor).toBe(
      core.profit.preTaxMinor,
    );
  });
});

describe('специальный налоговый режим: налог с оборота', () => {
  it('считает налог от оборота, а не от прибыли', () => {
    const input = simpleNonVatPayerInput('SIMPLIFIED');
    const core = computeCore(input);
    expect(input.tax.incomeTaxBase).toBe('TURNOVER');
    // оборот 1 160 000 ₸ × 4 %
    expect(core.profit.incomeTaxMinor).toBe(kzt(46_400));
    expect(core.profit.netMinor).toBe(kzt(464_000) - kzt(46_400));
  });

  it('начисляет налог даже при убыточной сделке', () => {
    const input = simpleNonVatPayerInput('SIMPLIFIED');
    // поднимаем закупку выше цены продажи
    const loss = {
      ...input,
      costs: {
        ...input.costs,
        items: [
          {
            ...input.costs.items[0]!,
            unitCostMinor: kzt(1_500_000),
          },
        ],
      },
    };
    const core = computeCore(loss);
    expect(core.profit.preTaxMinor).toBeLessThan(0);
    // налог с оборота никуда не исчез
    expect(core.profit.incomeTaxMinor).toBe(kzt(46_400));
    expect(core.profit.netMinor).toBeLessThan(core.profit.preTaxMinor);
  });
});

describe('налог на доход при убытке на общем режиме', () => {
  it('не начисляет КПН при отрицательной прибыли', () => {
    const input = simpleVatPayerInput({
      costs: {
        ...simpleVatPayerInput().costs,
        items: [
          {
            label: 'Товар',
            quantity: 1,
            unitCostMinor: kzt(2_000_000),
            vatMode: 'INCLUSIVE',
            supplierChargesVat: true,
            verified: true,
          },
        ],
      },
    });
    const core = computeCore(input);
    expect(core.profit.preTaxMinor).toBeLessThan(0);
    expect(core.profit.incomeTaxMinor).toBe(0);
    expect(core.profit.netMinor).toBe(core.profit.preTaxMinor);
  });
});

describe('множитель затрат (используется сценариями)', () => {
  it('масштабирует затраты, но не выручку', () => {
    const input = simpleVatPayerInput();
    const base = computeCore(input);
    const stressed = computeCore(input, { costFactor: 1.1 });
    expect(stressed.revenue.netMinor).toBe(base.revenue.netMinor);
    expect(stressed.costs.directItemsNetMinor).toBe(
      Math.round(base.costs.directItemsNetMinor * 1.1),
    );
    expect(stressed.profit.netMinor).toBeLessThan(base.profit.netMinor);
  });
});

describe('цена, введённая без НДС', () => {
  it('начисляет НДС сверху и не меняет доход', () => {
    const input = simpleVatPayerInput();
    const exclusive = {
      ...input,
      tender: {
        ...input.tender,
        bidPriceMinor: kzt(1_000_000),
        bidPriceVatMode: 'EXCLUSIVE' as const,
      },
    };
    const core = computeCore(exclusive);
    expect(core.revenue.netMinor).toBe(kzt(1_000_000));
    expect(core.revenue.grossMinor).toBe(kzt(1_160_000));
    // доход и прибыль совпадают с вариантом «цена с НДС 1 160 000»
    expect(core.profit.netMinor).toBe(computeCore(input).profit.netMinor);
  });
});
