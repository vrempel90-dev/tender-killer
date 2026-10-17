import { describe, expect, it } from 'vitest';
import { calculateFinance } from '../engine';
import { createEmptyFinanceInput } from '../defaults';
import { kzt, realisticTenderInput, simpleNonVatPayerInput, simpleVatPayerInput } from './fixtures';

describe('движок: итоговый расчёт', () => {
  const result = calculateFinance(realisticTenderInput());

  it('возвращает версию движка и версию налогового конфига', () => {
    expect(result.engineVersion).toBe('1.1.1');
    expect(result.taxConfigVersion).toBe('2026.01-KZ');
  });

  it('считает рентабельность продаж от выручки без НДС', () => {
    expect(result.margins.netRatio).not.toBeNull();
    expect(result.margins.netRatio).toBeCloseTo(
      result.profit.netMinor / result.revenue.netMinor,
      10,
    );
  });

  it('ROI считается от пиковой потребности в собственных средствах, а не от выручки', () => {
    expect(result.roi.investedCapitalMinor).toBe(
      result.workingCapital.requirementMinor,
    );
    expect(result.roi.ratio).toBeCloseTo(
      result.profit.netMinor / result.workingCapital.requirementMinor,
      10,
    );
    // ROI и рентабельность продаж — разные величины
    expect(result.roi.ratio).not.toBe(result.margins.netRatio);
  });

  it('приводит ROI к годовой доходности через срок проекта', () => {
    const days = 60 + 30; // срок + отсрочка оплаты
    expect(result.roi.annualizedRatio).toBeCloseTo(
      result.roi.ratio! * (365 / days),
      8,
    );
  });

  it('находит безубыточную цену ниже планируемой', () => {
    expect(result.breakEven.solved).toBe(true);
    expect(result.breakEven.priceMinor!).toBeLessThan(kzt(46_000_000));
    expect(result.breakEven.marginOverBreakEvenRatio!).toBeGreaterThan(0);
  });

  it('считает цену под целевую маржу 8 %', () => {
    expect(result.targetPrice.basis).toBe('MARGIN_PERCENT');
    expect(result.targetPrice.solved).toBe(true);
    expect(result.targetPrice.priceMinor).not.toBeNull();
  });

  it('разделяет прибыль и денежный поток и показывает расхождение', () => {
    expect(result.cashflow.profitVsCashDeltaMinor).toBe(
      result.profit.netMinor - result.cashflow.netCashMinor,
    );
    expect(result.cashflow.profitVsCashDeltaMinor).not.toBe(0);
  });

  it('автоматически считает стоимость кредита из кассового разрыва', () => {
    expect(result.costs.financingCostMinor).toBeGreaterThan(0);
    const explanation = result.explanations.find((e) => e.key === 'financingCost');
    expect(explanation).toBeDefined();
    expect(explanation!.formula).toContain('дни использования ÷ 365');
  });

  it('выдаёт расшифровку формул для всех ключевых показателей', () => {
    const keys = result.explanations.map((e) => e.key);
    for (const key of [
      'revenueNet',
      'totalCost',
      'grossProfit',
      'operatingProfit',
      'incomeTax',
      'netProfit',
      'netMargin',
      'roi',
      'vatPayable',
      'workingCapital',
      'breakEven',
    ]) {
      expect(keys).toContain(key);
    }
    // в каждой расшифровке есть формула и подстановка значений
    for (const e of result.explanations) {
      expect(e.formula.length).toBeGreaterThan(5);
      expect(e.substitution.length).toBeGreaterThan(0);
      expect(e.meaning.length).toBeGreaterThan(5);
    }
  });

  it('считает чувствительность к снижению цены и росту затрат', () => {
    expect(result.sensitivity.priceDrop.length).toBeGreaterThan(0);
    expect(result.sensitivity.costIncrease.length).toBeGreaterThan(0);
    // прибыль падает при снижении цены
    const rows = result.sensitivity.priceDrop;
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i]!.netProfitMinor!).toBeLessThan(rows[i - 1]!.netProfitMinor!);
    }
    expect(result.sensitivity.priceDropToZeroRatio).not.toBeNull();
    expect(result.sensitivity.priceDropToZeroRatio!).toBeGreaterThan(0);
    expect(result.sensitivity.priceDropToZeroRatio!).toBeLessThan(1);
  });

  it('сообщает о доле затрат без подтверждающих документов', () => {
    expect(result.verifiedCostShareRatio).not.toBeNull();
    expect(result.verifiedCostShareRatio!).toBeGreaterThan(0);
    expect(result.verifiedCostShareRatio!).toBeLessThan(1);
    expect(result.unverifiedCostMinor).toBeGreaterThan(0);
  });

  it('предупреждает о кассовом разрыве и замороженных обеспечениях', () => {
    const codes = result.warnings.map((w) => w.code);
    expect(codes).toContain('CASH_GAP');
    expect(codes).toContain('SECURITIES_FROZEN');
  });
});

describe('движок: честность по отношению к незаполненным данным', () => {
  it('на пустом вводе перечисляет недостающие поля и не выдумывает суммы', () => {
    const empty = createEmptyFinanceInput({
      regime: 'GENERAL_VAT',
      isVatPayer: true,
    });
    const result = calculateFinance(empty);

    const fields = result.missingInputs.map((m) => m.field);
    expect(fields).toContain('tender.bidPriceMinor');
    expect(fields).toContain('tender.startPriceMinor');
    expect(fields).toContain('schedule.contractDurationDays');
    expect(fields).toContain('costs');

    // все денежные показатели нулевые, а не «примерные»
    expect(result.revenue.grossMinor).toBe(0);
    expect(result.costs.totalMinor).toBe(0);
    expect(result.profit.netMinor).toBe(0);
    // производные показатели не рассчитаны
    expect(result.margins.netRatio).toBeNull();
    expect(result.roi.ratio).toBeNull();
    expect(result.sensitivity.priceDrop).toHaveLength(0);
  });

  it('каждое недостающее поле объясняет, на что оно влияет', () => {
    const result = calculateFinance(
      createEmptyFinanceInput({ regime: 'GENERAL_VAT', isVatPayer: true }),
    );
    for (const m of result.missingInputs) {
      expect(m.label.length).toBeGreaterThan(3);
      expect(m.affects.length).toBeGreaterThan(0);
    }
  });
});

describe('движок: предупреждения о типичных ошибках', () => {
  it('предупреждает неплательщика НДС о невозмещаемом входящем НДС', () => {
    const result = calculateFinance(simpleNonVatPayerInput());
    const w = result.warnings.find((x) => x.code === 'VAT_INPUT_NOT_RECOVERABLE');
    expect(w).toBeDefined();
    expect(w!.severity).toBe('CRITICAL');
  });

  it('предупреждает о налоге с оборота на СНР', () => {
    const result = calculateFinance(simpleNonVatPayerInput('SIMPLIFIED'));
    const w = result.warnings.find((x) => x.code === 'TURNOVER_TAX');
    expect(w).toBeDefined();
  });

  it('помечает критичным налог с оборота при убыточной сделке', () => {
    const base = simpleNonVatPayerInput('SIMPLIFIED');
    const loss = {
      ...base,
      costs: {
        ...base.costs,
        items: [{ ...base.costs.items[0]!, unitCostMinor: kzt(2_000_000) }],
      },
    };
    const result = calculateFinance(loss);
    const w = result.warnings.find((x) => x.code === 'TURNOVER_TAX');
    expect(w!.severity).toBe('CRITICAL');
  });

  it('предупреждает, если цена предложения выше начальной цены закупки', () => {
    const base = simpleVatPayerInput();
    const tooHigh = {
      ...base,
      tender: { ...base.tender, bidPriceMinor: kzt(2_000_000) },
    };
    const result = calculateFinance(tooHigh);
    expect(result.warnings.map((w) => w.code)).toContain('BID_ABOVE_START_PRICE');
  });

  it('предупреждает об отсутствии резерва на непредвиденные расходы', () => {
    const result = calculateFinance(simpleVatPayerInput());
    expect(result.warnings.map((w) => w.code)).toContain('NO_CONTINGENCY');
  });
});
