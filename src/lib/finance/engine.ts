/**
 * Главный финансовый движок TENDER KILLER.
 *
 * Отвечает на вопросы «сколько реально заработаем» и «где кассовый разрыв».
 * Принципы, заложенные в расчёт:
 *  1. Прибыль ≠ денежный поток. Считаются и показываются отдельно.
 *  2. Возвратный залог — не расход. Расход — только стоимость денег/гарантии.
 *  3. Входящий НДС возмещается только у плательщика НДС, и только в части зачёта.
 *  4. На СНР налог считается с ОБОРОТА, поэтому убыточная сделка всё равно
 *     создаёт налоговое обязательство.
 *  5. Незаполненные данные не подменяются «разумными» значениями — показатель
 *     помечается как нерасчитываемый.
 */

import { safeDiv, mulMinor, interestMinor, percentOf } from '../money';
import { computeCashflow } from './cashflow';
import { computeCore, type CoreComputation } from './core';
import { computeSensitivity } from './sensitivity';
import { solveBreakEvenPrice, solvePriceForNetProfit } from './solver';
import { formatMinorKzt, formatRatioAsPercent } from '../money';
import type {
  CalcWarning,
  FinanceInput,
  FinanceResult,
  FormulaExplanation,
  MissingInput,
} from './types';

export const ENGINE_VERSION = '1.1.1';
const DAYS_IN_YEAR = 365;

export interface CalculateOptions {
  /** Множитель затрат (используется сценариями). */
  costFactor?: number;
  /** Дополнительная задержка оплаты, дней (используется сценариями). */
  paymentDelayAddDays?: number;
  /** Отключить тяжёлые блоки (чувствительность) — для массовых пересчётов. */
  skipSensitivity?: boolean;
}

export function calculateFinance(
  input: FinanceInput,
  options: CalculateOptions = {},
): FinanceResult {
  const costFactor = options.costFactor ?? 1;

  // ── Проход 1: расчёт без автоматического кредита ──────────────────────────
  const firstPass = computeCore(input, {
    costFactor,
    financingCostOverrideMinor: input.financing.autoFinancePeakGap
      ? 0
      : undefined,
  });
  const firstCashflow = computeCashflow(input, firstPass, {
    paymentDelayAddDays: options.paymentDelayAddDays,
  });

  // ── Автоматический расчёт потребности в заёмных средствах ────────────────
  let financingCostOverrideMinor: number | undefined;
  let autoLoanAmountMinor = 0;
  let autoLoanDays = 0;
  if (input.financing.autoFinancePeakGap) {
    const rate = input.financing.loanAnnualRatePercent ?? 0;
    autoLoanAmountMinor = firstCashflow.workingCapital.requirementMinor;
    autoLoanDays =
      input.financing.loanTermDays ??
      (firstCashflow.workingCapital.daysInDeficit > 0
        ? firstCashflow.workingCapital.daysInDeficit
        : (input.schedule.contractDurationDays ?? 0));
    financingCostOverrideMinor = interestMinor(autoLoanAmountMinor, rate, autoLoanDays);
  }

  // ── Проход 2: окончательный расчёт ───────────────────────────────────────
  const core: CoreComputation = input.financing.autoFinancePeakGap
    ? computeCore(input, {
        costFactor,
        financingCostOverrideMinor,
        autoLoanAmountMinor,
      })
    : firstPass;

  const cashflow = input.financing.autoFinancePeakGap
    ? computeCashflow(input, core, {
        paymentDelayAddDays: options.paymentDelayAddDays,
      })
    : firstCashflow;

  // ── Рентабельность ───────────────────────────────────────────────────────
  const margins = {
    grossRatio: safeDiv(core.profit.grossMinor, core.revenue.netMinor),
    operatingRatio: safeDiv(core.profit.operatingMinor, core.revenue.netMinor),
    netRatio: safeDiv(core.profit.netMinor, core.revenue.netMinor),
    netOnGrossRatio: safeDiv(core.profit.netMinor, core.revenue.grossMinor),
  };

  // ── ROI ──────────────────────────────────────────────────────────────────
  // Инвестированный капитал = максимальная сумма собственных средств,
  // которую нужно вложить в проект: пиковый кассовый разрыв.
  // Замороженные залоги уже участвуют в разрыве как оттоки.
  const investedCapitalMinor =
    cashflow.workingCapital.requirementMinor > 0
      ? cashflow.workingCapital.requirementMinor
      : null;
  const roiRatio = investedCapitalMinor
    ? safeDiv(core.profit.netMinor, investedCapitalMinor)
    : null;
  const projectDays =
    input.schedule.contractDurationDays !== null
      ? input.schedule.contractDurationDays +
        (input.schedule.paymentDelayDays ?? 0)
      : null;
  const annualizedRatio =
    roiRatio !== null && projectDays !== null && projectDays > 0
      ? roiRatio * (DAYS_IN_YEAR / projectDays)
      : null;

  // ── Безубыточная и целевая цена ──────────────────────────────────────────
  const breakEvenSolve = solveBreakEvenPrice(input, {
    costFactor,
    financingCostOverrideMinor,
  });
  const currentPrice = input.tender.bidPriceMinor;
  const breakEven = {
    priceMinor: breakEvenSolve.priceMinor,
    marginOverBreakEvenRatio:
      breakEvenSolve.priceMinor !== null && currentPrice !== null && currentPrice > 0
        ? safeDiv(currentPrice - breakEvenSolve.priceMinor, currentPrice)
        : null,
    maxDiscountFromStartRatio:
      breakEvenSolve.priceMinor !== null &&
      input.tender.startPriceMinor !== null &&
      input.tender.startPriceMinor > 0
        ? safeDiv(
            input.tender.startPriceMinor - breakEvenSolve.priceMinor,
            input.tender.startPriceMinor,
          )
        : null,
    solved: breakEvenSolve.solved,
    note: breakEvenSolve.note,
  };

  const targetNetProfitMinor = resolveTargetProfit(input, core.revenue.netMinor);
  const targetSolve =
    targetNetProfitMinor !== null
      ? solvePriceForNetProfit(input, targetNetProfitMinor, {
          costFactor,
          financingCostOverrideMinor,
        })
      : null;
  const targetPrice = {
    priceMinor: targetSolve?.priceMinor ?? null,
    basis:
      input.targets.targetNetProfitMinor !== null
        ? ('PROFIT_AMOUNT' as const)
        : input.targets.targetNetMarginPercent !== null
          ? ('MARGIN_PERCENT' as const)
          : null,
    targetNetProfitMinor,
    solved: targetSolve?.solved ?? false,
    note: targetSolve?.note,
  };

  // ── Чувствительность ─────────────────────────────────────────────────────
  const sensitivity = options.skipSensitivity
    ? {
        priceDrop: [],
        costIncrease: [],
        priceDropToZeroRatio: null,
        costIncreaseToZeroRatio: null,
      }
    : computeSensitivity(input, { financingCostOverrideMinor });

  // ── Подтверждённость затрат ──────────────────────────────────────────────
  const verifiedShare = safeDiv(
    core.aggregated.verifiedNetMinor,
    core.aggregated.verifiedNetMinor + core.aggregated.unverifiedNetMinor,
  );

  const result: FinanceResult = {
    engineVersion: ENGINE_VERSION,
    taxConfigVersion: input.tax.configVersion,
    calculatedAt: new Date().toISOString(),
    revenue: core.revenue,
    costs: core.costs,
    profit: core.profit,
    vat: core.vat,
    margins,
    roi: {
      investedCapitalMinor,
      ratio: roiRatio,
      annualizedRatio,
    },
    breakEven,
    targetPrice,
    workingCapital: cashflow.workingCapital,
    cashflow: {
      periods: cashflow.periods,
      netCashMinor: cashflow.netCashMinor,
      minCumulativeMinor: cashflow.minCumulativeMinor,
      profitVsCashDeltaMinor: core.profit.netMinor - cashflow.netCashMinor,
    },
    sensitivity,
    explanations: buildExplanations(input, core, cashflow, {
      roiRatio,
      investedCapitalMinor,
      autoLoanAmountMinor,
      autoLoanDays,
    }),
    missingInputs: collectMissingInputs(input),
    warnings: collectWarnings(input, core, cashflow),
    verifiedCostShareRatio: verifiedShare,
    unverifiedCostMinor: mulMinor(core.aggregated.unverifiedNetMinor, costFactor),
  };

  return result;
}

function resolveTargetProfit(
  input: FinanceInput,
  revenueNetMinor: number,
): number | null {
  if (input.targets.targetNetProfitMinor !== null) {
    return input.targets.targetNetProfitMinor;
  }
  if (input.targets.targetNetMarginPercent !== null && revenueNetMinor > 0) {
    return percentOf(revenueNetMinor, input.targets.targetNetMarginPercent);
  }
  return null;
}

// ─────────────────────────── Расшифровка формул ──────────────────────────────

function buildExplanations(
  input: FinanceInput,
  core: CoreComputation,
  cashflow: ReturnType<typeof computeCashflow>,
  extra: {
    roiRatio: number | null;
    investedCapitalMinor: number | null;
    autoLoanAmountMinor: number;
    autoLoanDays: number;
  },
): FormulaExplanation[] {
  const m = (v: number | null | undefined) => formatMinorKzt(v);
  const rate = input.tax.vatRatePercent;
  const list: FormulaExplanation[] = [];

  list.push({
    key: 'revenueNet',
    label: 'Выручка без НДС',
    formula: input.tax.isVatPayer
      ? input.tender.bidPriceVatMode === 'INCLUSIVE'
        ? 'Выручка без НДС = Цена предложения ÷ (1 + ставка НДС)'
        : 'Выручка без НДС = Цена предложения (НДС начисляется сверху)'
      : 'Выручка без НДС = Цена предложения (компания не является плательщиком НДС)',
    substitution: input.tax.isVatPayer
      ? `${m(core.revenue.grossMinor)} ÷ (1 + ${rate} %) = ${m(core.revenue.netMinor)}`
      : `${m(core.revenue.grossMinor)} = ${m(core.revenue.netMinor)}`,
    meaning:
      'Доход компании. НДС в выручке — не доход, это сумма, которую вы собираете '
      + 'для бюджета.',
    caveat: input.tax.isVatPayer
      ? undefined
      : 'Неплательщик НДС не выделяет НДС из своей цены и не ставит входящий НДС в зачёт.',
  });

  list.push({
    key: 'totalCost',
    label: 'Полная себестоимость исполнения',
    formula:
      'Полная себестоимость = Прямые затраты + ФОТ + налоги с ФОТ + накладные '
      + '+ резерв + невозмещаемый НДС + банковские комиссии + проценты по займу '
      + '+ стоимость обеспечений + гарантийный резерв',
    substitution:
      `${m(core.directCostNetMinor)} + ${m(core.costs.payrollMinor)} + `
      + `${m(core.costs.payrollTaxesMinor)} + ${m(core.costs.overheadNetMinor)} + `
      + `${m(core.costs.contingencyMinor)} + ${m(core.costs.vatNonRecoverableMinor)} + `
      + `${m(core.costs.bankFeesMinor)} + ${m(core.costs.financingCostMinor)} + `
      + `${m(core.costs.securityCostMinor)} + ${m(core.costs.warrantyReserveMinor)} = `
      + `${m(core.costs.totalMinor)}`,
    meaning: 'Всё, что проект реально стоит компании.',
    caveat:
      'Сами суммы обеспечения заявки и исполнения договора здесь НЕ учитываются: '
      + 'они возвратные. Учтена только их стоимость (комиссия банка или стоимость '
      + 'замороженных денег).',
  });

  list.push({
    key: 'grossProfit',
    label: 'Валовая прибыль',
    formula: 'Валовая прибыль = Выручка без НДС − Прямые затраты без НДС',
    substitution: `${m(core.revenue.netMinor)} − ${m(core.directCostNetMinor)} = ${m(core.profit.grossMinor)}`,
    meaning:
      'Сколько остаётся после закупки товара, логистики, таможни и субподряда — '
      + 'до расходов на персонал и накладных.',
  });

  list.push({
    key: 'operatingProfit',
    label: 'Операционная прибыль',
    formula:
      'Операционная прибыль = Валовая прибыль − ФОТ − налоги с ФОТ − накладные '
      + '− резерв − невозмещаемый НДС − банковские комиссии − гарантийный резерв',
    substitution:
      `${m(core.profit.grossMinor)} − ${m(core.costs.payrollMinor)} − `
      + `${m(core.costs.payrollTaxesMinor)} − ${m(core.costs.overheadNetMinor)} − `
      + `${m(core.costs.contingencyMinor)} − ${m(core.costs.vatNonRecoverableMinor)} − `
      + `${m(core.costs.bankFeesMinor)} − ${m(core.costs.warrantyReserveMinor)} = `
      + `${m(core.profit.operatingMinor)}`,
    meaning: 'Результат основной деятельности по проекту до финансовых расходов.',
  });

  list.push({
    key: 'incomeTax',
    label: 'Налог на доход',
    formula:
      input.tax.incomeTaxBase === 'TURNOVER'
        ? 'Налог = Оборот (выручка без НДС) × ставка СНР'
        : 'Налог = max(0; Прибыль до налогообложения) × ставка КПН/ИПН',
    substitution:
      input.tax.incomeTaxBase === 'TURNOVER'
        ? `${m(core.revenue.netMinor)} × ${input.tax.incomeTaxRatePercent} % = ${m(core.profit.incomeTaxMinor)}`
        : `max(0; ${m(core.profit.preTaxMinor)}) × ${input.tax.incomeTaxRatePercent} % = ${m(core.profit.incomeTaxMinor)}`,
    meaning:
      input.tax.incomeTaxBase === 'TURNOVER'
        ? 'На специальном налоговом режиме налог платится с оборота.'
        : 'Налог платится с прибыли; при убытке налог на доход равен нулю.',
    caveat:
      input.tax.incomeTaxBase === 'TURNOVER'
        ? 'ВАЖНО: убыточная сделка на СНР всё равно создаёт налог к уплате, '
          + 'потому что база — оборот, а не прибыль.'
        : undefined,
  });

  list.push({
    key: 'netProfit',
    label: 'Расчётная чистая прибыль',
    formula:
      'Чистая прибыль = Операционная прибыль − проценты по займу '
      + '− стоимость обеспечений − налог на доход',
    substitution:
      `${m(core.profit.operatingMinor)} − ${m(core.costs.financingCostMinor)} − `
      + `${m(core.costs.securityCostMinor)} − ${m(core.profit.incomeTaxMinor)} = `
      + `${m(core.profit.netMinor)}`,
    meaning: 'Финансовый результат сделки.',
    caveat:
      'Это НЕ деньги на счёте. Денежный результат смотрите в прогнозе ДДС: '
      + `итоговый поток ${m(cashflow.netCashMinor)}, расхождение с прибылью `
      + `${m(core.profit.netMinor - cashflow.netCashMinor)} возникает из-за НДС, `
      + 'залогов и сроков платежей.',
  });

  list.push({
    key: 'netMargin',
    label: 'Рентабельность продаж',
    formula: 'Рентабельность продаж = Чистая прибыль ÷ Выручка без НДС',
    substitution: `${m(core.profit.netMinor)} ÷ ${m(core.revenue.netMinor)} = ${formatRatioAsPercent(safeDiv(core.profit.netMinor, core.revenue.netMinor))}`,
    meaning: 'Сколько копеек чистой прибыли приносит каждый тенге дохода.',
  });

  list.push({
    key: 'roi',
    label: 'ROI (возврат на вложенный капитал)',
    formula: 'ROI = Чистая прибыль ÷ Инвестированный капитал',
    substitution:
      extra.investedCapitalMinor !== null
        ? `${m(core.profit.netMinor)} ÷ ${m(extra.investedCapitalMinor)} = ${formatRatioAsPercent(extra.roiRatio)}`
        : 'Не рассчитывается: по прогнозу ДДС собственные средства в проект не вкладываются '
          + '(кассового разрыва нет).',
    meaning:
      'Инвестированным капиталом считается пиковая потребность в собственных '
      + 'средствах по прогнозу ДДС — максимум накопленного дефицита, включая '
      + 'замороженные обеспечения и предоплату поставщикам.',
    caveat:
      'ROI не равен рентабельности продаж: он измеряет отдачу на вложенные деньги, '
      + 'а не на оборот. Приведённая к году доходность рассчитывается как '
      + 'ROI × 365 ÷ срок проекта.',
  });

  list.push({
    key: 'vatPayable',
    label: 'НДС к уплате в бюджет',
    formula: 'НДС к уплате = НДС с реализации − НДС, принятый в зачёт',
    substitution: `${m(core.vat.outputMinor)} − ${m(core.vat.recoverableInputMinor)} = ${m(core.vat.payableMinor)}`,
    meaning:
      'Этот платёж не является расходом (он не уменьшает прибыль), но забирает '
      + 'деньги из оборота — поэтому учтён в прогнозе ДДС.',
    caveat: input.tax.isVatPayer
      ? `В зачёт принято ${input.tax.vatRecoverySharePercent} % входящего НДС. `
        + `Невозмещаемая часть ${m(core.costs.vatNonRecoverableMinor)} отнесена на затраты.`
      : 'Компания не плательщик НДС: весь входящий НДС '
        + `(${m(core.costs.vatInputTotalMinor)}) является расходом и не возмещается.`,
  });

  list.push({
    key: 'workingCapital',
    label: 'Потребность в оборотном капитале и пиковый кассовый разрыв',
    formula:
      'Потребность = |минимум накопленного денежного потока| по дням проекта',
    substitution:
      `минимум накопленного потока ${m(cashflow.minCumulativeMinor)}`
      + (cashflow.workingCapital.peakGapDay !== null
        ? ` наступает на день ${cashflow.workingCapital.peakGapDay}`
        : ''),
    meaning:
      'Столько денег нужно иметь или привлечь, чтобы дотянуть до оплаты от '
      + 'заказчика. Из них заморожено в обеспечениях '
      + `${m(cashflow.workingCapital.frozenSecuritiesMinor)} — эта сумма возвращается.`,
    caveat:
      `Дней в дефиците: ${cashflow.workingCapital.daysInDeficit}. `
      + 'Оплата от заказчика поступает с НДС, а закупки оплачиваются тоже с НДС — '
      + 'в потоке участвуют суммы с налогом, в отличие от расчёта прибыли.',
  });

  if (input.financing.autoFinancePeakGap) {
    list.push({
      key: 'financingCost',
      label: 'Стоимость финансирования',
      formula:
        'Проценты = Сумма кредита × годовая ставка × дни использования ÷ 365',
      substitution:
        `${m(extra.autoLoanAmountMinor)} × ${input.financing.loanAnnualRatePercent ?? 0} % × `
        + `${extra.autoLoanDays} ÷ 365 = ${m(core.costs.financingCostMinor)}`,
      meaning:
        'Сумма кредита определена автоматически как пиковый кассовый разрыв '
        + 'по прогнозу ДДС.',
      caveat:
        'Расчёт итеративный: сначала считается разрыв без кредита, затем на эту '
        + 'сумму начисляются проценты. Проценты, в свою очередь, немного '
        + 'увеличивают разрыв — это уточнение второго порядка и в расчёт не '
        + 'заводится, чтобы результат оставался проверяемым.',
    });
  }

  list.push({
    key: 'breakEven',
    label: 'Минимальная безубыточная цена',
    formula:
      'Цена, при которой чистая прибыль = 0. Находится численно: от цены зависят '
      + 'одновременно выручка, банковская комиссия, обеспечение исполнения, '
      + 'гарантийный резерв и налог.',
    substitution: `решение: ${m(core.profit.netMinor === 0 ? core.revenue.grossMinor : null)}`,
    meaning:
      'Ниже этой цены сделка убыточна. Если режим — СНР, безубыточная цена выше, '
      + 'чем кажется: налог платится с оборота.',
    caveat:
      'Стоимость финансирования при поиске цены фиксируется на уровне базового '
      + 'расчёта и не пересчитывается на каждой итерации.',
  });

  return list;
}

// ──────────────────── Незаполненные данные и предупреждения ──────────────────

export function collectMissingInputs(input: FinanceInput): MissingInput[] {
  const missing: MissingInput[] = [];
  if (input.costs.unpricedItems?.length) missing.push({ field: 'costs.unpricedItems',
    label: `Нет допустимой подтверждённой цены: ${input.costs.unpricedItems.join(', ')}`,
    affects: ['Полная себестоимость', 'Прибыль', 'ROI', 'Безубыточная цена'] });

  if (input.tender.bidPriceMinor === null) {
    missing.push({
      field: 'tender.bidPriceMinor',
      label: 'Планируемая цена предложения',
      affects: ['Выручка', 'Прибыль', 'Рентабельность', 'ROI', 'Чувствительность'],
    });
  }
  if (input.tender.startPriceMinor === null) {
    missing.push({
      field: 'tender.startPriceMinor',
      label: 'Начальная стоимость тендера',
      affects: [
        'Обеспечение заявки (если задано в процентах)',
        'Максимально допустимое снижение цены',
      ],
    });
  }
  if (input.schedule.contractDurationDays === null) {
    missing.push({
      field: 'schedule.contractDurationDays',
      label: 'Срок исполнения контракта',
      affects: ['Прогноз ДДС', 'Приведённая к году доходность', 'Стоимость кредита'],
    });
  }
  if (input.schedule.paymentDelayDays === null) {
    missing.push({
      field: 'schedule.paymentDelayDays',
      label: 'Срок поступления оплаты после подписания акта',
      affects: ['Пиковый кассовый разрыв', 'Потребность в оборотном капитале'],
    });
  }
  if (
    input.financing.autoFinancePeakGap &&
    input.financing.loanAnnualRatePercent === null
  ) {
    missing.push({
      field: 'financing.loanAnnualRatePercent',
      label: 'Годовая ставка по заёмным средствам',
      affects: ['Стоимость финансирования', 'Чистая прибыль'],
    });
  }
  const hasAnyCost =
    input.costs.items.length > 0 ||
    input.costs.otherDirect.length > 0 ||
    input.costs.logistics.length > 0 ||
    input.costs.subcontractors.length > 0 ||
    input.costs.overhead.length > 0 ||
    input.costs.payroll.grossPayrollMinor > 0;
  if (!hasAnyCost) {
    missing.push({
      field: 'costs',
      label: 'Себестоимость исполнения (товары, работы, услуги)',
      affects: [
        'Полная себестоимость',
        'Все виды прибыли',
        'Безубыточная цена',
        'Чувствительность',
      ],
    });
  }
  return missing;
}

function collectWarnings(
  input: FinanceInput,
  core: CoreComputation,
  cashflow: ReturnType<typeof computeCashflow>,
): CalcWarning[] {
  const warnings: CalcWarning[] = [];
  const m = (v: number) => formatMinorKzt(v);

  if (!input.tax.isVatPayer && input.tender.bidPriceVatMode === 'INCLUSIVE') {
    warnings.push({
      code: 'VAT_MODE_FOR_NON_PAYER',
      severity: 'WARNING',
      message:
        'Компания не является плательщиком НДС, но цена помечена как «с НДС». '
        + 'НДС из цены не выделяется: вся сумма считается доходом. Проверьте, '
        + 'не требует ли заказчик указывать цену с НДС.',
    });
  }

  if (!input.tax.isVatPayer && core.costs.vatInputTotalMinor > 0) {
    warnings.push({
      code: 'VAT_INPUT_NOT_RECOVERABLE',
      severity: 'CRITICAL',
      message:
        `Входящий НДС ${m(core.costs.vatInputTotalMinor)} не принимается в зачёт, `
        + 'потому что компания не плательщик НДС. Эта сумма — реальный расход, '
        + 'она включена в себестоимость.',
    });
  }

  if (
    input.tax.isVatPayer &&
    input.tax.vatRecoverySharePercent < 100 &&
    core.costs.vatNonRecoverableMinor > 0
  ) {
    warnings.push({
      code: 'VAT_PARTIAL_RECOVERY',
      severity: 'WARNING',
      message:
        `В зачёт принимается только ${input.tax.vatRecoverySharePercent} % входящего НДС. `
        + `Невозмещаемая часть ${m(core.costs.vatNonRecoverableMinor)} отнесена на затраты.`,
    });
  }

  if (input.tax.incomeTaxBase === 'TURNOVER') {
    warnings.push({
      code: 'TURNOVER_TAX',
      severity: core.profit.preTaxMinor <= 0 ? 'CRITICAL' : 'INFO',
      message:
        `Налог на доход считается с оборота по ставке ${input.tax.incomeTaxRatePercent} % `
        + `и составляет ${m(core.profit.incomeTaxMinor)}. `
        + (core.profit.preTaxMinor <= 0
          ? 'Сделка убыточна до налога, но налог с оборота всё равно придётся заплатить.'
          : 'Он не уменьшается при снижении прибыли.'),
    });
  }

  if (cashflow.workingCapital.requirementMinor > 0) {
    warnings.push({
      code: 'CASH_GAP',
      severity:
        core.profit.netMinor > 0 &&
        cashflow.workingCapital.requirementMinor > core.profit.netMinor * 3
          ? 'CRITICAL'
          : 'WARNING',
      message:
        `Пиковый кассовый разрыв ${m(cashflow.workingCapital.requirementMinor)}`
        + (cashflow.workingCapital.peakGapDay !== null
          ? ` на день ${cashflow.workingCapital.peakGapDay}`
          : '')
        + `. Дней в дефиците: ${cashflow.workingCapital.daysInDeficit}. `
        + 'Эти деньги нужно иметь или привлечь, иначе исполнить договор не получится, '
        + 'даже если сделка прибыльная.',
    });
  }

  if (core.profit.netMinor > 0 && cashflow.netCashMinor < 0) {
    warnings.push({
      code: 'PROFIT_BUT_NEGATIVE_CASH',
      severity: 'CRITICAL',
      message:
        'Проект прибыльный по расчёту, но итоговый денежный поток отрицательный. '
        + 'Проверьте гарантийные удержания, сроки оплаты и невозврат обеспечений.',
    });
  }

  if (cashflow.workingCapital.frozenSecuritiesMinor > 0) {
    warnings.push({
      code: 'SECURITIES_FROZEN',
      severity: 'INFO',
      message:
        `В обеспечениях заморожено ${m(cashflow.workingCapital.frozenSecuritiesMinor)}. `
        + 'Это возвратная сумма: расходом является только стоимость денег за срок '
        + `блокировки (${m(core.costs.securityCostMinor)}).`,
    });
  }

  if (input.costs.contingencyPercent === 0) {
    warnings.push({
      code: 'NO_CONTINGENCY',
      severity: 'WARNING',
      message:
        'Резерв на непредвиденные расходы не заложен. Для тендеров с длительным '
        + 'сроком исполнения это основная причина убытка.',
    });
  }

  const unverifiedShare = safeDiv(
    core.aggregated.unverifiedNetMinor,
    core.aggregated.verifiedNetMinor + core.aggregated.unverifiedNetMinor,
  );
  if (unverifiedShare !== null && unverifiedShare > 0.3) {
    warnings.push({
      code: 'UNVERIFIED_COSTS',
      severity: 'WARNING',
      message:
        `${formatRatioAsPercent(unverifiedShare)} затрат введены без подтверждающего `
        + 'документа (КП, счёт, прайс). Расчёт опирается на непроверенные цены.',
    });
  }

  if (
    input.tender.startPriceMinor !== null &&
    input.tender.bidPriceMinor !== null &&
    input.tender.bidPriceMinor > input.tender.startPriceMinor
  ) {
    warnings.push({
      code: 'BID_ABOVE_START_PRICE',
      severity: 'CRITICAL',
      message:
        'Цена предложения выше начальной цены закупки. В большинстве процедур такая '
        + 'заявка отклоняется.',
    });
  }

  if (input.schedule.advancePercent > 0 && input.schedule.advanceDay > 30) {
    warnings.push({
      code: 'LATE_ADVANCE',
      severity: 'INFO',
      message:
        `Аванс поступает на ${input.schedule.advanceDay}-й день — до этого момента `
        + 'закупка финансируется собственными средствами.',
    });
  }

  return warnings;
}
