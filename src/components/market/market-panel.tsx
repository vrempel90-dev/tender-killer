'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Trash2, Upload } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusNotice } from '@/components/ui/status-notice';
import { formatMinorKzt, formatRatioAsPercent } from '@/lib/money';
import { FIELD_LABELS, type MarketField } from '@/lib/market/import';
import type {
  CustomerStats,
  DiscountStats,
  WinnerStats,
} from '@/lib/market/analytics';

export interface ImportBatch {
  batchId: string;
  sourceRef: string;
  importedAt: string;
  count: number;
}

export function MarketPanel({
  recordsCount,
  discountStats,
  winners,
  customers,
  batches,
  canEdit,
}: {
  recordsCount: number;
  discountStats: DiscountStats;
  winners: WinnerStats[];
  customers: CustomerStats[];
  batches: ImportBatch[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    imported: number;
    skipped: number;
    missingFields: MarketField[];
    sourceRef: string;
  } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    setResult(null);
    const form = new FormData();
    form.append('file', file);
    try {
      const response = await fetch('/api/market/import', {
        method: 'POST',
        body: form,
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? 'Не удалось импортировать файл');
        return;
      }
      setResult(body.data);
      router.refresh();
    } catch {
      setError('Сервер недоступен.');
    } finally {
      setUploading(false);
    }
  }

  async function deleteBatch(batchId: string, sourceRef: string, count: number) {
    if (
      !window.confirm(
        `Удалить ${count} записей, импортированных из «${sourceRef}»?`,
      )
    ) {
      return;
    }
    setBusyId(batchId);
    try {
      await fetch(
        `/api/market/import?batchId=${encodeURIComponent(batchId)}`,
        { method: 'DELETE' },
      );
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-5">
      <StatusNotice severity="INFO" title="Откуда берутся данные">
        Платформа не загружает сведения о закупках самостоятельно: подключение
        к API порталов требует законного доступа и токенов. Аналитика строится
        только на данных, которые вы импортировали — обычно это выгрузка с
        портала государственных закупок или открытые данные. Каждая запись
        хранит имя файла-источника.
      </StatusNotice>

      <Card>
        <CardHeader>
          <CardTitle>Импорт завершённых закупок</CardTitle>
          <CardDescription>
            Форматы CSV, XLSX. Колонки распознаются автоматически по заголовкам:
            номер, наименование, заказчик и его БИН, плановая сумма, сумма
            договора, победитель, количество участников, дата заключения, способ
            закупки.
          </CardDescription>
        </CardHeader>
        <CardBody className="space-y-3.5">
          {error ? <StatusNotice severity="CRITICAL">{error}</StatusNotice> : null}

          {result ? (
            <StatusNotice
              severity={result.skipped > 0 ? 'WARNING' : 'INFO'}
              title={`Импортировано записей: ${result.imported}`}
            >
              <p>Источник: {result.sourceRef}</p>
              {result.skipped > 0 ? (
                <p>Пропущено строк: {result.skipped} (нет наименования закупки).</p>
              ) : null}
              {result.missingFields.length > 0 ? (
                <p className="mt-1">
                  В файле не найдены колонки:{' '}
                  {result.missingFields.map((f) => FIELD_LABELS[f]).join(', ')}.
                  Показатели, зависящие от них, рассчитаны не будут.
                </p>
              ) : null}
            </StatusNotice>
          ) : null}

          {canEdit ? (
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
                e.target.value = '';
              }}
              className="h-10 w-full cursor-pointer rounded-lg border border-ink-200 bg-white px-3 py-2 text-[13px] file:mr-3 file:rounded file:border-0 file:bg-ink-100 file:px-2.5 file:py-1 file:text-[12.5px] file:font-medium file:text-ink-700 hover:file:bg-ink-200 sm:max-w-md"
              aria-label="Файл с данными закупок"
            />
          ) : (
            <p className="text-[12.5px] text-ink-500">
              У вашей роли нет прав на импорт данных.
            </p>
          )}

          {uploading ? (
            <p className="flex items-center gap-2 text-[13px] text-ink-500">
              <Upload className="size-3.5 animate-pulse" aria-hidden />
              Обработка файла…
            </p>
          ) : null}
        </CardBody>
      </Card>

      {recordsCount === 0 ? (
        <EmptyState
          title="Данных о закупках нет"
          description="Импортируйте выгрузку завершённых закупок, чтобы увидеть историческое снижение цены, победителей и заказчиков. Фиктивную статистику платформа не создаёт."
        />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Историческое снижение цены</CardTitle>
              <CardDescription>{discountStats.note}</CardDescription>
            </CardHeader>
            <CardBody>
              {!discountStats.sufficientSample ? (
                <StatusNotice severity="WARNING" className="mb-3.5">
                  Выборка недостаточна для выводов. Значения ниже описывают
                  только импортированные записи и не могут служить ориентиром
                  для ценовой стратегии.
                </StatusNotice>
              ) : null}
              <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
                <Metric
                  label="Среднее снижение"
                  value={formatRatioAsPercent(discountStats.averageDiscountRatio)}
                />
                <Metric
                  label="Медианное снижение"
                  value={formatRatioAsPercent(discountStats.medianDiscountRatio)}
                />
                <Metric
                  label="Минимальное"
                  value={formatRatioAsPercent(discountStats.minDiscountRatio)}
                />
                <Metric
                  label="Максимальное"
                  value={formatRatioAsPercent(discountStats.maxDiscountRatio)}
                />
              </div>
              <p className="mt-3 text-[12px] leading-relaxed text-ink-400">
                Снижение считается как (начальная цена − итоговая цена) ÷
                начальная цена. Записи без пары цен исключены из расчёта.
                Эта статистика описывает прошлые закупки и не является оценкой
                вероятности победы.
              </p>
            </CardBody>
          </Card>

          <div className="grid gap-5 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Победители ({winners.length})</CardTitle>
              </CardHeader>
              <CardBody className="p-0">
                {winners.length === 0 ? (
                  <p className="px-5 py-6 text-center text-[13px] text-ink-400">
                    В импортированных данных нет сведений о победителях.
                  </p>
                ) : (
                  <div className="max-h-[420px] overflow-auto scrollbar-slim">
                    <table className="w-full text-[13px]">
                      <thead className="sticky top-0 bg-white">
                        <tr className="border-b border-ink-100 text-left text-[12px] uppercase tracking-wide text-ink-400">
                          <th className="px-5 py-2.5 font-medium">Поставщик</th>
                          <th className="px-5 py-2.5 text-right font-medium">Побед</th>
                          <th className="px-5 py-2.5 text-right font-medium">
                            Сумма договоров
                          </th>
                          <th className="px-5 py-2.5 text-right font-medium">
                            Ср. снижение
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {winners.slice(0, 50).map((winner) => (
                          <tr
                            key={`${winner.bin ?? winner.name}`}
                            className="border-b border-ink-50 last:border-0"
                          >
                            <td className="px-5 py-2.5">
                              <p className="font-medium text-ink-900">{winner.name}</p>
                              {winner.bin ? (
                                <p className="text-[11.5px] text-ink-400">
                                  БИН {winner.bin}
                                </p>
                              ) : null}
                            </td>
                            <td className="px-5 py-2.5 text-right tabular text-ink-700">
                              {winner.winsCount}
                            </td>
                            <td className="px-5 py-2.5 text-right tabular text-ink-700">
                              {formatMinorKzt(winner.totalFinalPriceMinor)}
                              {winner.recordsWithoutPrice > 0 ? (
                                <span className="block text-[11px] text-ink-400">
                                  без цены: {winner.recordsWithoutPrice}
                                </span>
                              ) : null}
                            </td>
                            <td className="px-5 py-2.5 text-right tabular text-ink-600">
                              {formatRatioAsPercent(winner.averageDiscountRatio)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Заказчики ({customers.length})</CardTitle>
              </CardHeader>
              <CardBody className="p-0">
                {customers.length === 0 ? (
                  <p className="px-5 py-6 text-center text-[13px] text-ink-400">
                    В импортированных данных нет сведений о заказчиках.
                  </p>
                ) : (
                  <div className="max-h-[420px] overflow-auto scrollbar-slim">
                    <table className="w-full text-[13px]">
                      <thead className="sticky top-0 bg-white">
                        <tr className="border-b border-ink-100 text-left text-[12px] uppercase tracking-wide text-ink-400">
                          <th className="px-5 py-2.5 font-medium">Заказчик</th>
                          <th className="px-5 py-2.5 text-right font-medium">Закупок</th>
                          <th className="px-5 py-2.5 text-right font-medium">
                            Ср. снижение
                          </th>
                          <th className="px-5 py-2.5 text-right font-medium">
                            Ср. участников
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {customers.slice(0, 50).map((customer) => (
                          <tr
                            key={`${customer.bin ?? customer.name}`}
                            className="border-b border-ink-50 last:border-0"
                          >
                            <td className="px-5 py-2.5">
                              <p className="font-medium text-ink-900">
                                {customer.name}
                              </p>
                              {customer.bin ? (
                                <p className="text-[11.5px] text-ink-400">
                                  БИН {customer.bin}
                                </p>
                              ) : null}
                            </td>
                            <td className="px-5 py-2.5 text-right tabular text-ink-700">
                              {customer.tendersCount}
                            </td>
                            <td className="px-5 py-2.5 text-right tabular text-ink-600">
                              {formatRatioAsPercent(customer.averageDiscountRatio)}
                            </td>
                            <td className="px-5 py-2.5 text-right tabular text-ink-600">
                              {customer.averageParticipants === null
                                ? '—'
                                : customer.averageParticipants.toFixed(1)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Импортированные файлы</CardTitle>
              <CardDescription>
                Источник каждой записи сохраняется. Импорт можно удалить целиком.
              </CardDescription>
            </CardHeader>
            <CardBody className="space-y-2">
              {batches.map((batch) => (
                <div
                  key={batch.batchId}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink-200 px-3.5 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-ink-900">
                      {batch.sourceRef}
                    </p>
                    <p className="text-[12px] text-ink-400">
                      {new Intl.DateTimeFormat('ru-KZ', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      }).format(new Date(batch.importedAt))}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge>{batch.count} записей</Badge>
                    {canEdit ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        loading={busyId === batch.batchId}
                        onClick={() =>
                          void deleteBatch(
                            batch.batchId,
                            batch.sourceRef,
                            batch.count,
                          )
                        }
                        className="text-red-600 hover:bg-red-50"
                        aria-label="Удалить импорт"
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-ink-200 px-3.5 py-3">
      <p className="text-[12px] uppercase tracking-wide text-ink-400">{label}</p>
      <p className="mt-1 text-[20px] font-semibold tabular text-ink-900">{value}</p>
    </div>
  );
}
