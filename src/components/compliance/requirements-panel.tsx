'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Check, Sparkles, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusNotice, NotImplementedNotice } from '@/components/ui/status-notice';
import { REQUIREMENT_CATEGORY_LABELS } from '@/lib/tender-labels';
import { DocumentPicker, type PickableDocument } from './document-picker';

export interface RequirementRow {
  id: string;
  label: string | null;
  text: string;
  category: keyof typeof REQUIREMENT_CATEGORY_LABELS;
  isMandatory: boolean;
  pageNumber: number | null;
  sourceQuote: string | null;
  confirmedByUser: boolean;
  origin: string;
  documentName: string | null;
}

export function RequirementsPanel({
  tenderId,
  requirements,
  documents,
  aiConfigured,
  canEdit,
}: {
  tenderId: string;
  requirements: RequirementRow[];
  documents: PickableDocument[];
  aiConfigured: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [selectedDocs, setSelectedDocs] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    extracted: number;
    unverifiedQuotes: number;
    limitations: string[];
  } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function runExtraction() {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch(`/api/tenders/${tenderId}/requirements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentIds: selectedDocs, replaceExisting: true }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? 'Не удалось извлечь требования');
        return;
      }
      setResult(body.data);
      router.refresh();
    } catch {
      setError('Сервер недоступен.');
    } finally {
      setRunning(false);
    }
  }

  async function toggleConfirm(id: string, confirmed: boolean) {
    setBusyId(id);
    try {
      await fetch(`/api/tenders/${tenderId}/requirements`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requirementId: id, confirmedByUser: confirmed }),
      });
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function removeRequirement(id: string) {
    setBusyId(id);
    try {
      await fetch(
        `/api/tenders/${tenderId}/requirements?requirementId=${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      );
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  const confirmed = requirements.filter((r) => r.confirmedByUser).length;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Извлечение требований из документации</CardTitle>
          <CardDescription>
            AI находит в документах требования к участнику и его заявке. Каждое
            требование подтверждается цитатой из документа; цитата проверяется
            поиском по тексту. Извлечённые требования нужно подтвердить — проверка
            заявки идёт только по подтверждённому списку.
          </CardDescription>
        </CardHeader>
        <CardBody className="space-y-4">
          {!aiConfigured ? (
            <NotImplementedNotice
              feature="Автоматическое извлечение требований"
              requires={
                'AI-модель недоступна. Обратитесь к администратору. '
                + 'Требования можно вести вручную, остальные модули работают.'
              }
            />
          ) : null}

          {error ? <StatusNotice severity="CRITICAL">{error}</StatusNotice> : null}

          {result ? (
            <StatusNotice
              severity={result.unverifiedQuotes > 0 ? 'WARNING' : 'INFO'}
              title={`Извлечено требований: ${result.extracted}`}
            >
              {result.unverifiedQuotes > 0 ? (
                <p>
                  У {result.unverifiedQuotes} требований цитата не найдена в тексте
                  документа — такие записи помечены и требуют проверки вручную.
                </p>
              ) : (
                <p>Все цитаты подтверждены поиском по тексту документов.</p>
              )}
              {result.limitations.length > 0 ? (
                <ul className="mt-1 list-disc pl-4">
                  {result.limitations.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              ) : null}
            </StatusNotice>
          ) : null}

          <div>
            <p className="mb-2 text-[13px] font-medium text-ink-700">
              Документы закупки для анализа
            </p>
            <DocumentPicker
              documents={documents}
              selected={selectedDocs}
              onChange={setSelectedDocs}
              emptyMessage="Сначала загрузите документацию закупки на странице документов."
            />
          </div>

          {canEdit ? (
            <Button
              type="button"
              loading={running}
              disabled={!aiConfigured || selectedDocs.length === 0}
              onClick={() => void runExtraction()}
            >
              <Sparkles className="size-4" aria-hidden />
              {running ? 'Анализ документов…' : 'Извлечь требования'}
            </Button>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            Требования: {requirements.length}, подтверждено {confirmed}
          </CardTitle>
          <CardDescription>
            Подтверждение означает, что вы согласны с формулировкой. Проверка
            заявки выполняется только по подтверждённым требованиям.
          </CardDescription>
        </CardHeader>
        <CardBody className="space-y-2.5">
          {requirements.length === 0 ? (
            <p className="rounded-lg border border-dashed border-ink-200 bg-ink-50/40 px-3.5 py-8 text-center text-[13px] text-ink-400">
              Требований нет. Извлеките их из документации закупки.
            </p>
          ) : (
            requirements.map((req) => (
              <div
                key={req.id}
                className={
                  req.confirmedByUser
                    ? 'rounded-lg border border-emerald-200 bg-emerald-50/40 p-3.5'
                    : 'rounded-lg border border-ink-200 p-3.5'
                }
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-medium text-ink-900">
                      {req.label ?? req.text.slice(0, 120)}
                    </p>
                    <p className="mt-1 text-[13px] leading-relaxed text-ink-600">
                      {req.text}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <Badge>{REQUIREMENT_CATEGORY_LABELS[req.category]}</Badge>
                      <Badge tone={req.isMandatory ? 'negative' : 'neutral'}>
                        {req.isMandatory ? 'обязательное' : 'необязательное'}
                      </Badge>
                      {req.origin === 'AI' ? <Badge tone="brand">AI</Badge> : null}
                      {req.pageNumber !== null ? (
                        <Badge tone="info">стр. {req.pageNumber}</Badge>
                      ) : req.origin === 'AI' ? (
                        <Badge tone="caution">страница не подтверждена</Badge>
                      ) : null}
                      {req.documentName ? <Badge>{req.documentName}</Badge> : null}
                    </div>
                    {req.sourceQuote ? (
                      <blockquote className="mt-2 border-l-2 border-ink-200 pl-2.5 text-[12.5px] italic leading-relaxed text-ink-500">
                        {req.sourceQuote}
                      </blockquote>
                    ) : null}
                  </div>

                  {canEdit ? (
                    <div className="flex shrink-0 gap-1.5">
                      <Button
                        type="button"
                        variant={req.confirmedByUser ? 'outline' : 'primary'}
                        size="sm"
                        loading={busyId === req.id}
                        onClick={() =>
                          void toggleConfirm(req.id, !req.confirmedByUser)
                        }
                      >
                        <Check className="size-3.5" aria-hidden />
                        {req.confirmedByUser ? 'Подтверждено' : 'Подтвердить'}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        loading={busyId === req.id}
                        onClick={() => void removeRequirement(req.id)}
                        className="text-red-600 hover:bg-red-50"
                        aria-label="Удалить требование"
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </Button>
                    </div>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </CardBody>
      </Card>
    </div>
  );
}
