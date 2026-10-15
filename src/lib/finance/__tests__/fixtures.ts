/**
 * Фикстуры для тестов финансового движка.
 * Числа подобраны так, чтобы результат можно было проверить вручную.
 */

import { createEmptyFinanceInput } from '../defaults';
import type { FinanceInput, TaxRegimeCode } from '../types';

/** 1 ₸ = 100 тиын. Хелпер для читаемости тестов. */
export const kzt = (major: number): number => Math.round(major * 100);

/**
 * Базовый случай, который считается на бумаге:
 *  • плательщик НДС, ставка 16 %, КПН 20 %;
 *  • цена предложения 1 160 000 ₸ с НДС → 1 000 000 ₸ без НДС, НДС 160 000 ₸;
 *  • закупка 696 000 ₸ с НДС → 600 000 ₸ без НДС, входящий НДС 96 000 ₸;
 *  • никаких прочих затрат.
 */
export function simpleVatPayerInput(
  overrides: Partial<FinanceInput> = {},
): FinanceInput {
  const base = createEmptyFinanceInput({
    regime: 'GENERAL_VAT',
    isVatPayer: true,
    startPriceMinor: kzt(1_300_000),
  });
  return {
    ...base,
    ...overrides,
    tender: {
      ...base.tender,
      bidPriceMinor: kzt(1_160_000),
      bidPriceVatMode: 'INCLUSIVE',
      ...overrides.tender,
    },
    costs: {
      ...base.costs,
      items: [
        {
          label: 'Товар',
          quantity: 1,
          unitCostMinor: kzt(696_000),
          vatMode: 'INCLUSIVE',
          supplierChargesVat: true,
          verified: true,
        },
      ],
      ...overrides.costs,
    },
  };
}

/** Тот же тендер, но компания — не плательщик НДС. */
export function simpleNonVatPayerInput(regime: TaxRegimeCode = 'GENERAL_NO_VAT'): FinanceInput {
  const base = createEmptyFinanceInput({
    regime,
    isVatPayer: false,
    startPriceMinor: kzt(1_300_000),
  });
  return {
    ...base,
    tender: {
      ...base.tender,
      bidPriceMinor: kzt(1_160_000),
      bidPriceVatMode: 'INCLUSIVE',
    },
    costs: {
      ...base.costs,
      items: [
        {
          label: 'Товар',
          quantity: 1,
          unitCostMinor: kzt(696_000),
          vatMode: 'INCLUSIVE',
          supplierChargesVat: true,
          verified: true,
        },
      ],
    },
  };
}

/**
 * Реалистичный тендер на поставку оборудования: с обеспечениями,
 * задержкой оплаты, предоплатой поставщику и кредитом.
 */
export function realisticTenderInput(): FinanceInput {
  const base = createEmptyFinanceInput({
    regime: 'GENERAL_VAT',
    isVatPayer: true,
    startPriceMinor: kzt(50_000_000),
  });
  return {
    ...base,
    tender: {
      ...base.tender,
      bidPriceMinor: kzt(46_000_000),
      bidPriceVatMode: 'INCLUSIVE',
    },
    costs: {
      ...base.costs,
      items: [
        {
          label: 'Ноутбук, 100 шт.',
          quantity: 100,
          unitCostMinor: kzt(348_000),
          unit: 'шт',
          vatMode: 'INCLUSIVE',
          supplierChargesVat: true,
          verified: true,
        },
      ],
      logistics: [
        {
          label: 'Доставка по Казахстану',
          amountMinor: kzt(580_000),
          vatMode: 'INCLUSIVE',
          supplierChargesVat: true,
          verified: true,
        },
      ],
      payroll: {
        grossPayrollMinor: kzt(1_200_000),
        payrollTaxPercentOverride: null,
      },
      overhead: [
        {
          label: 'Офис, связь, транспорт',
          amountMinor: kzt(300_000),
          vatMode: 'EXCLUSIVE',
          supplierChargesVat: false,
          verified: false,
        },
      ],
      contingencyPercent: 3,
    },
    financing: {
      ...base.financing,
      bankFeePercentOfRevenue: 0.3,
      bankFeeFixedMinor: kzt(15_000),
      autoFinancePeakGap: true,
      loanAnnualRatePercent: 22,
      loanTermDays: null,
      ownCapitalOpportunityRatePercent: 14,
    },
    securities: {
      bid: {
        form: 'CASH_DEPOSIT',
        percentOfBase: 1,
        amountMinor: null,
        guaranteeFeePercentAnnual: 0,
        guaranteeFeeFixedMinor: 0,
        heldDays: 45,
      },
      performance: {
        form: 'BANK_GUARANTEE',
        percentOfBase: 3,
        amountMinor: null,
        guaranteeFeePercentAnnual: 5,
        guaranteeFeeFixedMinor: kzt(25_000),
        heldDays: 120,
      },
    },
    schedule: {
      contractDurationDays: 60,
      advancePercent: 0,
      advanceDay: 0,
      deliveryDay: 50,
      paymentDelayDays: 30,
      retentionPercent: 0,
      retentionReleaseDays: null,
      procurementPrepaymentPercent: 50,
      procurementStartDay: 5,
    },
    warranty: {
      months: 12,
      reservePercentOfRevenue: 1,
    },
    targets: {
      targetNetProfitMinor: null,
      targetNetMarginPercent: 8,
    },
  };
}
