'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Copy, FileText, Sparkles, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { NotImplementedNotice, StatusNotice } from '@/components/ui/status-notice';
import { formatMinorKzt } from '@/lib/money';
import { DocumentPicker, type PickableDocument } from '@/components/compliance/document-picker';
import { QuoteForm, type DocumentOption, type LineItemOption } from './quote-form';

export interface QuoteItemView {
  id: string;
  name: string;
  unit: string;
  quantity: number;
  unitPriceMinor: number;
  unitPriceKztMinor: number | null;
  landedUnitCostMinor: number | null;
  specMatch: string;
  specMatchNote: string | null;
  leadTimeDays: number | null;
  lineItemId: string | null;
  issues: string[];
  isSelectedForLineItem: boolean;
}

export interface QuoteView {
  id: string;
  supplierName: string;
  supplierBin: string | null;
  verification: 'VERIFIED' | 'UNVERIFIED';
  currency: string;
  fxRate: number | null;
  pricesIncludeVat: boolean;
  validUntil: string | null;
  deliveryDays: number | null;
  documentName: string | null;
  items: QuoteItemView[];
}

export interface LineItemView {
  id: string;
  position: number;
  name: string;
  specification: string | null;
  unit: string;
  quantity: number;
  confirmedByUser: boolean;
  origin: string;
  pageNumber: number | null;
  selectedQuoteItemId: string | null;
  /** Подтверждённая закупочная цена за единицу, тиын. */
  selectedUnitCostMinor: number | null;
  selectedSupplierName: string | null;
  optionsCount: number;
}

const SPEC_MATCH_LABELS: Record<string, string> = {
  MATCH: 'соответствует',
  PARTIAL: 'частично',
  MISMATCH: 'не соответствует',
  UNKNOWN: 'не проверено',
};

export function SourcingPanel({
  tenderId,
  lineItems,
  quotes,
  specDocuments,
  quoteDocuments,
  aiConfigured,
  canEdit,
  financeHref,
}: {
  tenderId: string;
  lineItems: LineItemView[];
  quotes: QuoteView[];
  specDocuments: PickableDocument[];
  quoteDocuments: DocumentOption[];
  aiConfigured: boolean;
  canEdit: boolean;
  financeHref: string;
}) {
  const router = useRouter();
  const [selectedSpecDocs, setSelectedSpecDocs] = useState<string[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extractResult, setExtractResult] = useState<{
    extracted: number;
    withoutQuantity: number;
    unverifiedQuotes: number;
    limitations: string[];
  } | null>(null);
  const [rfq, setRfq] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function extractItems() {
    setExtracting(true);
    setError(null);
    setExtractResult(null);
    try {
      const response = await fetch(`/api/tenders/${tenderId}/line-items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentIds: selectedSpecDocs,
          replaceExisting: true,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? 'Не удалось извлечь позиции');
        return;
      }
      setExtractResult(body.data);
      router.refresh();
    } catch {
      setError('Сервер недоступен.');
    } finally {
      setExtracting(false);
    }
  }

  async function loadRfq() {
    setError(null);
    try {
      const response = await fetch(`/api/tenders/${tenderId}/rfq`);
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? 'Не удалось сформировать запрос');
        return;
      }
      setRfq(body.data.text);
    } catch {
      setError('Сервер недоступен.');
    }
  }

  async function selectQuoteItem(lineItemId: string, quoteItemId: string | null) {
    setBusyId(lineItemId);
    try {
      await fetch(`/api/tenders/${tenderId}/line-items`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lineItemId,
          selectedQuoteItemId: quoteItemId,
          confirmedByUser: quoteItemId !== null,
        }),
      });
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function deleteQuote(quoteId: string, supplierName: string) {
    if (!window.confirm(`Удалить предложение «${supplierName}»?`)) return;
    setBusyId(quoteId);
    try {
      await fetch(
        `/api/tenders/${tenderId}/quotes?quoteId=${encodeURIComponent(quoteId)}`,
        { method: 'DELETE' },
      );
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  const confirmedCostMinor = lineItems.reduce(
    (sum, item) =>
      item.selectedUnitCostMinor === null
        ? sum
        : sum + Math.round(item.selectedUnitCostMinor * item.quantity),
    0,
  );
  const itemsWithoutPrice = lineItems.filter(
    (item) => item.selectedUnitCostMinor === null,
  );

  return (
    <div className="space-y-5">
      {error ? <StatusNotice severity="CRITICAL">{error}</StatusNotice> : null}

      {/* Шаг 1: позиции */}
      <Card>
        <CardHeader>
          <CardTitle>Позиции закупки</CardTitle>
          <CardDescription>
            Позиции извлекаются из технической спецификации и подтверждаются
            вами. Цены берутся только из предложений поставщиков — платформа не
            оценивает рыночную стоимость самостоятельно.
          </CardDescription>
        </CardHeader>
        <CardBody className="space-y-4">
          {!aiConfigured ? (
            <NotImplementedNotice
              feature="Автоматическое извлечение позиций"
              requires={
                'Требуется ANTHROPIC_API_KEY. Позиции можно добавить вручную '
                + 'при вводе предложения поставщика.'
              }
            />
          ) : null}

          {extractResult ? (
            <StatusNotice
              severity={
                extractResult.withoutQuantity > 0 || extractResult.unverifiedQuotes > 0
                  ? 'WARNING'
                  : 'INFO'
              }
              title={`Извлечено позиций: ${extractResult.extracted}`}
            >
              {extractResult.withoutQuantity > 0 ? (
                <p>
                  У {extractResult.withoutQuantity} позиций количество не указано в
                  документе — заполните его вручную.
                </p>
              ) : null}
              {extractResult.unverifiedQuotes > 0 ? (
                <p>
                  У {extractResult.unverifiedQuotes} позиций цитата не найдена в
                  тексте — проверьте их.
                </p>
              ) : null}
              {extractResult.limitations.length > 0 ? (
                <ul className="mt-1 list-disc pl-4">
                  {extractResult.limitations.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              ) : null}
            </StatusNotice>
          ) : null}

          <div>
            <p className="mb-2 text-[13px] font-medium text-ink-700">
              Техническая спецификация
            </p>
            <DocumentPicker
              documents={specDocuments}
              selected={selectedSpecDocs}
              onChange={setSelectedSpecDocs}
              emptyMessage="Загрузите техническую спецификацию на странице документов."
            />
          </div>

          {canEdit ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                loading={extracting}
                disabled={!aiConfigured || selectedSpecDocs.length === 0}
                onClick={() => void extractItems()}
              >
                <Sparkles className="size-4" aria-hidden />
                {extracting ? 'Извлечение позиций…' : 'Извлечь позиции'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void loadRfq()}
              >
                <FileText className="size-4" aria-hidden />
                Сформировать запрос КП
              </Button>
            </div>
          ) : null}

          {rfq !== null ? (
            <div className="rounded-lg border border-ink-200 bg-ink-50/60 p-3.5">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-[13px] font-medium text-ink-800">
                  Запрос коммерческого предложения
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard.writeText(rfq);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                >
                  <Copy className="size-3.5" aria-hidden />
                  {copied ? 'Скопировано' : 'Копировать'}
                </Button>
              </div>
              <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed text-ink-700 scrollbar-slim">
                {rfq}
              </pre>
            </div>
          ) : null}
        </CardBody>
      </Card>

      {/* Сводка себестоимости */}
      {lineItems.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Подтверждённая закупочная себестоимость</CardTitle>
            <CardDescription>
              Сумма считается только по позициям с выбранным предложением
              поставщика. Остальные позиции показаны как незаполненные —
              платформа не подставляет вместо них оценку.
            </CardDescription>
          </CardHeader>
          <CardBody className="space-y-3">
            <div className="grid gap-3.5 sm:grid-cols-3">
              <div className="rounded-lg border border-ink-200 px-3.5 py-3">
                <p className="text-[12px] uppercase tracking-wide text-ink-400">
                  Подтверждено
                </p>
                <p className="mt-1 text-[20px] font-semibold tabular text-ink-900">
                  {formatMinorKzt(confirmedCostMinor)}
                </p>
              </div>
              <div className="rounded-lg border border-ink-200 px-3.5 py-3">
                <p className="text-[12px] uppercase tracking-wide text-ink-400">
                  Позиций с ценой
                </p>
                <p className="mt-1 text-[20px] font-semibold tabular text-ink-900">
                  {lineItems.length - itemsWithoutPrice.length} из {lineItems.length}
                </p>
              </div>
              <div className="rounded-lg border border-ink-200 px-3.5 py-3">
                <p className="text-[12px] uppercase tracking-wide text-ink-400">
                  Без подтверждённой цены
                </p>
                <p className="mt-1 text-[20px] font-semibold tabular text-amber-700">
                  {itemsWithoutPrice.length}
                </p>
              </div>
            </div>
            {itemsWithoutPrice.length === 0 && lineItems.length > 0 ? (
              <StatusNotice severity="INFO">
                Все позиции обеспечены подтверждёнными ценами. Эти цены
                автоматически подставляются в расчёт экономики —{' '}
                <a
                  href={financeHref}
                  className="font-medium text-brand-600 hover:text-brand-700"
                >
                  открыть калькулятор
                </a>
                .
              </StatusNotice>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {/* Таблица позиций с выбором предложения */}
      <Card>
        <CardHeader>
          <CardTitle>Позиции и выбранные предложения ({lineItems.length})</CardTitle>
        </CardHeader>
        <CardBody className="space-y-2.5">
          {lineItems.length === 0 ? (
            <p className="rounded-lg border border-dashed border-ink-200 bg-ink-50/40 px-3.5 py-8 text-center text-[13px] text-ink-400">
              Позиций нет. Извлеките их из спецификации или добавьте при вводе
              предложения поставщика.
            </p>
          ) : (
            lineItems.map((item) => {
              const options = quotes.flatMap((quote) =>
                quote.items
                  .filter((qi) => qi.lineItemId === item.id)
                  .map((qi) => ({ quote, qi })),
              );
              return (
                <div
                  key={item.id}
                  className="rounded-lg border border-ink-200 p-3.5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] font-medium text-ink-900">
                        {item.position}. {item.name}
                      </p>
                      <p className="mt-0.5 text-[12.5px] text-ink-500">
                        {item.quantity > 0
                          ? `${item.quantity} ${item.unit}`
                          : 'количество не указано'}
                        {item.specification ? ` · ${item.specification}` : ''}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {item.origin === 'AI' ? <Badge tone="brand">AI</Badge> : null}
                        {item.pageNumber !== null ? (
                          <Badge tone="info">стр. {item.pageNumber}</Badge>
                        ) : null}
                        {item.quantity === 0 ? (
                          <Badge tone="caution">нет количества</Badge>
                        ) : null}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      {item.selectedUnitCostMinor !== null ? (
                        <>
                          <p className="text-[12px] text-ink-400">
                            {item.selectedSupplierName}
                          </p>
                          <p className="tabular text-[15px] font-semibold text-emerald-700">
                            {formatMinorKzt(item.selectedUnitCostMinor)} / {item.unit}
                          </p>
                          <p className="text-[12px] text-ink-500">
                            Итого{' '}
                            {formatMinorKzt(
                              Math.round(item.selectedUnitCostMinor * item.quantity),
                            )}
                          </p>
                        </>
                      ) : (
                        <Badge tone="caution">цена не подтверждена</Badge>
                      )}
                    </div>
                  </div>

                  {options.length > 0 ? (
                    <div className="mt-3 space-y-1.5 border-t border-ink-100 pt-3">
                      <p className="text-[12px] font-medium uppercase tracking-wide text-ink-400">
                        Предложения ({options.length})
                      </p>
                      {options.map(({ quote, qi }) => (
                        <div
                          key={qi.id}
                          className={
                            qi.isSelectedForLineItem
                              ? 'flex flex-wrap items-center justify-between gap-2 rounded-md border border-emerald-300 bg-emerald-50/60 px-2.5 py-2'
                              : 'flex flex-wrap items-center justify-between gap-2 rounded-md border border-ink-150 border-ink-200 px-2.5 py-2'
                          }
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-[13px] font-medium text-ink-800">
                              {quote.supplierName}
                            </p>
                            <div className="mt-1 flex flex-wrap gap-1.5">
                              <Badge
                                tone={
                                  quote.verification === 'VERIFIED'
                                    ? 'positive'
                                    : 'caution'
                                }
                              >
                                {quote.verification === 'VERIFIED'
                                  ? 'подтверждено документом'
                                  : 'без документа'}
                              </Badge>
                              <Badge
                                tone={
                                  qi.specMatch === 'MATCH'
                                    ? 'positive'
                                    : qi.specMatch === 'MISMATCH'
                                      ? 'negative'
                                      : 'caution'
                                }
                              >
                                {SPEC_MATCH_LABELS[qi.specMatch] ?? qi.specMatch}
                              </Badge>
                              {qi.leadTimeDays !== null ? (
                                <Badge>{qi.leadTimeDays} дн.</Badge>
                              ) : null}
                              {quote.currency !== 'KZT' ? (
                                <Badge tone="info">
                                  {quote.currency}
                                  {quote.fxRate ? ` × ${quote.fxRate}` : ''}
                                </Badge>
                              ) : null}
                            </div>
                            {qi.issues.length > 0 ? (
                              <p className="mt-1 text-[11.5px] leading-snug text-amber-700">
                                {qi.issues.join(' ')}
                              </p>
                            ) : null}
                          </div>
                          <div className="flex items-center gap-2.5">
                            <div className="text-right">
                              <p className="tabular text-[13.5px] font-semibold text-ink-900">
                                {qi.unitPriceKztMinor === null
                                  ? 'курс не задан'
                                  : `${formatMinorKzt(qi.unitPriceKztMinor)} / ${qi.unit}`}
                              </p>
                            </div>
                            {canEdit ? (
                              <Button
                                type="button"
                                size="sm"
                                variant={
                                  qi.isSelectedForLineItem ? 'outline' : 'primary'
                                }
                                loading={busyId === item.id}
                                onClick={() =>
                                  void selectQuoteItem(
                                    item.id,
                                    qi.isSelectedForLineItem ? null : qi.id,
                                  )
                                }
                              >
                                {qi.isSelectedForLineItem ? 'Снять выбор' : 'Выбрать'}
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 border-t border-ink-100 pt-3 text-[12.5px] text-ink-400">
                      Предложений по этой позиции нет. Добавьте предложение
                      поставщика и сопоставьте его с позицией.
                    </p>
                  )}
                </div>
              );
            })
          )}
        </CardBody>
      </Card>

      {/* Ввод предложения */}
      {canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle>Добавить коммерческое предложение</CardTitle>
            <CardDescription>
              Введите данные из полученного КП или прайс-листа. Если приложить
              загруженный документ, предложение будет считаться подтверждённым.
            </CardDescription>
          </CardHeader>
          <CardBody>
            <QuoteForm
              tenderId={tenderId}
              lineItems={lineItems.map(
                (item): LineItemOption => ({
                  id: item.id,
                  name: item.name,
                  unit: item.unit,
                  quantity: item.quantity,
                }),
              )}
              documents={quoteDocuments}
            />
          </CardBody>
        </Card>
      ) : null}

      {/* Список предложений */}
      {quotes.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Предложения поставщиков ({quotes.length})</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2">
            {quotes.map((quote) => (
              <div
                key={quote.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink-200 px-3.5 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-medium text-ink-900">
                    {quote.supplierName}
                    {quote.supplierBin ? (
                      <span className="ml-2 text-[12px] font-normal text-ink-400">
                        БИН {quote.supplierBin}
                      </span>
                    ) : null}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Badge
                      tone={
                        quote.verification === 'VERIFIED' ? 'positive' : 'caution'
                      }
                    >
                      {quote.verification === 'VERIFIED'
                        ? quote.documentName ?? 'подтверждено'
                        : 'без документа-основания'}
                    </Badge>
                    <Badge>{quote.items.length} позиций</Badge>
                    <Badge>
                      {quote.pricesIncludeVat ? 'цены с НДС' : 'цены без НДС'}
                    </Badge>
                    {quote.validUntil ? (
                      <Badge
                        tone={
                          new Date(quote.validUntil) < new Date()
                            ? 'negative'
                            : 'neutral'
                        }
                      >
                        до{' '}
                        {new Intl.DateTimeFormat('ru-KZ', {
                          dateStyle: 'short',
                        }).format(new Date(quote.validUntil))}
                      </Badge>
                    ) : null}
                  </div>
                </div>
                {canEdit ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    loading={busyId === quote.id}
                    onClick={() => void deleteQuote(quote.id, quote.supplierName)}
                    className="text-red-600 hover:bg-red-50"
                    aria-label="Удалить предложение"
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </Button>
                ) : null}
              </div>
            ))}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
