'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { StatusNotice } from '@/components/ui/status-notice';
import { PROCUREMENT_TYPE_LABELS } from '@/lib/tender-labels';

export function TenderForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setDetails([]);
    const form = new FormData(event.currentTarget);

    const startPriceRaw = String(form.get('startPrice') ?? '').trim();
    const payload = {
      title: String(form.get('title') ?? ''),
      externalNumber: String(form.get('externalNumber') ?? ''),
      sourceUrl: String(form.get('sourceUrl') ?? ''),
      customerName: String(form.get('customerName') ?? ''),
      customerBin: String(form.get('customerBin') ?? ''),
      procurementType: String(form.get('procurementType') ?? 'OPEN_TENDER'),
      startPrice: startPriceRaw === '' ? null : Number(startPriceRaw),
      submissionDeadline: String(form.get('submissionDeadline') ?? ''),
      deliveryDeadline: String(form.get('deliveryDeadline') ?? ''),
      region: String(form.get('region') ?? ''),
      notes: String(form.get('notes') ?? ''),
    };

    try {
      const response = await fetch('/api/tenders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? 'Не удалось создать тендер');
        if (Array.isArray(result.details)) {
          setDetails(
            result.details.map(
              (d: { field: string; message: string }) => `${d.field}: ${d.message}`,
            ),
          );
        }
        return;
      }
      router.push(`/tenders/${result.data.id}`);
    } catch {
      setError('Сервер недоступен. Повторите попытку.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error ? (
        <StatusNotice severity="CRITICAL">
          <p>{error}</p>
          {details.length > 0 ? (
            <ul className="mt-1 list-disc pl-4">
              {details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          ) : null}
        </StatusNotice>
      ) : null}

      <Field label="Название закупки">
        {(id) => (
          <Input
            id={id}
            name="title"
            required
            minLength={3}
            placeholder="Поставка компьютерной техники для нужд управления"
          />
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Номер объявления / лота" hint="необязательно">
          {(id) => <Input id={id} name="externalNumber" placeholder="12345678-1" />}
        </Field>
        <Field label="Вид процедуры">
          {(id) => (
            <Select id={id} name="procurementType" defaultValue="OPEN_TENDER">
              {Object.entries(PROCUREMENT_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      <Field label="Ссылка на объявление" hint="необязательно">
        {(id) => (
          <Input
            id={id}
            name="sourceUrl"
            type="url"
            placeholder="https://goszakup.gov.kz/…"
          />
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Заказчик" hint="необязательно">
          {(id) => <Input id={id} name="customerName" placeholder="ГУ «Пример»" />}
        </Field>
        <Field label="БИН заказчика" hint="необязательно">
          {(id) => (
            <Input
              id={id}
              name="customerBin"
              inputMode="numeric"
              pattern="\d{12}"
              placeholder="12 цифр"
            />
          )}
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Начальная цена закупки, ₸"
          hint="необязательно"
          help="Сумма в тенге. Внутри системы хранится в тиын без потери точности."
        >
          {(id) => (
            <Input
              id={id}
              name="startPrice"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              placeholder="например 48 500 000"
            />
          )}
        </Field>
        <Field label="Регион" hint="необязательно">
          {(id) => <Input id={id} name="region" placeholder="г. Алматы" />}
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Срок подачи заявки" hint="необязательно">
          {(id) => <Input id={id} name="submissionDeadline" type="date" />}
        </Field>
        <Field label="Срок поставки / исполнения" hint="необязательно">
          {(id) => <Input id={id} name="deliveryDeadline" type="date" />}
        </Field>
      </div>

      <Field label="Примечания" hint="необязательно">
        {(id) => (
          <Textarea
            id={id}
            name="notes"
            rows={3}
            placeholder="Особые условия, замечания, договорённости с поставщиками"
          />
        )}
      </Field>

      <div className="flex gap-3 pt-1">
        <Button type="submit" loading={loading}>
          Создать и перейти к анализу
        </Button>
      </div>
    </form>
  );
}
