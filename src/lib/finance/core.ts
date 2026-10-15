/**
 * Ядро P&L: расчёт выручки, себестоимости и прибыли для ЗАДАННОЙ цены.
 *
 * Выделено отдельно от главного движка, потому что используется многократно:
 * поиском безубыточной цены, целевой цены и анализом чувствительности.
 * Здесь нет прогноза ДДС — он зависит от результата этого расчёта.
 */

import { percentOf, mulMinor, interestMinor, assertMinorFields } from '../money';
import { aggregateCosts, type AggregatedCosts } from './costs';
import { computeSecurity, type SecurityComputation } from './securities';
import { splitVat, splitVatInput } from './vat';
import type {
  CostBreakdown,
  FinanceInput,
  ProfitBreakdown,
  RevenueBreakdown,
  VatSettlement,
} from './types';


export interface CoreComputation {
  revenue: RevenueBreakdown;
  costs: CostBreakdown;
  profit: ProfitBreakdown;
  vat: VatSettlement;
  aggregated: AggregatedCosts;
  bidSecurity: SecurityComputation;
  performanceSecurity: SecurityComputation;
  /** Прямые затраты без НДС (товары, логистика, таможня, субподряд, прочие прямые). */
  directCostNetMinor: number;
  /** Использованная стоимость финансирования. */
  financingCostMinor: number;
  /** Сумма кредита, принятая в расчёт. */
  loanAmountUsedMinor: number;
}

export interface CoreOptions {
  /**
   * Цена предложения, переопределяющая input.tender.bidPriceMinor.
   * Используется решателями (безубыточность, целевая цена, чувствительность).
   */
  bidPriceOverrideMinor?: number;
  /** Множитель всех затрат (сценарии и чувствительность). */
  costFactor?: number;
  /**
   * Готовая стоимость финансирования, тиын. Нужна, когда кредит считается
   * автоматически из кассового разрыва: разрыв зависит от P&L, поэтому
   * вычисляется снаружи и подставляется сюда.
   */
  financingCostOverrideMinor?: number;
  /** Сумма автоматически рассчитанного кредита (для отчёта). */
  autoLoanAmountMinor?: number;
}

/** Выручка с учётом налогового статуса поставщика. */
export function computeRevenue(
  bidPriceMinor: number,
  input: FinanceInput,
): RevenueBreakdown {
  const { tax, tender } = input;
  const split = splitVat(
    bidPriceMinor,
    tender.bidPriceVatMode,
    tax.vatRatePercent,
    tax.isVatPayer,
  );
  return {
    grossMinor: split.grossMinor,
    netMinor: split.netMinor,
    vatOutputMinor: split.vatMinor,
  };
}

/** Срок, на который привлекаются заёмные средства. */
function resolveLoanTermDays(input: FinanceInput): number {
  return (
    input.financing.loanTermDays ??
    input.schedule.contractDurationDays ??
    0
  );
}

export function computeCore(
  input: FinanceInput,
  options: CoreOptions = {},
): CoreComputation {
  const costFactor = options.costFactor ?? 1;
  const bidPrice = options.bidPriceOverrideMinor ?? input.tender.bidPriceMinor ?? 0;

  const revenue = computeRevenue(bidPrice, input);

  // ── Затраты ──────────────────────────────────────────────────────────────
  const aggregated = aggregateCosts(input.costs, input.tax);

  const scale = (v: number) => mulMinor(v, costFactor);

  const itemsNet = scale(aggregated.items.netMinor);
  const otherDirectNet = scale(aggregated.otherDirect.netMinor);
  const logisticsNet = scale(aggregated.logistics.netMinor);
  const customsDuty = scale(aggregated.customsDutyMinor);
  const customsFeesNet = scale(aggregated.customsFeesNetMinor);
  const payroll = scale(aggregated.payrollMinor);
  const payrollTaxes = scale(aggregated.payrollTaxesMinor);
  const subcontractorsNet = scale(aggregated.subcontractors.netMinor);
  const overheadNet = scale(aggregated.overhead.netMinor);
  const vatInputTotal = scale(aggregated.vatInputTotalMinor);

  const baseNet =
    itemsNet +
    otherDirectNet +
    logisticsNet +
    customsDuty +
    customsFeesNet +
    payroll +
    payrollTaxes +
    subcontractorsNet +
    overheadNet;

  const contingency = percentOf(baseNet, input.costs.contingencyPercent);

  const { recoverableMinor, nonRecoverableMinor } = splitVatInput(
    vatInputTotal,
    input.tax.isVatPayer,
    input.tax.vatRecoverySharePercent,
  );

  // ── Обеспечения ──────────────────────────────────────────────────────────
  const bidSecurity = computeSecurity(
    input.securities.bid,
    input.tender.startPriceMinor,
    input.financing.ownCapitalOpportunityRatePercent,
  );
  const performanceSecurity = computeSecurity(
    input.securities.performance,
    revenue.grossMinor,
    input.financing.ownCapitalOpportunityRatePercent,
  );
  const securityCost = bidSecurity.costMinor + performanceSecurity.costMinor;

  // ── Банковские расходы и финансирование ──────────────────────────────────
  const bankFees =
    percentOf(revenue.grossMinor, input.financing.bankFeePercentOfRevenue) +
    input.financing.bankFeeFixedMinor;

  let financingCost: number;
  let loanAmountUsed: number;
  if (options.financingCostOverrideMinor !== undefined) {
    financingCost = options.financingCostOverrideMinor;
    loanAmountUsed = options.autoLoanAmountMinor ?? 0;
  } else {
    loanAmountUsed = input.financing.loanAmountMinor ?? 0;
    const rate = input.financing.loanAnnualRatePercent ?? 0;
    const days = resolveLoanTermDays(input);
    financingCost = interestMinor(loanAmountUsed, rate, days);
  }

  const warrantyReserve = percentOf(
    revenue.netMinor,
    input.warranty.reservePercentOfRevenue,
  );

  // ── Прибыль ──────────────────────────────────────────────────────────────
  const directCostNet =
    itemsNet + otherDirectNet + logisticsNet + customsDuty + customsFeesNet + subcontractorsNet;

  const grossProfit = revenue.netMinor - directCostNet;

  const operatingProfit =
    grossProfit -
    payroll -
    payrollTaxes -
    overheadNet -
    contingency -
    nonRecoverableMinor -
    bankFees -
    warrantyReserve;

  const preTaxProfit = operatingProfit - financingCost - securityCost;

  // Налог на доход: от прибыли (КПН/ИПН) либо от оборота (СНР).
  let incomeTax: number;
  if (input.tax.incomeTaxBase === 'TURNOVER') {
    // На СНР налог платится с дохода (оборота) независимо от прибыли.
    incomeTax = percentOf(revenue.netMinor, input.tax.incomeTaxRatePercent);
  } else {
    incomeTax =
      preTaxProfit > 0
        ? percentOf(preTaxProfit, input.tax.incomeTaxRatePercent)
        : 0;
  }

  const netProfit = preTaxProfit - incomeTax;

  const totalCost =
    directCostNet +
    payroll +
    payrollTaxes +
    overheadNet +
    contingency +
    nonRecoverableMinor +
    bankFees +
    financingCost +
    securityCost +
    warrantyReserve;

  const costs: CostBreakdown = {
    directItemsNetMinor: itemsNet,
    otherDirectNetMinor: otherDirectNet,
    logisticsNetMinor: logisticsNet,
    customsMinor: customsDuty + customsFeesNet,
    payrollMinor: payroll,
    payrollTaxesMinor: payrollTaxes,
    subcontractorsNetMinor: subcontractorsNet,
    overheadNetMinor: overheadNet,
    contingencyMinor: contingency,
    vatInputTotalMinor: vatInputTotal,
    vatRecoverableMinor: recoverableMinor,
    vatNonRecoverableMinor: nonRecoverableMinor,
    bankFeesMinor: bankFees,
    financingCostMinor: financingCost,
    securityCostMinor: securityCost,
    warrantyReserveMinor: warrantyReserve,
    totalMinor: totalCost,
  };

  const profit: ProfitBreakdown = {
    grossMinor: grossProfit,
    operatingMinor: operatingProfit,
    preTaxMinor: preTaxProfit,
    incomeTaxMinor: incomeTax,
    netMinor: netProfit,
  };

  const vat: VatSettlement = {
    outputMinor: revenue.vatOutputMinor,
    recoverableInputMinor: recoverableMinor,
    payableMinor: revenue.vatOutputMinor - recoverableMinor,
  };

  const result = {
    revenue,
    costs,
    profit,
    vat,
    aggregated,
    bidSecurity,
    performanceSecurity,
    directCostNetMinor: directCostNet,
    financingCostMinor: financingCost,
    loanAmountUsedMinor: loanAmountUsed,
  };
  assertMinorFields(result);
  return result;
}

/** Чистая прибыль при заданной цене — рабочая функция для решателей. */
export function netProfitAtPrice(
  input: FinanceInput,
  bidPriceMinor: number,
  options: Omit<CoreOptions, 'bidPriceOverrideMinor'> = {},
): number {
  return computeCore(input, { ...options, bidPriceOverrideMinor: bidPriceMinor })
    .profit.netMinor;
}
