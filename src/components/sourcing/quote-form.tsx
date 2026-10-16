'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { StatusNotice } from '@/components/ui/status-notice';

export interface LineItemOption {
  id: string;
  name: string;
  unit: string;
  quantity: number;
}

export interface DocumentOption {
  id: string;
  originalName: string;
}

interface DraftItem {
  name: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  lineItemId: string;
  specMatch: 'MATCH' | 'PARTIAL' | 'MISMATCH' | 'UNKNOWN';
  specMatchNote: string;
  leadTimeDays: string;
}

function emptyItem(): DraftItem {
  return {
    name: '',
    unit: 'шт',
    quantity: '',
    unitPrice: '',
    lineItemId: '',
    specMatch: 'UNKNOWN',
    specMatchNote: '',
    leadTimeDays: '',
  };
}

export function QuoteForm({
  tenderId,
  lineItems,
  documents,
}: {
  tenderId: string;
  lineItems: LineItemOption[];
  documents: DocumentOption[];
}) {
  const router = useRouter();
  const [items, setItems] = useState<DraftItem[]>([emptyItem()]);
  const [currency, setCurrency] = useState('KZT');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<string[]>([]);

  function updateItem(index: number, patch: Partial<DraftItem>) {
    setItems(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setDetails([]);
    const form = new FormData(event.currentTarget);

    const payload = {
      supplierName: String(form.get('supplierName') ?? ''),
      supplierBin: emptyToNull(String(form.get('supplierBin') ?? '')),
      contact: emptyToNull(String(form.get('contact') ?? '')),
      documentId: emptyToNull(String(form.get('documentId') ?? '')),
      currency,
      fxRate:
        currency === 'KZT'
          ? null
          : numberOrNull(String(form.get('fxRate') ?? '')),
      pricesIncludeVat: form.get('pricesIncludeVat') === 'on',
      supplierChargesVat: form.get('supplierChargesVat') === 'true' ? true : form.get('supplierChargesVat') === 'false' ? false : null,
      valuesConfirmed: form.get('valuesConfirmed') === 'on',
      validUntil: emptyToNull(String(form.get('validUntil') ?? '')),
      deliveryDays: numberOrNull(String(form.get('deliveryDays') ?? '')),
      notes: emptyToNull(String(form.get('notes') ?? '')),
      items: items
        .filter((item) => item.name.trim().length > 0)
        .map((item) => ({
          name: item.name,
          unit: item.unit || 'шт',
          quantity: Number(item.quantity) || 0,
          unitPrice: Number(item.unitPrice) || 0,
          lineItemId: item.lineItemId.length > 0 ? item.lineItemId : null,
          specMatch: item.specMatch,
          specMatchNote: emptyToNull(item.specMatchNote),
          leadTimeDays: numberOrNull(item.leadTimeDays),
        })),
    };

    try {
      const response = await fetch(`/api/tenders/${tenderId}/quotes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? 'Не удалось сохранить предложение');
        if (Array.isArray(body.details)) {
          setDetails(
            body.details.map(
              (d: { field: string; message: string }) => `${d.field}: ${d.message}`,
            ),
          );
        }
        return;
      }
      setItems([emptyItem()]);
      (event.target as HTMLFormElement).reset();
      router.refresh();
    } catch {
      setError('Сервер недоступен.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
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

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Поставщик">
          {(id) => (
            <Input id={id} name="supplierName" required placeholder="ТОО «Поставщик»" />
          )}
        </Field>
        <Field label="БИН поставщика" hint="необязательно">
          {(id) => (
            <Input id={id} name="supplierBin" pattern="\d{12}" inputMode="numeric" />
          )}
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Контакт" hint="необязательно">
          {(id) => (
            <Input id={id} name="contact" placeholder="менеджер, телефон, e-mail" />
          )}
        </Field>
        <Field
          label="Документ-основание"
          help="Предложение с документом считается подтверждённым"
        >
          {(id) => (
            <Select id={id} name="documentId" defaultValue="">
              <option value="">без документа (не подтверждено)</option>
              {documents.map((doc) => (
                <option key={doc.id} value={doc.id}>
                  {doc.originalName}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Валюта">
          {(id) => (
            <Select
              id={id}
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              <option value="KZT">KZT — тенге</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="RUB">RUB</option>
              <option value="CNY">CNY</option>
            </Select>
          )}
        </Field>
        {currency !== 'KZT' ? (
          <Field
            label="Курс к тенге"
            help="Обязателен: курс не подставляется автоматически"
          >
            {(id) => (
              <Input
                id={id}
                name="fxRate"
                type="number"
                step="any"
                min="0"
                required
                placeholder="например 520"
              />
            )}
          </Field>
        ) : null}
        <Field label="Срок поставки, дней" hint="необязательно">
          {(id) => <Input id={id} name="deliveryDays" type="number" min="0" />}
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Предложение действует до" hint="необязательно">
          {(id) => <Input id={id} name="validUntil" type="date" />}
        </Field>
        <div className="flex items-end pb-2">
          <label className="flex items-center gap-2 text-[13px] text-ink-700">
            <input
              type="checkbox"
              name="pricesIncludeVat"
              defaultChecked
              className="size-4 rounded border-ink-300"
            />
            Цены указаны с НДС
          </label>
        </div>
      </div>

      <Field label="Поставщик начисляет НДС">
        {(id) => <Select id={id} name="supplierChargesVat" defaultValue="">
          <option value="">не подтверждено</option><option value="true">Да</option><option value="false">Нет</option>
        </Select>}
      </Field>
      <label className="flex items-center gap-2 text-[13px] text-ink-700">
        <input type="checkbox" name="valuesConfirmed" />
        Я сверил цены, валюту и условия с приложенным коммерческим предложением
      </label>
      <div>
        <p className="mb-2 text-[13px] font-medium text-ink-700">
          Позиции предложения
        </p>
        <div className="space-y-2.5">
          {items.map((item, index) => (
            <div
              key={index}
              className="space-y-2 rounded-lg border border-ink-200 p-3"
            >
              <div className="grid gap-2 sm:grid-cols-[1fr_72px_80px_130px_auto]">
                <Input
                  value={item.name}
                  placeholder="Наименование товара"
                  onChange={(e) => updateItem(index, { name: e.target.value })}
                />
                <Input
                  value={item.unit}
                  placeholder="ед."
                  onChange={(e) => updateItem(index, { unit: e.target.value })}
                />
                <Input
                  value={item.quantity}
                  type="number"
                  min="0"
                  step="any"
                  placeholder="кол-во"
                  onChange={(e) => updateItem(index, { quantity: e.target.value })}
                />
                <Input
                  value={item.unitPrice}
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder={`цена, ${currency}`}
                  onChange={(e) => updateItem(index, { unitPrice: e.target.value })}
                />
                <button
                  type="button"
                  onClick={() => setItems(items.filter((_, i) => i !== index))}
                  disabled={items.length === 1}
                  className="rounded p-2 text-ink-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                  aria-label="Удалить позицию"
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </div>

              <div className="grid gap-2 sm:grid-cols-3">
                <Select
                  value={item.lineItemId}
                  onChange={(e) => updateItem(index, { lineItemId: e.target.value })}
                  aria-label="Позиция тендера"
                >
                  <option value="">не сопоставлено с позицией ТЗ</option>
                  {lineItems.map((li) => (
                    <option key={li.id} value={li.id}>
                      {li.name} ({li.quantity} {li.unit})
                    </option>
                  ))}
                </Select>
                <Select
                  value={item.specMatch}
                  onChange={(e) =>
                    updateItem(index, {
                      specMatch: e.target.value as DraftItem['specMatch'],
                    })
                  }
                  aria-label="Соответствие требованиям"
                >
                  <option value="UNKNOWN">соответствие не проверено</option>
                  <option value="MATCH">соответствует</option>
                  <option value="PARTIAL">соответствует частично</option>
                  <option value="MISMATCH">не соответствует</option>
                </Select>
                <Input
                  value={item.leadTimeDays}
                  type="number"
                  min="0"
                  placeholder="срок поставки, дней"
                  onChange={(e) => updateItem(index, { leadTimeDays: e.target.value })}
                />
              </div>

              {item.specMatch === 'PARTIAL' || item.specMatch === 'MISMATCH' ? (
                <Input
                  value={item.specMatchNote}
                  placeholder="В чём отличие от требований заказчика"
                  onChange={(e) =>
                    updateItem(index, { specMatchNote: e.target.value })
                  }
                />
              ) : null}
            </div>
          ))}
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2.5"
          onClick={() => setItems([...items, emptyItem()])}
        >
          <Plus className="size-3.5" aria-hidden />
          Добавить позицию
        </Button>
      </div>

      <Field label="Примечания" hint="необязательно">
        {(id) => <Textarea id={id} name="notes" rows={2} />}
      </Field>

      <Button type="submit" loading={saving}>
        Сохранить предложение
      </Button>
    </form>
  );
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function numberOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}
