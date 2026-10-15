/**
 * Пустой набор входных данных финансовой модели.
 *
 * ВАЖНО: денежные значения здесь — нули и null, а не «типичные» цифры.
 * Движок не должен подсказывать выдуманные суммы: незаполненное поле
 * показывается пустым и попадает в список недостающих данных.
 */

import { buildTaxContext, TAX_CONFIG_VERSION } from './tax-config';
import type { FinanceInput, TaxRegimeCode } from './types';

export function createEmptyFinanceInput(params: {
  regime: TaxRegimeCode;
  isVatPayer: boolean;
  startPriceMinor?: number | null;
}): FinanceInput {
  return {
    tender: {
      startPriceMinor: params.startPriceMinor ?? null,
      bidPriceMinor: null,
      bidPriceVatMode: 'INCLUSIVE',
      startPriceVatMode: 'INCLUSIVE',
      currency: 'KZT',
    },
    tax: buildTaxContext({
      regime: params.regime,
      isVatPayer: params.isVatPayer,
      configVersion: TAX_CONFIG_VERSION,
    }),
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
      payroll: {
        grossPayrollMinor: 0,
        payrollTaxPercentOverride: null,
      },
      subcontractors: [],
      overhead: [],
      contingencyPercent: 0,
    },
    financing: {
      bankFeePercentOfRevenue: 0,
      bankFeeFixedMinor: 0,
      autoFinancePeakGap: false,
      loanAmountMinor: null,
      loanAnnualRatePercent: null,
      loanTermDays: null,
      ownCapitalOpportunityRatePercent: 0,
    },
    securities: {
      bid: {
        form: 'NONE',
        percentOfBase: null,
        amountMinor: null,
        guaranteeFeePercentAnnual: 0,
        guaranteeFeeFixedMinor: 0,
        heldDays: null,
      },
      performance: {
        form: 'NONE',
        percentOfBase: null,
        amountMinor: null,
        guaranteeFeePercentAnnual: 0,
        guaranteeFeeFixedMinor: 0,
        heldDays: null,
      },
    },
    schedule: {
      contractDurationDays: null,
      advancePercent: 0,
      advanceDay: 0,
      deliveryDay: null,
      paymentDelayDays: null,
      retentionPercent: 0,
      retentionReleaseDays: null,
      procurementPrepaymentPercent: 0,
      procurementStartDay: 0,
    },
    warranty: {
      months: null,
      reservePercentOfRevenue: 0,
    },
    targets: {
      targetNetProfitMinor: null,
      targetNetMarginPercent: null,
    },
  };
}
