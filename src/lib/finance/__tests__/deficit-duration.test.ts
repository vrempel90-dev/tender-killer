import { expect, it } from 'vitest';
import { computeCashflow } from '../cashflow';
import { computeCore } from '../core';
import { calculateFinance } from '../engine';
import { createEmptyFinanceInput } from '../defaults';
import { interestMinor } from '../../money';

function delayedPaymentInput() {
  const input = createEmptyFinanceInput({ regime: 'GENERAL_NO_VAT', isVatPayer: false });
  input.tender.bidPriceMinor = 100_000;
  input.costs.items = [{ label: 'Synthetic cost', quantity: 1, unitCostMinor: 50_000, vatMode: 'INCLUSIVE', supplierChargesVat: false, verified: true }];
  input.schedule.contractDurationDays = 10;
  input.schedule.paymentDelayDays = 20;
  input.schedule.procurementPrepaymentPercent = 100;
  input.schedule.procurementStartDay = 0;
  input.schedule.advancePercent = 0;
  return input;
}
it('counts the interval from supplier outflow through the day the customer clears the deficit', () => {
  const input = delayedPaymentInput();
  const cashflow = computeCashflow(input, computeCore(input));
  expect(cashflow.workingCapital.daysInDeficit).toBe(30);
  expect(cashflow.workingCapital.requirementMinor).toBe(50_000);
});
it('automatic financing includes payment delay rather than falling back to contract duration', () => {
  const input = delayedPaymentInput();
  input.financing.autoFinancePeakGap = true;
  input.financing.loanAnnualRatePercent = 36.5;
  const result = calculateFinance(input, { skipSensitivity: true });
  expect(result.costs.financingCostMinor).toBe(interestMinor(50_000, 36.5, 30));
});
