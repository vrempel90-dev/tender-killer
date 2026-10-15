'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { StatusNotice } from '@/components/ui/status-notice';
import { PROCUREMENT_TYPE_LABELS } from '@/lib/tender-labels';

export interface TenderEditValues {
  id: string;
  title: string;
  externalNumber: string;
  sourceUrl: string;
  customerName: string;
  customerBin: string;
  procurementType: keyof typeof PROCUREMENT_TYPE_LABELS;
  startPrice: string;
  submissionDeadline: string;
  deliveryDeadline: string;
  region: string;
  notes: string;
}

export function TenderEditForm({ tender }: { tender: TenderEditValues }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    const form = new FormData(event.currentTarget);
    const startPriceRaw = String(form.get('startPrice') ?? '').trim();

    try {
      const response = await fetch(`/api/tenders/${tender.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? 'Не удалось сохранить изменения');
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError('Сервер недоступен.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (
      !window.confirm(
        `Удалить тендер «${tender.title}»? Вместе с ним будут удалены документы, `
        + 'требования, позиции, расчёты и результаты проверок. Действие необратимо.',
      )
    ) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      const response = await fetch(`/api/tenders/${tender.id}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const body = await response.json();
        setError(body.error ?? 'Не удалось удалить тендер');
        return;
      }
      router.push('/tenders');
    } catch {
      setError('Сервер недоступен.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error ? <StatusNotice severity="CRITICAL">{error}</StatusNotice> : null}
      {saved ? <StatusNotice severity="INFO">Изменения сохранены.</StatusNotice> : null}

      <Field label="Название закупки">
        {(id) => (
          <Input id={id} name="title" required minLength={3} defaultValue={tender.title} />
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Номер объявления / лота" hint="необязательно">
          {(id) => (
            <Input id={id} name="externalNumber" defaultValue={tender.externalNumber} />
          )}
        </Field>
        <Field label="Вид процедуры">
          {(id) => (
            <Select
              id={id}
              name="procurementType"
              defaultValue={tender.procurementType}
            >
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
          <Input id={id} name="sourceUrl" type="url" defaultValue={tender.sourceUrl} />
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Заказчик" hint="необязательно">
          {(id) => (
            <Input id={id} name="customerName" defaultValue={tender.customerName} />
          )}
        </Field>
        <Field label="БИН заказчика" hint="необязательно">
          {(id) => (
            <Input
              id={id}
              name="customerBin"
              pattern="\d{12}"
              inputMode="numeric"
              defaultValue={tender.customerBin}
            />
          )}
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Начальная цена закупки, ₸" hint="необязательно">
          {(id) => (
            <Input
              id={id}
              name="startPrice"
              type="number"
              min="0"
              step="0.01"
              defaultValue={tender.startPrice}
            />
          )}
        </Field>
        <Field label="Регион" hint="необязательно">
          {(id) => <Input id={id} name="region" defaultValue={tender.region} />}
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Срок подачи заявки" hint="необязательно">
          {(id) => (
            <Input
              id={id}
              name="submissionDeadline"
              type="date"
              defaultValue={tender.submissionDeadline}
            />
          )}
        </Field>
        <Field label="Срок поставки / исполнения" hint="необязательно">
          {(id) => (
            <Input
              id={id}
              name="deliveryDeadline"
              type="date"
              defaultValue={tender.deliveryDeadline}
            />
          )}
        </Field>
      </div>

      <Field label="Примечания" hint="необязательно">
        {(id) => (
          <Textarea id={id} name="notes" rows={3} defaultValue={tender.notes} />
        )}
      </Field>

      <div className="flex flex-wrap justify-between gap-3 border-t border-ink-100 pt-4">
        <Button type="submit" loading={saving}>
          Сохранить изменения
        </Button>
        <Button
          type="button"
          variant="danger"
          loading={deleting}
          onClick={() => void handleDelete()}
        >
          <Trash2 className="size-4" aria-hidden />
          Удалить тендер
        </Button>
      </div>
    </form>
  );
}
