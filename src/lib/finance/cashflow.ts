/**
 * Прогноз движения денежных средств.
 *
 * Главный принцип: ПРИБЫЛЬ ≠ ДЕНЕЖНЫЙ ПОТОК.
 * В потоке участвуют суммы с НДС, возвратные залоги (уходят и возвращаются),
 * платёж НДС в бюджет и фактические даты платежей. В прибыли — ничего из этого.
 */

import { percentOf, ratioMinor } from '../money';
import type { CoreComputation } from './core';
import type { CashflowPeriod, FinanceInput, WorkingCapitalResult } from './types';

interface CashEvent {
  day: number;
  label: string;
  amountMinor: number;
  kind: 'IN' | 'OUT';
}

export interface CashflowComputation {
  periods: CashflowPeriod[];
  netCashMinor: number;
  minCumulativeMinor: number;
  workingCapital: WorkingCapitalResult;
}

/**
 * Срок уплаты НДС в бюджет после сдачи работ. По НК РК НДС уплачивается по
 * итогам налогового периода (квартал) — для прогноза берём консервативные
 * 45 дней после даты реализации.
 */
const VAT_PAYMENT_LAG_DAYS = 45;
/** Срок уплаты налога на доход после завершения проекта (для прогноза). */
const INCOME_TAX_LAG_DAYS = 90;

export function computeCashflow(
  input: FinanceInput,
  core: CoreComputation,
  options: { paymentDelayAddDays?: number } = {},
): CashflowComputation {
  const events: CashEvent[] = [];
  const { schedule, securities } = input;

  const deliveryDay =
    schedule.deliveryDay ?? schedule.contractDurationDays ?? 0;
  const paymentDelay =
    (schedule.paymentDelayDays ?? 0) + (options.paymentDelayAddDays ?? 0);

  // ── Обеспечение заявки: уходит до начала, возвращается после подведения итогов
  if (core.bidSecurity.frozenCashMinor > 0) {
    events.push({
      day: 0,
      label: 'Внесение обеспечения заявки (возвратное)',
      amountMinor: core.bidSecurity.frozenCashMinor,
      kind: 'OUT',
    });
    events.push({
      day: core.bidSecurity.heldDays,
      label: 'Возврат обеспечения заявки',
      amountMinor: core.bidSecurity.frozenCashMinor,
      kind: 'IN',
    });
  }
  if (securities.bid.form === 'BANK_GUARANTEE' && core.bidSecurity.costMinor > 0) {
    events.push({
      day: 0,
      label: 'Комиссия за банковскую гарантию по заявке',
      amountMinor: core.bidSecurity.costMinor,
      kind: 'OUT',
    });
  }

  // ── Обеспечение исполнения договора
  if (core.performanceSecurity.frozenCashMinor > 0) {
    events.push({
      day: 1,
      label: 'Внесение обеспечения исполнения договора (возвратное)',
      amountMinor: core.performanceSecurity.frozenCashMinor,
      kind: 'OUT',
    });
    events.push({
      day: Math.max(1, core.performanceSecurity.heldDays),
      label: 'Возврат обеспечения исполнения договора',
      amountMinor: core.performanceSecurity.frozenCashMinor,
      kind: 'IN',
    });
  }
  if (
    securities.performance.form === 'BANK_GUARANTEE' &&
    core.performanceSecurity.costMinor > 0
  ) {
    events.push({
      day: 1,
      label: 'Комиссия за банковскую гарантию исполнения',
      amountMinor: core.performanceSecurity.costMinor,
      kind: 'OUT',
    });
  }

  // ── Поступления от заказчика (с НДС!)
  const retentionMinor = percentOf(
    core.revenue.grossMinor,
    schedule.retentionPercent,
  );
  const advanceMinor = percentOf(core.revenue.grossMinor, schedule.advancePercent);
  if (advanceMinor > 0) {
    events.push({
      day: schedule.advanceDay,
      label: `Аванс заказчика ${schedule.advancePercent} % (с НДС)`,
      amountMinor: advanceMinor,
      kind: 'IN',
    });
  }
  const finalPaymentMinor = core.revenue.grossMinor - advanceMinor - retentionMinor;
  if (finalPaymentMinor !== 0) {
    events.push({
      day: deliveryDay + paymentDelay,
      label: `Оплата после подписания акта (с НДС), задержка ${paymentDelay} дн.`,
      amountMinor: finalPaymentMinor,
      kind: 'IN',
    });
  }
  if (retentionMinor > 0) {
    events.push({
      day: deliveryDay + (schedule.retentionReleaseDays ?? paymentDelay),
      label: `Возврат гарантийного удержания ${schedule.retentionPercent} %`,
      amountMinor: retentionMinor,
      kind: 'IN',
    });
  }

  // ── Оплата поставщикам: закупки оплачиваются с НДС
  const purchaseGrossMinor =
    core.costs.directItemsNetMinor +
    core.costs.otherDirectNetMinor +
    core.costs.logisticsNetMinor +
    core.costs.subcontractorsNetMinor +
    core.costs.vatInputTotalMinor -
    core.aggregated.importVatMinor;

  const prepayMinor = percentOf(purchaseGrossMinor, schedule.procurementPrepaymentPercent);
  if (prepayMinor > 0) {
    events.push({
      day: schedule.procurementStartDay,
      label: `Предоплата поставщикам ${schedule.procurementPrepaymentPercent} % (с НДС)`,
      amountMinor: prepayMinor,
      kind: 'OUT',
    });
  }
  const postpayMinor = purchaseGrossMinor - prepayMinor;
  if (postpayMinor > 0) {
    events.push({
      day: Math.max(schedule.procurementStartDay, deliveryDay),
      label: 'Оплата поставщикам по факту поставки (с НДС)',
      amountMinor: postpayMinor,
      kind: 'OUT',
    });
  }

  // ── Таможня: платится на границе, одной суммой
  const customsCashMinor =
    core.costs.customsMinor + core.aggregated.importVatMinor;
  if (customsCashMinor > 0) {
    events.push({
      day: schedule.procurementStartDay,
      label: 'Таможенные платежи, включая НДС на импорт',
      amountMinor: customsCashMinor,
      kind: 'OUT',
    });
  }

  // ── ФОТ: распределяется равномерно по сроку исполнения (месяцами)
  const payrollTotal = core.costs.payrollMinor + core.costs.payrollTaxesMinor;
  if (payrollTotal > 0) {
    const months = Math.max(1, Math.ceil(Math.max(deliveryDay, 1) / 30));
    const perMonth = ratioMinor(payrollTotal, 1, months);
    for (let m = 1; m <= months; m += 1) {
      const amount = m === months ? payrollTotal - perMonth * (months - 1) : perMonth;
      events.push({
        day: Math.min(m * 30, Math.max(deliveryDay, 30)),
        label: `Выплата ФОТ и налогов с ФОТ, месяц ${m}`,
        amountMinor: amount,
        kind: 'OUT',
      });
    }
  }

  // ── Накладные расходы: равномерно
  const overheadCash =
    core.costs.overheadNetMinor + core.costs.contingencyMinor;
  if (overheadCash > 0) {
    events.push({
      day: Math.max(1, Math.round(deliveryDay / 2)),
      label: 'Накладные расходы и резерв (середина срока)',
      amountMinor: overheadCash,
      kind: 'OUT',
    });
  }

  // ── Банковские комиссии
  if (core.costs.bankFeesMinor > 0) {
    events.push({
      day: deliveryDay + paymentDelay,
      label: 'Банковские комиссии с поступлений',
      amountMinor: core.costs.bankFeesMinor,
      kind: 'OUT',
    });
  }

  // ── НДС в бюджет: исходящий минус зачёт
  if (core.vat.payableMinor > 0) {
    events.push({
      day: deliveryDay + VAT_PAYMENT_LAG_DAYS,
      label: 'Уплата НДС в бюджет (исходящий − зачёт)',
      amountMinor: core.vat.payableMinor,
      kind: 'OUT',
    });
  } else if (core.vat.payableMinor < 0) {
    events.push({
      day: deliveryDay + VAT_PAYMENT_LAG_DAYS,
      label: 'Превышение зачёта по НДС (переносится на следующий период, не возврат)',
      amountMinor: 0,
      kind: 'IN',
    });
  }

  // ── Налог на доход
  if (core.profit.incomeTaxMinor > 0) {
    events.push({
      day: deliveryDay + INCOME_TAX_LAG_DAYS,
      label: 'Уплата налога на доход',
      amountMinor: core.profit.incomeTaxMinor,
      kind: 'OUT',
    });
  }

  // ── Проценты по кредиту
  if (core.financingCostMinor > 0) {
    events.push({
      day: Math.max(1, deliveryDay),
      label: 'Проценты по заёмным средствам',
      amountMinor: core.financingCostMinor,
      kind: 'OUT',
    });
  }

  // ── Стоимость замороженных собственных средств не является денежным
  //    оттоком: это альтернативная доходность. В ДДС не включаем,
  //    в P&L — включаем.

  // ── Сборка периодов
  const byDay = new Map<number, CashflowPeriod>();
  for (const e of events) {
    if (e.amountMinor === 0) continue;
    const day = Math.max(0, Math.round(e.day));
    let period = byDay.get(day);
    if (!period) {
      period = {
        day,
        label: `День ${day}`,
        inflowMinor: 0,
        outflowMinor: 0,
        netMinor: 0,
        cumulativeMinor: 0,
        entries: [],
      };
      byDay.set(day, period);
    }
    if (e.kind === 'IN') {
      period.inflowMinor += e.amountMinor;
    } else {
      period.outflowMinor += e.amountMinor;
    }
    period.entries.push({ label: e.label, amountMinor: e.amountMinor, kind: e.kind });
  }

  const periods = [...byDay.values()].sort((a, b) => a.day - b.day);
  let cumulative = 0;
  let minCumulative = 0;
  let peakGapDay: number | null = null;
  let daysInDeficit = 0;
  let previousDay = 0;

  for (const p of periods) {
    p.netMinor = p.inflowMinor - p.outflowMinor;
    cumulative += p.netMinor;
    p.cumulativeMinor = cumulative;
    if (cumulative < minCumulative) {
      minCumulative = cumulative;
      peakGapDay = p.day;
    }
    if (cumulative < 0) {
      daysInDeficit += Math.max(0, p.day - previousDay);
    }
    previousDay = p.day;
  }

  const frozenSecurities =
    core.bidSecurity.frozenCashMinor + core.performanceSecurity.frozenCashMinor;

  const workingCapital: WorkingCapitalResult = {
    requirementMinor: Math.abs(minCumulative),
    peakGapMinor: minCumulative,
    peakGapDay,
    frozenSecuritiesMinor: frozenSecurities,
    daysInDeficit,
  };

  return {
    periods,
    netCashMinor: cumulative,
    minCumulativeMinor: minCumulative,
    workingCapital,
  };
}
