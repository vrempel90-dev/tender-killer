'use client';

import { useState } from 'react';
import { Download, FileText, Printer, Save } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusNotice } from '@/components/ui/status-notice';
import { formatMinorKzt, formatRatioAsPercent } from '@/lib/money';
import {
  COMPLIANCE_STATUS_LABELS,
  CONTRACT_RISK_CATEGORY_LABELS,
  RISK_LEVEL_LABELS,
} from '@/lib/tender-labels';
import type {
  DecisionReportData,
  DecisionSummary,
  DecisionVerdict,
} from '@/lib/reports/decision-report';

const VERDICT_TONE: Record<DecisionVerdict, 'positive' | 'negative' | 'caution' | 'neutral'> = {
  ACCEPTABLE: 'positive',
  RISKY: 'caution',
  NOT_RECOMMENDED: 'negative',
  INSUFFICIENT_DATA: 'neutral',
};

const TERM_LABELS: Record<string, { label: string; unit: string }> = {
  paymentDelayDays: { label: 'Срок оплаты после акта', unit: 'дн.' },
  advancePercent: { label: 'Аванс', unit: '%' },
  retentionPercent: { label: 'Гарантийное удержание', unit: '%' },
  deliveryDays: { label: 'Срок поставки', unit: 'дн.' },
  performanceSecurityPercent: { label: 'Обеспечение исполнения', unit: '%' },
  warrantyMonths: { label: 'Гарантийный срок', unit: 'мес.' },
  penaltyPercentPerDay: { label: 'Пеня за день просрочки', unit: '%' },
  penaltyCapPercent: { label: 'Предел неустойки', unit: '%' },
};

export function DecisionReportView({
  data,
  summary,
  disclaimer,
  verdictLabel,
  canSave,
}: {
  data: DecisionReportData;
  summary: DecisionSummary;
  disclaimer: string;
  verdictLabel: string;
  canSave: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveSnapshot() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/tenders/${data.tender.id}/report`, {
        method: 'POST',
      });
      if (!response.ok) {
        const body = await response.json();
        setError(body.error ?? 'Не удалось сохранить отчёт');
        return;
      }
      setSaved(true);
    } catch {
      setError('Сервер недоступен.');
    } finally {
      setSaving(false);
    }
  }

  async function downloadPdf() {
    setError(null);
    try {
      const response = await fetch(
        `/api/tenders/${data.tender.id}/report?format=pdf`,
      );
      if (!response.ok) {
        const body = await response.json();
        setError(body.error ?? 'Не удалось сформировать PDF');
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Отчёт_${data.tender.title.slice(0, 60)}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('Не удалось скачать файл.');
    }
  }

  const f = data.finance;

  return (
    <div className="space-y-5">
      {error ? <StatusNotice severity="CRITICAL">{error}</StatusNotice> : null}
      {saved ? (
        <StatusNotice severity="INFO">
          Снимок отчёта сохранён: он фиксирует состояние данных на момент решения.
        </StatusNotice>
      ) : null}

      <div className="no-print flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => void downloadPdf()}>
          <Download className="size-4" aria-hidden />
          Скачать PDF
        </Button>
        <Button type="button" variant="outline" onClick={() => window.print()}>
          <Printer className="size-4" aria-hidden />
          Печать
        </Button>
        {canSave ? (
          <Button
            type="button"
            variant="secondary"
            loading={saving}
            onClick={() => void saveSnapshot()}
          >
            <Save className="size-4" aria-hidden />
            Сохранить снимок
          </Button>
        ) : null}
      </div>

      {/* Итоговая оценка */}
      <Card>
        <CardHeader
          action={<Badge tone={VERDICT_TONE[summary.verdict]}>{verdictLabel}</Badge>}
        >
          <CardTitle>{summary.title}</CardTitle>
          <CardDescription>
            Сформирован{' '}
            {new Intl.DateTimeFormat('ru-KZ', {
              dateStyle: 'long',
              timeStyle: 'short',
            }).format(new Date(data.generatedAt))}
          </CardDescription>
        </CardHeader>
        <CardBody>
          <ul className="space-y-1.5 text-[13px] leading-relaxed text-ink-700">
            {summary.reasons.map((reason) => (
              <li key={reason} className="flex gap-2">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-ink-300" />
                {reason}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      {/* Экономика */}
      <Card>
        <CardHeader>
          <CardTitle>Экономика сделки</CardTitle>
        </CardHeader>
        <CardBody className={f ? 'p-0' : undefined}>
          {!f ? (
            <StatusNotice severity="WARNING">
              Финансовый расчёт не сохранён — экономика сделки не оценена.
            </StatusNotice>
          ) : (
            <table className="w-full table-fixed text-[13px]">
              <tbody>
                <Row label="Цена предложения (с НДС)" value={formatMinorKzt(f.bidPriceMinor)} />
                <Row
                  label="Начальная цена закупки"
                  value={formatMinorKzt(data.tender.startPriceMinor)}
                />
                <Row label="Выручка без НДС" value={formatMinorKzt(f.revenueNetMinor)} />
                <Row
                  label="Полная себестоимость исполнения"
                  value={formatMinorKzt(f.totalCostMinor)}
                />
                <Row label="Валовая прибыль" value={formatMinorKzt(f.grossProfitMinor)} />
                <Row
                  label="Операционная прибыль"
                  value={formatMinorKzt(f.operatingProfitMinor)}
                />
                <Row
                  label="Прибыль до налогообложения"
                  value={formatMinorKzt(f.preTaxProfitMinor)}
                />
                <Row label="Налог на доход" value={formatMinorKzt(f.incomeTaxMinor)} />
                <Row
                  label="Расчётная чистая прибыль"
                  value={formatMinorKzt(f.netProfitMinor)}
                  strong
                />
                <Row
                  label="Рентабельность продаж"
                  value={formatRatioAsPercent(f.netMarginRatio)}
                />
                <Row
                  label="ROI"
                  value={
                    f.roiRatio === null
                      ? '—'
                      : `${formatRatioAsPercent(f.roiRatio)} (в годовом выражении ${formatRatioAsPercent(f.roiAnnualizedRatio)})`
                  }
                />
                <Row
                  label="Минимальная безубыточная цена"
                  value={formatMinorKzt(f.breakEvenPriceMinor)}
                />
                <Row
                  label="Запас по цене до убытка"
                  value={
                    f.priceDropToZeroRatio === null
                      ? '—'
                      : formatRatioAsPercent(f.priceDropToZeroRatio)
                  }
                />
                <Row
                  label="Запас по росту затрат"
                  value={
                    f.costIncreaseToZeroRatio === null
                      ? '—'
                      : formatRatioAsPercent(f.costIncreaseToZeroRatio)
                  }
                />
                <Row
                  label="Потребность в оборотном капитале"
                  value={`${formatMinorKzt(f.workingCapitalMinor)}${f.peakGapDay !== null ? ` (пик на день ${f.peakGapDay})` : ''}`}
                />
                <Row
                  label="Итоговый денежный поток"
                  value={formatMinorKzt(f.netCashMinor)}
                />
                <Row
                  label="Расхождение прибыли и потока"
                  value={formatMinorKzt(f.profitVsCashDeltaMinor)}
                />
                <Row label="НДС к уплате" value={formatMinorKzt(f.vatPayableMinor)} />
                <Row
                  label="Затраты, подтверждённые документами"
                  value={
                    f.verifiedCostShareRatio === null
                      ? '—'
                      : formatRatioAsPercent(f.verifiedCostShareRatio)
                  }
                />
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      {/* Сценарии */}
      {f && f.scenarios.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Сценарии</CardTitle>
          </CardHeader>
          <CardBody className="p-0">
            <div className="overflow-x-auto">
            <table className="w-full table-fixed text-[13px]">
              <thead>
                <tr className="border-b border-ink-100 text-left text-[12px] uppercase tracking-wide text-ink-400">
                  <th className="px-4 py-2.5 font-medium">Сценарий</th>
                  <th className="px-4 py-2.5 text-right font-medium">Прибыль</th>
                  <th className="px-4 py-2.5 text-right font-medium">
                    Оборотные средства
                  </th>
                </tr>
              </thead>
              <tbody>
                {f.scenarios.map((s) => (
                  <tr key={s.label} className="border-b border-ink-50 last:border-0">
                    <td className="break-words px-4 py-2.5 text-ink-700">
                      {s.label}
                    </td>
                    <td
                      className={
                        s.netProfitMinor >= 0
                          ? 'break-words px-4 py-2.5 text-right tabular text-emerald-700'
                          : 'break-words px-4 py-2.5 text-right tabular text-red-700'
                      }
                    >
                      {formatMinorKzt(s.netProfitMinor)}
                    </td>
                    <td className="break-words px-4 py-2.5 text-right tabular text-ink-600">
                      {formatMinorKzt(s.workingCapitalMinor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {/* Проверка документов */}
      <Card>
        <CardHeader>
          <CardTitle>Проверка документов заявки</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          {!data.compliance ? (
            <StatusNotice severity="WARNING">
              Проверка не выполнялась — риск отклонения заявки не оценён.
            </StatusNotice>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(COMPLIANCE_STATUS_LABELS).map(([status, label]) => (
                  <Badge
                    key={status}
                    tone={
                      status === 'CONFIRMED'
                        ? 'positive'
                        : status === 'NEEDS_REVIEW'
                          ? 'caution'
                          : 'negative'
                    }
                  >
                    {label}: {data.compliance?.byStatus[status] ?? 0}
                  </Badge>
                ))}
              </div>

              {data.compliance.unreadableDocuments.length > 0 ? (
                <StatusNotice severity="WARNING">
                  Не прочитано содержимое документов:{' '}
                  {data.compliance.unreadableDocuments.join(', ')}. По ним вывод об
                  отсутствии подтверждения не делался.
                </StatusNotice>
              ) : null}

              {data.compliance.criticalFindings.map((finding, index) => (
                <div
                  key={index}
                  className="rounded-lg border border-ink-200 p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 text-[13px] font-medium text-ink-900">
                      {finding.requirementText}
                    </p>
                    <span className="flex gap-1.5">
                      <Badge
                        tone={
                          finding.status === 'CONFIRMED'
                            ? 'positive'
                            : finding.status === 'NEEDS_REVIEW'
                              ? 'caution'
                              : 'negative'
                        }
                      >
                        {COMPLIANCE_STATUS_LABELS[
                          finding.status as keyof typeof COMPLIANCE_STATUS_LABELS
                        ] ?? finding.status}
                      </Badge>
                      <Badge>
                        {RISK_LEVEL_LABELS[
                          finding.riskLevel as keyof typeof RISK_LEVEL_LABELS
                        ] ?? finding.riskLevel}
                      </Badge>
                    </span>
                  </div>
                  {finding.uncertaintyReason ? (
                    <p className="mt-1.5 text-[12.5px] leading-relaxed text-amber-800">
                      {finding.uncertaintyReason}
                    </p>
                  ) : null}
                  <p className="mt-1.5 text-[13px] leading-relaxed text-ink-700">
                    <span className="font-medium">Что сделать: </span>
                    {finding.recommendation}
                  </p>
                </div>
              ))}
            </>
          )}
        </CardBody>
      </Card>

      {/* Договор */}
      <Card>
        <CardHeader>
          <CardTitle>Риски проекта договора</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          {!data.contract ? (
            <StatusNotice severity="WARNING">
              Проект договора не анализировался — договорные риски не оценены.
            </StatusNotice>
          ) : (
            <>
              <dl className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
                {Object.entries(TERM_LABELS).map(([key, meta]) => {
                  const value = data.contract?.extractedTerms[key];
                  return (
                    <div
                      key={key}
                      className="rounded-lg border border-ink-200 px-3 py-2"
                    >
                      <dt className="text-[12px] text-ink-400">{meta.label}</dt>
                      <dd className="mt-0.5 text-[14px] font-medium tabular text-ink-900">
                        {value === null || value === undefined
                          ? 'не указано'
                          : `${value} ${meta.unit}`}
                      </dd>
                    </div>
                  );
                })}
              </dl>

              <div className="flex flex-wrap gap-1.5">
                {Object.entries(data.contract.risksByLevel).map(([level, count]) => (
                  <Badge
                    key={level}
                    tone={
                      level === 'CRITICAL' || level === 'HIGH'
                        ? 'negative'
                        : level === 'MEDIUM'
                          ? 'caution'
                          : 'neutral'
                    }
                  >
                    {RISK_LEVEL_LABELS[level as keyof typeof RISK_LEVEL_LABELS] ?? level}
                    : {count}
                  </Badge>
                ))}
                {data.contract.needsLawyerReview > 0 ? (
                  <Badge tone="caution">
                    требуют юриста: {data.contract.needsLawyerReview}
                  </Badge>
                ) : null}
              </div>

              {data.contract.topRisks.map((risk, index) => (
                <div key={index} className="rounded-lg border border-ink-200 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 text-[13px] font-medium text-ink-900">
                      {risk.title}
                    </p>
                    <span className="flex gap-1.5">
                      <Badge>
                        {CONTRACT_RISK_CATEGORY_LABELS[risk.category] ?? risk.category}
                      </Badge>
                      <Badge
                        tone={
                          risk.riskLevel === 'CRITICAL' || risk.riskLevel === 'HIGH'
                            ? 'negative'
                            : 'caution'
                        }
                      >
                        {RISK_LEVEL_LABELS[
                          risk.riskLevel as keyof typeof RISK_LEVEL_LABELS
                        ] ?? risk.riskLevel}
                      </Badge>
                    </span>
                  </div>
                  {risk.clauseRef ? (
                    <p className="mt-1 text-[12px] text-ink-400">
                      Пункт {risk.clauseRef}
                    </p>
                  ) : null}
                  <p className="mt-1.5 text-[13px] leading-relaxed text-ink-700">
                    {risk.explanation}
                  </p>
                  {risk.recommendation ? (
                    <p className="mt-1 text-[13px] leading-relaxed text-ink-700">
                      <span className="font-medium">Предложение: </span>
                      {risk.recommendation}
                    </p>
                  ) : null}
                </div>
              ))}
            </>
          )}
        </CardBody>
      </Card>

      {/* Снабжение */}
      <Card>
        <CardHeader>
          <CardTitle>Закупочная себестоимость</CardTitle>
        </CardHeader>
        <CardBody className="p-0">
          <table className="w-full table-fixed text-[13px]">
            <tbody>
              <Row
                label="Позиций в закупке"
                value={String(data.sourcing.lineItemsCount)}
              />
              <Row
                label="Позиций с подтверждённой ценой"
                value={`${data.sourcing.itemsWithConfirmedPrice} из ${data.sourcing.lineItemsCount}`}
              />
              <Row
                label="Подтверждённая стоимость закупки"
                value={formatMinorKzt(data.sourcing.confirmedPurchaseCostMinor)}
              />
              <Row
                label="Предложений поставщиков"
                value={`${data.sourcing.quotesCount}, без документа-основания ${data.sourcing.unverifiedQuotesCount}`}
              />
            </tbody>
          </table>
        </CardBody>
      </Card>

      {/* Пробелы */}
      {data.gaps.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Чего не хватает для полноценного решения</CardTitle>
            <CardDescription>
              Эти пробелы не позволяют считать картину полной. Они перечислены
              прямо, а не заполнены предположениями.
            </CardDescription>
          </CardHeader>
          <CardBody>
            <ul className="space-y-1.5 text-[13px] leading-relaxed text-ink-700">
              {data.gaps.map((gap) => (
                <li key={gap} className="flex gap-2">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-400" />
                  {gap}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      <p className="flex gap-2 rounded-lg border border-ink-200 bg-ink-50/60 px-3.5 py-3 text-[12px] leading-relaxed text-ink-500">
        <FileText className="mt-0.5 size-3.5 shrink-0 text-ink-400" aria-hidden />
        {disclaimer}
      </p>
    </div>
  );
}

function Row({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <tr
      className={
        strong
          ? 'border-b border-ink-50 bg-brand-50/50 last:border-0'
          : 'border-b border-ink-50 last:border-0'
      }
    >
      <td
        className={
          strong
            ? 'break-words px-4 py-2.5 font-semibold text-ink-900'
            : 'break-words px-4 py-2.5 text-ink-600'
        }
      >
        {label}
      </td>
      <td
        className={
          strong
            ? 'break-words px-4 py-2.5 text-right tabular font-semibold text-ink-900'
            : 'break-words px-4 py-2.5 text-right tabular text-ink-800'
        }
      >
        {value}
      </td>
    </tr>
  );
}
