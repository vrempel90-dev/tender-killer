/**
 * Загрузка данных отчёта из БД. Доступ фильтруется по компании вызывающей стороной.
 */

import { prisma } from '../db';
import { selectedPriceForFinance } from '../sourcing/to-finance';
import { mulMinor } from '../money';
import { TAX_REGIME_LABELS } from '../finance/tax-config';
import {
  collectGaps,
  type DecisionReportData,
} from './decision-report';
import { PROCUREMENT_TYPE_LABELS, TENDER_STAGE_LABELS } from '../tender-labels';

interface SavedFinanceResult {
  calculatedAt?: string;
  engineVersion?: string;
  taxConfigVersion?: string;
  revenue?: { netMinor?: number; grossMinor?: number };
  costs?: { totalMinor?: number };
  profit?: {
    grossMinor?: number;
    operatingMinor?: number;
    preTaxMinor?: number;
    incomeTaxMinor?: number;
    netMinor?: number;
  };
  margins?: { netRatio?: number | null };
  roi?: { ratio?: number | null; annualizedRatio?: number | null };
  breakEven?: { priceMinor?: number | null };
  workingCapital?: { requirementMinor?: number; peakGapDay?: number | null };
  cashflow?: { netCashMinor?: number; profitVsCashDeltaMinor?: number };
  vat?: { payableMinor?: number };
  sensitivity?: {
    priceDropToZeroRatio?: number | null;
    costIncreaseToZeroRatio?: number | null;
  };
  verifiedCostShareRatio?: number | null;
  unverifiedCostMinor?: number;
  warnings?: Array<{ severity?: string; message?: string }>;
  missingInputs?: Array<{ label?: string; affects?: string[] }>;
}

interface SavedFinanceInputs {
  tender?: { bidPriceMinor?: number | null };
}

export async function buildDecisionReport(params: {
  tenderId: string;
  companyId: string;
}): Promise<DecisionReportData | null> {
  const [tender, company] = await Promise.all([
    prisma.tender.findFirst({
      where: { id: params.tenderId, companyId: params.companyId },
      include: {
        financialModels: { orderBy: { updatedAt: 'desc' }, take: 1 },
        complianceRuns: {
          where: { status: 'SUCCEEDED' },
          orderBy: { startedAt: 'desc' },
          take: 1,
          include: { findings: true },
        },
        contractAnalyses: {
          where: { status: 'SUCCEEDED' },
          orderBy: { startedAt: 'desc' },
          take: 1,
          include: { risks: true, document: { select: { originalName: true } } },
        },
        lineItems: {
          include: { selectedQuoteItem: { include: { quote: true } } },
        },
        supplierQuotes: { select: { id: true, verification: true } },
      },
    }),
    prisma.company.findUnique({
      where: { id: params.companyId },
      select: { name: true, bin: true, taxRegime: true },
    }),
  ]);

  if (!tender || !company) return null;

  // ── Финансовый блок ───────────────────────────────────────────────────────
  const model = tender.financialModels[0];
  let finance: DecisionReportData['finance'] = null;
  if (model?.result) {
    const r = model.result as SavedFinanceResult;
    const inputs = model.inputs as SavedFinanceInputs;

    // Сценарии пересчитываются по сохранённым входным данным, чтобы отчёт
    // показывал стрессовый вариант даже если в снимке его нет.
    const scenarios = await buildScenarioSummary(model.inputs);

    finance = {
      modelName: model.name,
      calculatedAt: r.calculatedAt ?? model.updatedAt.toISOString(),
      engineVersion: model.engineVersion,
      taxConfigVersion: model.taxConfigVersion ?? '—',
      bidPriceMinor: inputs.tender?.bidPriceMinor ?? null,
      revenueNetMinor: r.revenue?.netMinor ?? 0,
      revenueGrossMinor: r.revenue?.grossMinor ?? 0,
      totalCostMinor: r.costs?.totalMinor ?? 0,
      grossProfitMinor: r.profit?.grossMinor ?? 0,
      operatingProfitMinor: r.profit?.operatingMinor ?? 0,
      preTaxProfitMinor: r.profit?.preTaxMinor ?? 0,
      incomeTaxMinor: r.profit?.incomeTaxMinor ?? 0,
      netProfitMinor: r.profit?.netMinor ?? 0,
      netMarginRatio: r.margins?.netRatio ?? null,
      roiRatio: r.roi?.ratio ?? null,
      roiAnnualizedRatio: r.roi?.annualizedRatio ?? null,
      breakEvenPriceMinor: r.breakEven?.priceMinor ?? null,
      workingCapitalMinor: r.workingCapital?.requirementMinor ?? 0,
      peakGapDay: r.workingCapital?.peakGapDay ?? null,
      netCashMinor: r.cashflow?.netCashMinor ?? 0,
      profitVsCashDeltaMinor: r.cashflow?.profitVsCashDeltaMinor ?? 0,
      vatPayableMinor: r.vat?.payableMinor ?? 0,
      priceDropToZeroRatio: r.sensitivity?.priceDropToZeroRatio ?? null,
      costIncreaseToZeroRatio: r.sensitivity?.costIncreaseToZeroRatio ?? null,
      verifiedCostShareRatio: r.verifiedCostShareRatio ?? null,
      unverifiedCostMinor: r.unverifiedCostMinor ?? 0,
      warnings: (r.warnings ?? []).map((w) => ({
        severity: w.severity ?? 'INFO',
        message: w.message ?? '',
      })),
      missingInputs: (r.missingInputs ?? []).map((m) => ({
        label: m.label ?? '',
        affects: m.affects ?? [],
      })),
      scenarios,
    };
  }

  // ── Проверка документов ───────────────────────────────────────────────────
  const run = tender.complianceRuns[0];
  let compliance: DecisionReportData['compliance'] = null;
  if (run) {
    const byStatus = run.findings.reduce<Record<string, number>>((acc, f) => {
      acc[f.status] = (acc[f.status] ?? 0) + 1;
      return acc;
    }, {});

    const unreadableNames =
      run.unreadableDocumentIds.length > 0
        ? (
            await prisma.document.findMany({
              where: { id: { in: run.unreadableDocumentIds } },
              select: { originalName: true },
            })
          ).map((d) => d.originalName)
        : [];

    const priority = ['NOT_FOUND', 'MISMATCH', 'NEEDS_REVIEW'];
    compliance = {
      runAt: run.startedAt.toISOString(),
      model: run.aiModel,
      byStatus,
      unreadableDocuments: unreadableNames,
      criticalFindings: run.findings
        .filter(
          (f) =>
            priority.includes(f.status) ||
            f.riskLevel === 'CRITICAL' ||
            f.riskLevel === 'HIGH',
        )
        .sort((a, b) => priority.indexOf(a.status) - priority.indexOf(b.status))
        .slice(0, 40)
        .map((f) => ({
          requirementText: f.requirementText,
          status: f.status,
          riskLevel: f.riskLevel,
          documentName: f.documentName,
          pageNumber: f.pageNumber,
          recommendation: f.recommendation,
          uncertaintyReason: f.uncertaintyReason,
        })),
    };
  }

  // ── Анализ договора ───────────────────────────────────────────────────────
  const analysis = tender.contractAnalyses[0];
  let contract: DecisionReportData['contract'] = null;
  if (analysis) {
    const risksByLevel = analysis.risks.reduce<Record<string, number>>(
      (acc, r) => {
        acc[r.riskLevel] = (acc[r.riskLevel] ?? 0) + 1;
        return acc;
      },
      {},
    );
    const order = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
    contract = {
      runAt: analysis.startedAt.toISOString(),
      documentName: analysis.document.originalName,
      extractedTerms: (analysis.extractedTerms ?? {}) as Record<
        string,
        number | null
      >,
      risksByLevel,
      needsLawyerReview: analysis.risks.filter((r) => r.needsLawyerReview).length,
      topRisks: analysis.risks
        .sort(
          (a, b) => order.indexOf(a.riskLevel) - order.indexOf(b.riskLevel),
        )
        .slice(0, 20)
        .map((r) => ({
          title: r.title,
          category: r.category,
          clauseRef: r.clauseRef,
          riskLevel: r.riskLevel,
          explanation: r.explanation,
          recommendation: r.recommendation,
        })),
    };
  }

  // ── Снабжение ─────────────────────────────────────────────────────────────
  let confirmedPurchaseCostMinor = 0;
  let itemsWithConfirmedPrice = 0;
  for (const item of tender.lineItems) {
    const selected = item.selectedQuoteItem;
    if (!selected) continue;
    const price = selectedPriceForFinance(selected);
    if (price.unitCostMinor === null) continue;
    itemsWithConfirmedPrice += 1;
    confirmedPurchaseCostMinor += mulMinor(price.unitCostMinor, Number(item.quantity));
  }

  const base: Omit<DecisionReportData, 'gaps'> = {
    generatedAt: new Date().toISOString(),
    company: {
      name: company.name,
      bin: company.bin,
      taxRegime: TAX_REGIME_LABELS[company.taxRegime],
    },
    tender: {
      id: tender.id,
      title: tender.title,
      externalNumber: tender.externalNumber,
      customerName: tender.customerName,
      procurementType: PROCUREMENT_TYPE_LABELS[tender.procurementType],
      stage: TENDER_STAGE_LABELS[tender.stage],
      startPriceMinor:
        tender.startPriceMinor === null ? null : Number(tender.startPriceMinor),
      submissionDeadline: tender.submissionDeadline?.toISOString() ?? null,
      deliveryDeadline: tender.deliveryDeadline?.toISOString() ?? null,
      sourceUrl: tender.sourceUrl,
    },
    finance,
    compliance,
    contract,
    sourcing: {
      lineItemsCount: tender.lineItems.length,
      itemsWithConfirmedPrice,
      confirmedPurchaseCostMinor,
      quotesCount: tender.supplierQuotes.length,
      unverifiedQuotesCount: tender.supplierQuotes.filter(
        (q) => q.verification === 'UNVERIFIED',
      ).length,
    },
  };

  return { ...base, gaps: collectGaps(base) };
}

/** Пересчёт сценариев по сохранённым входным данным. */
async function buildScenarioSummary(
  inputs: unknown,
): Promise<Array<{ label: string; netProfitMinor: number; workingCapitalMinor: number }>> {
  const { FinanceInputSchema } = await import('../finance/schema');
  const parsed = FinanceInputSchema.safeParse(inputs);
  if (!parsed.success) return [];

  const { calculateAllScenarios } = await import('../finance/scenarios');
  const scenarios = calculateAllScenarios(
    parsed.data as Parameters<typeof calculateAllScenarios>[0],
  );
  return scenarios.map((s) => ({
    label: s.label,
    netProfitMinor: s.result.profit.netMinor,
    workingCapitalMinor: s.result.workingCapital.requirementMinor,
  }));
}
