'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { NotImplementedNotice, StatusNotice } from '@/components/ui/status-notice';
import { COMPLIANCE_STATUS_LABELS, RISK_LEVEL_LABELS } from '@/lib/tender-labels';
import { DocumentPicker, type PickableDocument } from './document-picker';

export interface FindingRow {
  id: string;
  requirementText: string;
  status: keyof typeof COMPLIANCE_STATUS_LABELS;
  riskLevel: keyof typeof RISK_LEVEL_LABELS;
  documentName: string | null;
  pageNumber: number | null;
  evidenceQuote: string | null;
  recommendation: string;
  uncertaintyReason: string | null;
}

export interface RunRow {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  aiModel: string | null;
  error: string | null;
  unreadableDocumentNames: string[];
  findings: FindingRow[];
}

const STATUS_TONE: Record<
  keyof typeof COMPLIANCE_STATUS_LABELS,
  'positive' | 'negative' | 'caution' | 'neutral'
> = {
  CONFIRMED: 'positive',
  NOT_FOUND: 'negative',
  MISMATCH: 'negative',
  NEEDS_REVIEW: 'caution',
};

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

export function CompliancePanel({
  tenderId,
  runs,
  ownDocuments,
  confirmedRequirementsCount,
  totalRequirementsCount,
  aiConfigured,
  canEdit,
}: {
  tenderId: string;
  runs: RunRow[];
  ownDocuments: PickableDocument[];
  confirmedRequirementsCount: number;
  totalRequirementsCount: number;
  aiConfigured: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runCheck() {
    setRunning(true);
    setError(null);
    try {
      const response = await fetch(`/api/tenders/${tenderId}/compliance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplierDocumentIds: selected,
          onlyConfirmedRequirements: true,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? 'Не удалось выполнить проверку');
        return;
      }
      router.refresh();
    } catch {
      setError('Сервер недоступен.');
    } finally {
      setRunning(false);
    }
  }

  const latest = runs[0];

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Проверка документов заявки</CardTitle>
          <CardDescription>
            Система сопоставляет подтверждённые требования закупки с вашими
            документами. Вывод делается только по прочитанному тексту: если
            документ не прочитан, ставится статус «Требует проверки», а не
            «Не обнаружено».
          </CardDescription>
        </CardHeader>
        <CardBody className="space-y-4">
          {!aiConfigured ? (
            <NotImplementedNotice
              feature="Автоматическая проверка документов"
              requires="AI-модель недоступна. Обратитесь к администратору."
            />
          ) : null}

          {error ? <StatusNotice severity="CRITICAL">{error}</StatusNotice> : null}

          {confirmedRequirementsCount === 0 ? (
            <StatusNotice severity="WARNING" title="Нет подтверждённых требований">
              Проверка идёт по подтверждённому списку требований. Всего требований:{' '}
              {totalRequirementsCount}, подтверждено: 0. Перейдите на страницу
              требований и подтвердите те, что относятся к этой закупке.
            </StatusNotice>
          ) : (
            <p className="text-[13px] text-ink-600">
              Будет проверено требований: <strong>{confirmedRequirementsCount}</strong>{' '}
              из {totalRequirementsCount}.
            </p>
          )}

          <div>
            <p className="mb-2 text-[13px] font-medium text-ink-700">
              Ваши документы, которыми подтверждается соответствие
            </p>
            <DocumentPicker
              documents={ownDocuments}
              selected={selected}
              onChange={setSelected}
              emptyMessage="Загрузите свои документы (лицензии, справки, сертификаты) с типом «Наш документ»."
            />
          </div>

          {canEdit ? (
            <Button
              type="button"
              loading={running}
              disabled={!aiConfigured || confirmedRequirementsCount === 0}
              onClick={() => void runCheck()}
            >
              <ShieldCheck className="size-4" aria-hidden />
              {running ? 'Проверка…' : 'Проверить документы'}
            </Button>
          ) : null}

          <p className="text-[12px] leading-relaxed text-ink-400">
            Результат проверки — материал для решения специалиста. Платформа не
            гарантирует допуск к закупке: окончательное решение принимает комиссия
            заказчика.
          </p>
        </CardBody>
      </Card>

      {latest ? <RunResults run={latest} /> : null}

      {runs.length > 1 ? (
        <Card>
          <CardHeader>
            <CardTitle>Предыдущие проверки</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2">
            {runs.slice(1).map((run) => (
              <div
                key={run.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-ink-100 px-3 py-2.5 text-[13px]"
              >
                <span className="text-ink-600">
                  {new Intl.DateTimeFormat('ru-KZ', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  }).format(new Date(run.startedAt))}
                  {run.aiModel ? ` · ${run.aiModel}` : ''}
                </span>
                <span className="flex gap-1.5">
                  <Badge
                    tone={run.status === 'SUCCEEDED' ? 'positive' : 'negative'}
                  >
                    {run.status === 'SUCCEEDED' ? 'Выполнена' : 'Ошибка'}
                  </Badge>
                  <Badge>Замечаний: {run.findings.length}</Badge>
                </span>
              </div>
            ))}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

function RunResults({ run }: { run: RunRow }) {
  if (run.status !== 'SUCCEEDED' && run.status !== 'FAILED') return <StatusNotice severity="INFO" title="Проверка выполняется">Результат ещё не готов. Отсутствие замечаний не подтверждено.</StatusNotice>;
  if (run.status === 'FAILED') {
    return (
      <StatusNotice severity="CRITICAL" title="Проверка не выполнена">
        {run.error ?? 'Неизвестная ошибка'}
      </StatusNotice>
    );
  }

  const counts = run.findings.reduce<Record<string, number>>((acc, f) => {
    acc[f.status] = (acc[f.status] ?? 0) + 1;
    return acc;
  }, {});

  const order: Array<keyof typeof COMPLIANCE_STATUS_LABELS> = [
    'NOT_FOUND',
    'MISMATCH',
    'NEEDS_REVIEW',
    'CONFIRMED',
  ];
  const sorted = [...run.findings].sort(
    (a, b) => order.indexOf(a.status) - order.indexOf(b.status),
  );

  return (
    <Card>
      <CardHeader
        action={
          <span className="text-[12px] text-ink-400">
            {new Intl.DateTimeFormat('ru-KZ', {
              dateStyle: 'short',
              timeStyle: 'short',
            }).format(new Date(run.startedAt))}
            {run.aiModel ? ` · ${run.aiModel}` : ''}
          </span>
        }
      >
        <CardTitle>Результат последней проверки</CardTitle>
        <CardDescription>
          <span className="flex flex-wrap gap-1.5 pt-1.5">
            {order.map((status) =>
              counts[status] ? (
                <Badge key={status} tone={STATUS_TONE[status]}>
                  {COMPLIANCE_STATUS_LABELS[status]}: {counts[status]}
                </Badge>
              ) : null,
            )}
          </span>
        </CardDescription>
      </CardHeader>
      <CardBody className="space-y-2.5">
        {run.unreadableDocumentNames.length > 0 ? (
          <StatusNotice severity="WARNING" title="Часть документов не прочитана">
            {run.unreadableDocumentNames.join(', ')}. По требованиям, которые эти
            документы могли бы подтвердить, вывод об отсутствии не делался.
          </StatusNotice>
        ) : null}

        {sorted.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-ink-400">
            Замечаний нет.
          </p>
        ) : (
          sorted.map((finding) => (
            <div
              key={finding.id}
              className="rounded-lg border border-ink-200 p-3.5"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="min-w-0 flex-1 text-[13.5px] font-medium text-ink-900">
                  {finding.requirementText}
                </p>
                <span className="flex shrink-0 gap-1.5">
                  <Badge tone={STATUS_TONE[finding.status]}>
                    {COMPLIANCE_STATUS_LABELS[finding.status]}
                  </Badge>
                  <Badge tone={RISK_TONE[finding.riskLevel]}>
                    {RISK_LEVEL_LABELS[finding.riskLevel]}
                  </Badge>
                </span>
              </div>

              {finding.documentName || finding.pageNumber !== null ? (
                <p className="mt-1.5 text-[12px] text-ink-500">
                  {finding.documentName ?? 'документ не указан'}
                  {finding.pageNumber !== null ? `, стр. ${finding.pageNumber}` : ''}
                </p>
              ) : null}

              {finding.evidenceQuote ? (
                <blockquote className="mt-2 border-l-2 border-ink-200 pl-2.5 text-[12.5px] italic leading-relaxed text-ink-600">
                  {finding.evidenceQuote}
                </blockquote>
              ) : null}

              {finding.uncertaintyReason ? (
                <p className="mt-2 rounded-md bg-amber-50 px-2.5 py-2 text-[12.5px] leading-relaxed text-amber-900">
                  {finding.uncertaintyReason}
                </p>
              ) : null}

              <p className="mt-2 text-[13px] leading-relaxed text-ink-700">
                <span className="font-medium">Что сделать: </span>
                {finding.recommendation}
              </p>
            </div>
          ))
        )}
      </CardBody>
    </Card>
  );
}
