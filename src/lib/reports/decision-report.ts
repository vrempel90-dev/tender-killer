/**
 * Сборка единого отчёта для принятия решения по тендеру.
 *
 * Отчёт собирается ТОЛЬКО из сохранённых данных: финансового расчёта,
 * результатов проверки документов, анализа договора и подтверждённых цен.
 * Отсутствующие блоки помечаются как незаполненные, а не домысливаются.
 */

export interface ReportMoney {
  minor: number | null;
}

export interface DecisionReportData {
  generatedAt: string;
  company: { name: string; bin: string | null; taxRegime: string };
  tender: {
    id: string;
    title: string;
    externalNumber: string | null;
    customerName: string | null;
    procurementType: string;
    stage: string;
    startPriceMinor: number | null;
    submissionDeadline: string | null;
    deliveryDeadline: string | null;
    sourceUrl: string | null;
  };
  /** Финансовый блок. null, если расчёт не сохранён. */
  finance: {
    modelName: string;
    calculatedAt: string;
    engineVersion: string;
    taxConfigVersion: string;
    bidPriceMinor: number | null;
    revenueNetMinor: number;
    revenueGrossMinor: number;
    totalCostMinor: number;
    grossProfitMinor: number;
    operatingProfitMinor: number;
    preTaxProfitMinor: number;
    incomeTaxMinor: number;
    netProfitMinor: number;
    netMarginRatio: number | null;
    roiRatio: number | null;
    roiAnnualizedRatio: number | null;
    breakEvenPriceMinor: number | null;
    workingCapitalMinor: number;
    peakGapDay: number | null;
    netCashMinor: number;
    profitVsCashDeltaMinor: number;
    vatPayableMinor: number;
    priceDropToZeroRatio: number | null;
    costIncreaseToZeroRatio: number | null;
    verifiedCostShareRatio: number | null;
    unverifiedCostMinor: number;
    warnings: Array<{ severity: string; message: string }>;
    missingInputs: Array<{ label: string; affects: string[] }>;
    scenarios: Array<{ label: string; netProfitMinor: number; workingCapitalMinor: number }>;
  } | null;
  /** Проверка документов. null, если проверка не выполнялась. */
  compliance: {
    runAt: string;
    model: string | null;
    byStatus: Record<string, number>;
    unreadableDocuments: string[];
    criticalFindings: Array<{
      requirementText: string;
      status: string;
      riskLevel: string;
      documentName: string | null;
      pageNumber: number | null;
      recommendation: string;
      uncertaintyReason: string | null;
    }>;
  } | null;
  /** Анализ договора. null, если не выполнялся. */
  contract: {
    runAt: string;
    documentName: string;
    extractedTerms: Record<string, number | null>;
    risksByLevel: Record<string, number>;
    needsLawyerReview: number;
    topRisks: Array<{
      title: string;
      category: string;
      clauseRef: string | null;
      riskLevel: string;
      explanation: string;
      recommendation: string | null;
    }>;
  } | null;
  /** Снабжение: подтверждённость закупочных цен. */
  sourcing: {
    lineItemsCount: number;
    itemsWithConfirmedPrice: number;
    confirmedPurchaseCostMinor: number;
    quotesCount: number;
    unverifiedQuotesCount: number;
  };
  /** Данные, которых не хватает для полноценного решения. */
  gaps: string[];
}

/**
 * Перечень того, чего не хватает отчёту. Это не предупреждения расчёта,
 * а именно пробелы в подготовке тендера.
 */
export function collectGaps(data: Omit<DecisionReportData, 'gaps'>): string[] {
  const gaps: string[] = [];

  if (!data.finance) {
    gaps.push(
      'Финансовый расчёт не сохранён — экономика сделки неизвестна. '
      + 'Выполните расчёт на странице «Экономика тендера».',
    );
  } else {
    if (data.finance.bidPriceMinor === null) {
      gaps.push('Не указана планируемая цена предложения.');
    }
    for (const missing of data.finance.missingInputs) {
      gaps.push(
        `Не заполнено: ${missing.label}. Без этого не рассчитываются: `
        + `${missing.affects.join(', ')}.`,
      );
    }
    if (
      data.finance.verifiedCostShareRatio !== null &&
      data.finance.verifiedCostShareRatio < 0.8
    ) {
      gaps.push(
        'Часть затрат не подтверждена документами поставщиков — расчёт опирается '
        + 'на непроверенные цены.',
      );
    }
  }

  if (!data.compliance) {
    gaps.push(
      'Проверка документов заявки не выполнялась — риск отклонения заявки '
      + 'не оценён.',
    );
  } else if (data.compliance.unreadableDocuments.length > 0) {
    gaps.push(
      `Не прочитано содержимое документов: ${data.compliance.unreadableDocuments.join(', ')}. `
      + 'По ним выводы не делались.',
    );
  }

  if (!data.contract) {
    gaps.push(
      'Проект договора не анализировался — договорные риски не оценены.',
    );
  }

  if (data.sourcing.lineItemsCount === 0) {
    gaps.push('Позиции закупки не заполнены.');
  } else if (data.sourcing.itemsWithConfirmedPrice < data.sourcing.lineItemsCount) {
    gaps.push(
      `Подтверждённые закупочные цены есть только у `
      + `${data.sourcing.itemsWithConfirmedPrice} из ${data.sourcing.lineItemsCount} позиций.`,
    );
  }

  if (data.tender.startPriceMinor === null) {
    gaps.push('Не указана начальная цена закупки.');
  }

  return gaps;
}

/**
 * Итоговая оценка по тендеру.
 *
 * ВАЖНО: это не вердикт и не гарантия. Оценка складывается из того, что
 * рассчитано и проверено; при пробелах в данных она честно сообщает, что
 * решение принимать рано.
 */
export type DecisionVerdict =
  | 'INSUFFICIENT_DATA'
  | 'NOT_RECOMMENDED'
  | 'RISKY'
  | 'ACCEPTABLE';

export interface DecisionSummary {
  verdict: DecisionVerdict;
  title: string;
  reasons: string[];
}

export function buildDecisionSummary(data: DecisionReportData): DecisionSummary {
  const reasons: string[] = [];

  if (!data.finance) {
    return {
      verdict: 'INSUFFICIENT_DATA',
      title: 'Решение принимать рано: экономика не рассчитана',
      reasons: [
        'Финансовый расчёт по тендеру не сохранён.',
        ...data.gaps.slice(0, 4),
      ],
    };
  }

  const finance = data.finance;

  // Убыточность — однозначное основание не участвовать.
  if (finance.netProfitMinor <= 0) {
    reasons.push(
      'По текущему расчёту сделка убыточна или даёт нулевой результат.',
    );
    if (finance.breakEvenPriceMinor !== null) {
      reasons.push(
        'Безубыточная цена выше планируемой — требуется либо снизить '
        + 'себестоимость, либо повысить цену предложения.',
      );
    }
    return {
      verdict: 'NOT_RECOMMENDED',
      title: 'Участие не рекомендуется: расчёт показывает убыток',
      reasons,
    };
  }

  const critical = finance.warnings.filter((w) => w.severity === 'CRITICAL');
  if (critical.length > 0) {
    reasons.push(...critical.map((w) => w.message));
  }

  // Критические замечания по документам: риск отклонения заявки.
  const notFound = data.compliance?.byStatus.NOT_FOUND ?? 0;
  const mismatch = data.compliance?.byStatus.MISMATCH ?? 0;
  if (notFound + mismatch > 0) {
    reasons.push(
      `По документам заявки выявлено замечаний: не обнаружено ${notFound}, `
      + `несоответствий ${mismatch}. Это риск отклонения заявки.`,
    );
  }

  const needsReview = data.compliance?.byStatus.NEEDS_REVIEW ?? 0;
  if (needsReview > 0) {
    reasons.push(
      `${needsReview} требований не проверены автоматически и нуждаются в `
      + 'проверке вручную.',
    );
  }

  // Договорные риски высокого уровня.
  const contractCritical =
    (data.contract?.risksByLevel.CRITICAL ?? 0) +
    (data.contract?.risksByLevel.HIGH ?? 0);
  if (contractCritical > 0) {
    reasons.push(
      `В проекте договора ${contractCritical} рисков высокого уровня.`,
    );
  }

  // Кассовый разрыв относительно прибыли.
  if (
    finance.workingCapitalMinor > 0 &&
    finance.workingCapitalMinor > finance.netProfitMinor * 5
  ) {
    reasons.push(
      'Потребность в оборотных средствах многократно превышает расчётную '
      + 'прибыль: сделка требует значительного отвлечения денег.',
    );
  }

  // Малый запас по цене.
  if (
    finance.priceDropToZeroRatio !== null &&
    finance.priceDropToZeroRatio < 0.05
  ) {
    reasons.push(
      'Запас по цене до убытка меньше 5 %: любое снижение цены на торгах '
      + 'делает сделку убыточной.',
    );
  }

  if (data.gaps.length > 3) {
    reasons.push(
      `Не хватает данных по ${data.gaps.length} пунктам — см. раздел о пробелах.`,
    );
  }

  const seriousCount =
    critical.length +
    (notFound + mismatch > 0 ? 1 : 0) +
    (contractCritical > 0 ? 1 : 0);

  if (seriousCount >= 2) {
    return {
      verdict: 'RISKY',
      title: 'Участие возможно, но риски высокие',
      reasons,
    };
  }

  if (reasons.length === 0) {
    reasons.push(
      'Расчёт показывает положительный результат, критических замечаний не '
      + 'выявлено.',
    );
  }

  return {
    verdict: seriousCount === 1 ? 'RISKY' : 'ACCEPTABLE',
    title:
      seriousCount === 1
        ? 'Участие возможно при устранении замечаний'
        : 'Экономика положительная, критических замечаний нет',
    reasons,
  };
}

export const VERDICT_LABELS: Record<DecisionVerdict, string> = {
  INSUFFICIENT_DATA: 'Недостаточно данных',
  NOT_RECOMMENDED: 'Не рекомендуется',
  RISKY: 'Высокий риск',
  ACCEPTABLE: 'Приемлемо',
};

export const DECISION_DISCLAIMER =
  'Отчёт сформирован автоматически на основании данных, внесённых '
  + 'пользователем, и содержимого загруженных документов. Он не является '
  + 'юридическим заключением, аудиторским мнением или гарантией допуска к '
  + 'закупке. Решение об участии принимает ответственное лицо компании.';
