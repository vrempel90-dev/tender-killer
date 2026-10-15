/**
 * Агрегация затрат: суммы без НДС отдельно от входящего НДС.
 */

import { percentOf } from '../money';
import { splitVat } from './vat';
import type { CostsInput, ItemCostLine, SimpleCostLine, TaxContextInput } from './types';

export interface CostGroupTotals {
  netMinor: number;
  vatInputMinor: number;
  /** Сумма, подтверждённая документом. */
  verifiedNetMinor: number;
  /** Сумма без подтверждения. */
  unverifiedNetMinor: number;
}

const EMPTY: CostGroupTotals = {
  netMinor: 0,
  vatInputMinor: 0,
  verifiedNetMinor: 0,
  unverifiedNetMinor: 0,
};

function addGroup(a: CostGroupTotals, b: CostGroupTotals): CostGroupTotals {
  return {
    netMinor: a.netMinor + b.netMinor,
    vatInputMinor: a.vatInputMinor + b.vatInputMinor,
    verifiedNetMinor: a.verifiedNetMinor + b.verifiedNetMinor,
    unverifiedNetMinor: a.unverifiedNetMinor + b.unverifiedNetMinor,
  };
}

function lineTotals(
  amountMinor: number,
  line: Pick<SimpleCostLine, 'vatMode' | 'supplierChargesVat' | 'verified'>,
  vatRatePercent: number,
): CostGroupTotals {
  const split = splitVat(
    amountMinor,
    line.vatMode,
    vatRatePercent,
    line.supplierChargesVat,
  );
  return {
    netMinor: split.netMinor,
    vatInputMinor: split.vatMinor,
    verifiedNetMinor: line.verified ? split.netMinor : 0,
    unverifiedNetMinor: line.verified ? 0 : split.netMinor,
  };
}

export function sumSimpleCosts(
  lines: SimpleCostLine[],
  vatRatePercent: number,
): CostGroupTotals {
  return lines.reduce(
    (acc, line) => addGroup(acc, lineTotals(line.amountMinor, line, vatRatePercent)),
    EMPTY,
  );
}

export function sumItemCosts(
  items: ItemCostLine[],
  vatRatePercent: number,
): CostGroupTotals {
  return items.reduce((acc, item) => {
    const amount = Math.round(item.quantity * item.unitCostMinor);
    return addGroup(acc, lineTotals(amount, item, vatRatePercent));
  }, EMPTY);
}

export interface AggregatedCosts {
  items: CostGroupTotals;
  otherDirect: CostGroupTotals;
  logistics: CostGroupTotals;
  /** Пошлина и сборы; пошлина в зачёт по НДС не принимается. */
  customsDutyMinor: number;
  customsFeesNetMinor: number;
  customsFeesVatMinor: number;
  /** НДС на импорт — отдельный платёж на границе. */
  importVatMinor: number;
  payrollMinor: number;
  payrollTaxesMinor: number;
  subcontractors: CostGroupTotals;
  overhead: CostGroupTotals;
  /** Все суммы без НДС до резерва на непредвиденные расходы. */
  baseNetMinor: number;
  /** Весь входящий НДС по затратам, включая НДС на импорт. */
  vatInputTotalMinor: number;
  contingencyMinor: number;
  verifiedNetMinor: number;
  unverifiedNetMinor: number;
}

/**
 * Полная агрегация затрат по входным данным.
 * ФОТ и налоги с ФОТ НДС не содержат.
 */
export function aggregateCosts(
  costs: CostsInput,
  tax: TaxContextInput,
): AggregatedCosts {
  // Для затрат применяется ставка, по которой НДС выставляют поставщики,
  // а не ставка собственной реализации.
  const rate = tax.purchaseVatRatePercent;

  const items = sumItemCosts(costs.items, rate);
  const otherDirect = sumSimpleCosts(costs.otherDirect, rate);
  const logistics = sumSimpleCosts(costs.logistics, rate);
  const subcontractors = sumSimpleCosts(costs.subcontractors, rate);
  const overhead = sumSimpleCosts(costs.overhead, rate);

  const customsFees = costs.customs.isImport
    ? splitVat(
        costs.customs.feesMinor,
        costs.customs.feesVatMode,
        rate,
        costs.customs.feesSupplierChargesVat,
      )
    : { netMinor: 0, vatMinor: 0, grossMinor: 0 };

  const customsDutyMinor = costs.customs.isImport ? costs.customs.dutyMinor : 0;
  const importVatMinor = costs.customs.isImport ? costs.customs.importVatMinor : 0;

  const payrollMinor = costs.payroll.grossPayrollMinor;
  const payrollTaxPercent =
    costs.payroll.payrollTaxPercentOverride ?? tax.payrollTaxPercent;
  const payrollTaxesMinor = percentOf(payrollMinor, payrollTaxPercent);

  const baseNetMinor =
    items.netMinor +
    otherDirect.netMinor +
    logistics.netMinor +
    customsDutyMinor +
    customsFees.netMinor +
    payrollMinor +
    payrollTaxesMinor +
    subcontractors.netMinor +
    overhead.netMinor;

  const vatInputTotalMinor =
    items.vatInputMinor +
    otherDirect.vatInputMinor +
    logistics.vatInputMinor +
    customsFees.vatMinor +
    subcontractors.vatInputMinor +
    overhead.vatInputMinor +
    importVatMinor;

  const contingencyMinor = percentOf(baseNetMinor, costs.contingencyPercent);

  const verifiedNetMinor =
    items.verifiedNetMinor +
    otherDirect.verifiedNetMinor +
    logistics.verifiedNetMinor +
    subcontractors.verifiedNetMinor +
    overhead.verifiedNetMinor;

  const unverifiedNetMinor =
    items.unverifiedNetMinor +
    otherDirect.unverifiedNetMinor +
    logistics.unverifiedNetMinor +
    subcontractors.unverifiedNetMinor +
    overhead.unverifiedNetMinor;

  return {
    items,
    otherDirect,
    logistics,
    customsDutyMinor,
    customsFeesNetMinor: customsFees.netMinor,
    customsFeesVatMinor: customsFees.vatMinor,
    importVatMinor,
    payrollMinor,
    payrollTaxesMinor,
    subcontractors,
    overhead,
    baseNetMinor,
    vatInputTotalMinor,
    contingencyMinor,
    verifiedNetMinor,
    unverifiedNetMinor,
  };
}
