'use client';

/**
 * Импорт выгрузки объявлений.
 *
 * Источник и дата актуальности — обязательные поля. Они не угадываются:
 * без них закупка показывалась бы без указания, откуда она и насколько
 * свежа, и пользователь мог бы принять решение по устаревшим данным.
 *
 * Перед записью доступен предпросмотр: видно, какие колонки распознаны,
 * что будет импортировано и какие строки отклонены.
 */

import { useState } from 'react';
import { FileSpreadsheet, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/field';
import { StatusNotice } from '@/components/ui/status-notice';

interface Preview {
  headers: string[];
  mapping: Record<string, number>;
  warnings: string[];
  totalRows: number;
  skipped: Array<{ rowNumber: number; reason: string }>;
  preview: Array<{
    title: string;
    customerName: string | null;
    priceMinor: number | null;
    deadline: string | null;
  }>;
}

const FIELD_TITLES: Record<string, string> = {
  externalId: 'Номер объявления',
  title: 'Наименование',
  customerName: 'Заказчик',
  customerBin: 'БИН заказчика',
  price: 'Плановая сумма',
  procurementType: 'Способ закупки',
  region: 'Регион',
  deadline: 'Окончание приёма заявок',
  deliveryDeadline: 'Срок поставки',
  sourceUrl: 'Ссылка',
};

export function RadarImportForm({ onImported }: { onImported: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<{
    sourceName: string;
    sourceUrl: string;
    actualAt: string;
  }>({
    sourceName: '',
    sourceUrl: '',
    actualAt: new Date().toISOString().slice(0, 10),
  });
  const [file, setFile] = useState<File | null>(null);

  async function send(dryRun: boolean) {
    if (!file) {
      setError('Выберите файл выгрузки');
      return;
    }
    if (form.sourceName.trim().length < 3) {
      setError('Укажите источник данных: например, «goszakup.gov.kz, экспорт объявлений»');
      return;
    }
    if (!form.actualAt) {
      setError('Укажите дату, на которую данные актуальны');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const body = new FormData();
      body.set('file', file);
      body.set('sourceName', form.sourceName.trim());
      if (form.sourceUrl.trim().length > 0) body.set('sourceUrl', form.sourceUrl.trim());
      // Дата приводится к полудню UTC: так она не «съезжает» на сутки
      // из-за часового пояса пользователя.
      body.set('actualAt', new Date(`${form.actualAt}T12:00:00.000Z`).toISOString());
      if (dryRun) body.set('dryRun', 'true');

      const response = await fetch('/api/radar/imports', { method: 'POST', body });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? 'Не удалось импортировать файл');
        return;
      }
      if (dryRun) {
        setPreview(payload.data as Preview);
        return;
      }
      setPreview(null);
      onImported();
    } catch {
      setError('Сервер недоступен. Повторите попытку.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="flex items-center gap-2">
            <FileSpreadsheet className="size-4 text-ink-400" aria-hidden />
            Импорт выгрузки объявлений
          </span>
        </CardTitle>
        <CardDescription>
          Поддерживаются CSV и XLSX. Колонки распознаются по заголовкам; значения,
          которые не удалось разобрать, остаются пустыми — система их не достраивает.
        </CardDescription>
      </CardHeader>
      <CardBody className="space-y-4">
        {error ? <StatusNotice severity="CRITICAL">{error}</StatusNotice> : null}

        <div className="grid gap-4 md:grid-cols-3">
          <Field
            label="Источник данных"
            help="Откуда выгрузка: название портала или реестра."
          >
            {(id) => (
              <Input
                id={id}
                value={form.sourceName}
                onChange={(event) => setForm({ ...form, sourceName: event.target.value })}
                placeholder="goszakup.gov.kz, экспорт объявлений"
                maxLength={200}
              />
            )}
          </Field>
          <Field label="Ссылка на источник" hint="необязательно">
            {(id) => (
              <Input
                id={id}
                type="url"
                value={form.sourceUrl}
                onChange={(event) => setForm({ ...form, sourceUrl: event.target.value })}
                placeholder="https://…"
                maxLength={500}
              />
            )}
          </Field>
          <Field
            label="Данные актуальны на"
            help="Дата выгрузки. Без неё непонятно, насколько свежи сроки подачи."
          >
            {(id) => (
              <Input
                id={id}
                type="date"
                value={form.actualAt}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(event) => setForm({ ...form, actualAt: event.target.value })}
              />
            )}
          </Field>
        </div>

        <Field label="Файл выгрузки">
          {(id) => (
            <input
              id={id}
              type="file"
              accept=".csv,.xlsx"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setPreview(null);
              }}
              className="block w-full text-[13px] text-ink-700 file:mr-3 file:rounded-lg
                file:border-0 file:bg-ink-100 file:px-3 file:py-2 file:text-[13px]
                file:font-medium file:text-ink-800 hover:file:bg-ink-200"
            />
          )}
        </Field>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            loading={loading && preview === null}
            onClick={() => void send(true)}
          >
            Предпросмотр
          </Button>
          <Button type="button" loading={loading} onClick={() => void send(false)}>
            <Upload className="size-4" aria-hidden />
            Импортировать
          </Button>
        </div>

        {preview ? (
          <div className="space-y-3 rounded-lg border border-ink-200 bg-ink-50/60 p-3.5">
            <p className="text-[13px] font-medium text-ink-900">
              Будет импортировано записей: {preview.totalRows}
            </p>

            <div className="text-[13px]">
              <p className="font-medium text-ink-800">Распознанные колонки</p>
              <ul className="mt-1 grid gap-0.5 sm:grid-cols-2">
                {Object.entries(preview.mapping).map(([field, index]) => (
                  <li key={field} className="text-ink-600">
                    {FIELD_TITLES[field] ?? field}: «{preview.headers[index] ?? '—'}»
                  </li>
                ))}
              </ul>
            </div>

            {preview.warnings.length > 0 ? (
              <StatusNotice severity="WARNING" title="На что обратить внимание">
                <ul className="space-y-1">
                  {preview.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </StatusNotice>
            ) : null}

            {preview.skipped.length > 0 ? (
              <div className="text-[13px]">
                <p className="font-medium text-amber-700">
                  Отклонённые строки: {preview.skipped.length}
                </p>
                <ul className="mt-1 space-y-0.5 text-ink-600">
                  {preview.skipped.slice(0, 5).map((row) => (
                    <li key={row.rowNumber}>
                      строка {row.rowNumber}: {row.reason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="text-[13px]">
              <p className="font-medium text-ink-800">Первые записи</p>
              <ul className="mt-1 space-y-1 text-ink-600">
                {preview.preview.map((row, index) => (
                  <li key={`${row.title}-${index}`}>
                    {row.title}
                    {row.priceMinor !== null
                      ? ` — ${(row.priceMinor / 100).toLocaleString('ru-KZ')} ₸`
                      : ' — сумма не распознана'}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
