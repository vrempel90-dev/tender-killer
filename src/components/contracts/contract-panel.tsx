'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FileSearch, Scale } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { NotImplementedNotice, StatusNotice } from '@/components/ui/status-notice';
import { CONTRACT_RISK_CATEGORY_LABELS, RISK_LEVEL_LABELS } from '@/lib/tender-labels';
import { DocumentPicker, type PickableDocument } from '@/components/compliance/document-picker';

export interface ContractRiskRow {
  id: string;
  category: string;
  title: string;
  clauseRef: string | null;
  pageNumber: number | null;
  sourceQuote: string | null;
  riskLevel: keyof typeof RISK_LEVEL_LABELS;
  explanation: string;
  recommendation: string | null;
  needsLawyerReview: boolean;
  financeHint: Record<string, number | null> | null;
}

export interface ContractAnalysisRow {
  id: string;
  documentName: string;
  startedAt: string;
  status: string;
  aiModel: string | null;
  error: string | null;
  extractedTerms: Record<string, number | null> | null;
  risks: ContractRiskRow[];
}

const RISK_TONE: Record<
  keyof typeof RISK_LEVEL_LABELS,
  'negative' | 'caution' | 'neutral' | 'info'
> = {
  CRITICAL: 'negative',
  HIGH: 'negative',
  MEDIUM: 'caution',
  LOW: 'neutral',
  INFO: 'info',
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

export function ContractPanel({
  tenderId,
  analyses,
  contractDocuments,
  aiConfigured,
  canEdit,
  financeHref,
}: {
  tenderId: string;
  analyses: ContractAnalysisRow[];
  contractDocuments: PickableDocument[];
  aiConfigured: boolean;
  canEdit: boolean;
  financeHref: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runAnalysis() {
    const documentId = selected[0];
    if (!documentId) return;
    setRunning(true);
    setError(null);
    try {
      const response = await fetch(`/api/tenders/${tenderId}/contract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? 'Не удалось проанализировать договор');
        return;
      }
      router.refresh();
    } catch {
      setError('Сервер недоступен.');
    } finally {
      setRunning(false);
    }
  }

  const latest = analyses[0];

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Анализ проекта договора</CardTitle>
          <CardDescription>
            Проверяются порядок и сроки оплаты, аванс, сроки исполнения, штрафы и
            неустойки, обеспечение, гарантии, приёмка, расторжение и
            дополнительные расходы. Каждый риск сопровождается цитатой пункта
            договора.
          </CardDescription>
        </CardHeader>
        <CardBody className="space-y-4">
          {!aiConfigured ? (
            <NotImplementedNotice
              feature="Анализ договора"
              requires="Требуется переменная окружения ANTHROPIC_API_KEY."
            />
          ) : null}

          {error ? <StatusNotice severity="CRITICAL">{error}</StatusNotice> : null}

          <div>
            <p className="mb-2 text-[13px] font-medium text-ink-700">
              Документ договора (выберите один)
            </p>
            <DocumentPicker
              documents={contractDocuments}
              selected={selected}
              onChange={(next) => setSelected(next.slice(-1))}
              emptyMessage="Загрузите проект договора с типом «Проект договора» на странице документов."
            />
          </div>

          {canEdit ? (
            <Button
              type="button"
              loading={running}
              disabled={!aiConfigured || selected.length === 0}
              onClick={() => void runAnalysis()}
            >
              <FileSearch className="size-4" aria-hidden />
              {running ? 'Анализ договора…' : 'Проанализировать договор'}
            </Button>
          ) : null}

          <p className="text-[12px] leading-relaxed text-ink-400">
            Результат не является юридическим заключением. Юридически
            неоднозначные условия отмечаются отдельно и требуют проверки юриста.
          </p>
        </CardBody>
      </Card>

      {latest ? (
        <AnalysisResult analysis={latest} financeHref={financeHref} />
      ) : null}
    </div>
  );
}

function AnalysisResult({
  analysis,
  financeHref,
}: {
  analysis: ContractAnalysisRow;
  financeHref: string;
}) {
  if (analysis.status === 'FAILED') {
    return (
      <StatusNotice severity="CRITICAL" title="Анализ не выполнен">
        {analysis.error ?? 'Неизвестная ошибка'}
      </StatusNotice>
    );
  }

  const order: Array<keyof typeof RISK_LEVEL_LABELS> = [
    'CRITICAL',
    'HIGH',
    'MEDIUM',
    'LOW',
    'INFO',
  ];
  const sorted = [...analysis.risks].sort(
    (a, b) => order.indexOf(a.riskLevel) - order.indexOf(b.riskLevel),
  );
  const lawyerCount = analysis.risks.filter((r) => r.needsLawyerReview).length;

  const terms = analysis.extractedTerms ?? {};
  const filledTerms = Object.entries(TERM_LABELS).filter(
    ([key]) => terms[key] !== null && terms[key] !== undefined,
  );

  return (
    <>
      {filledTerms.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Условия договора для финансовой модели</CardTitle>
            <CardDescription>
              Извлечены только те значения, которые прямо указаны в договоре.
              Перенесите их в расчёт экономики —{' '}
              <a
                href={financeHref}
                className="font-medium text-brand-600 hover:text-brand-700"
              >
                открыть калькулятор
              </a>
              .
            </CardDescription>
          </CardHeader>
          <CardBody>
            <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {filledTerms.map(([key, meta]) => (
                <div key={key} className="rounded-lg border border-ink-150 border-ink-200 px-3 py-2.5">
                  <dt className="text-[12px] text-ink-400">{meta.label}</dt>
                  <dd className="mt-0.5 text-[15px] font-semibold tabular text-ink-900">
                    {terms[key]} {meta.unit}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {Object.entries(TERM_LABELS)
                .filter(([key]) => terms[key] === null || terms[key] === undefined)
                .map(([key, meta]) => (
                  <Badge key={key} tone="neutral">
                    {meta.label}: не указано в договоре
                  </Badge>
                ))}
            </div>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          action={
            <span className="text-[12px] text-ink-400">
              {analysis.documentName}
              {analysis.aiModel ? ` · ${analysis.aiModel}` : ''}
            </span>
          }
        >
          <CardTitle>Выявленные риски: {analysis.risks.length}</CardTitle>
          {lawyerCount > 0 ? (
            <CardDescription>
              <span className="inline-flex items-center gap-1.5 pt-1.5 text-amber-800">
                <Scale className="size-3.5" aria-hidden />
                Требуют проверки юриста: {lawyerCount}
              </span>
            </CardDescription>
          ) : null}
        </CardHeader>
        <CardBody className="space-y-2.5">
          {sorted.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-ink-400">
              Риски не выявлены. Это не означает, что договор безопасен —
              проверьте его самостоятельно.
            </p>
          ) : (
            sorted.map((risk) => (
              <div key={risk.id} className="rounded-lg border border-ink-200 p-3.5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="min-w-0 flex-1 text-[13.5px] font-medium text-ink-900">
                    {risk.title}
                  </p>
                  <span className="flex shrink-0 flex-wrap gap-1.5">
                    <Badge>
                      {CONTRACT_RISK_CATEGORY_LABELS[risk.category] ?? risk.category}
                    </Badge>
                    <Badge tone={RISK_TONE[risk.riskLevel]}>
                      {RISK_LEVEL_LABELS[risk.riskLevel]}
                    </Badge>
                    {risk.needsLawyerReview ? (
                      <Badge tone="caution">нужен юрист</Badge>
                    ) : null}
                  </span>
                </div>

                <p className="mt-1.5 text-[12px] text-ink-500">
                  {risk.clauseRef ? `Пункт ${risk.clauseRef}` : 'Пункт не указан'}
                  {risk.pageNumber !== null ? `, стр. ${risk.pageNumber}` : ''}
                </p>

                {risk.sourceQuote ? (
                  <blockquote className="mt-2 border-l-2 border-ink-200 pl-2.5 text-[12.5px] italic leading-relaxed text-ink-600">
                    {risk.sourceQuote}
                  </blockquote>
                ) : null}

                <p className="mt-2 text-[13px] leading-relaxed text-ink-700">
                  {risk.explanation}
                </p>

                {risk.recommendation ? (
                  <p className="mt-1.5 text-[13px] leading-relaxed text-ink-700">
                    <span className="font-medium">Что предложить: </span>
                    {risk.recommendation}
                  </p>
                ) : null}

                {risk.financeHint && Object.keys(risk.financeHint).length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {Object.entries(risk.financeHint)
                      .filter(([, value]) => value !== null && value !== undefined)
                      .map(([key, value]) => (
                        <Badge key={key} tone="brand">
                          {TERM_LABELS[key]?.label ?? key}: {value}{' '}
                          {TERM_LABELS[key]?.unit ?? ''}
                        </Badge>
                      ))}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </CardBody>
      </Card>
    </>
  );
}
