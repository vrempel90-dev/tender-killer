'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Save } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/field';
import { StatusNotice } from '@/components/ui/status-notice';
import {
  PROCUREMENT_TYPE_LABELS,
  type ProcurementTypeValue,
} from '@/lib/radar/filters';

interface ProfileValues {
  keywords: string[];
  excludedKeywords: string[];
  regions: string[];
  procurementTypes: string[];
  minPrice: number | null;
  maxPrice: number | null;
  minDeliveryDays: number | null;
  excludedCustomerBins: string[];
  preferredCustomerBins: string[];
  minDaysToDeadline: number | null;
  notes: string | null;
}

/** Многострочный ввод списка: по одному значению в строке. */
function toLines(values: string[]): string {
  return values.join('\n');
}

function fromLines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function ProfileForm({
  canEdit,
  initial,
  completeness,
}: {
  canEdit: boolean;
  initial: ProfileValues;
  completeness: { filled: number; total: number; missing: string[] };
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch('/api/radar/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const payload = await response.json();
      if (!response.ok) {
        const details = Array.isArray(payload.details)
          ? payload.details
            .map((item: { field: string; message: string }) => item.message)
            .join('; ')
          : null;
        setError(details ?? payload.error ?? 'Не удалось сохранить профиль');
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError('Сервер недоступен. Повторите попытку.');
    } finally {
      setLoading(false);
    }
  }

  const toggleType = (type: ProcurementTypeValue) => {
    setValues((current) => ({
      ...current,
      procurementTypes: current.procurementTypes.includes(type)
        ? current.procurementTypes.filter((item) => item !== type)
        : [...current.procurementTypes, type],
    }));
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      {error ? <StatusNotice severity="CRITICAL">{error}</StatusNotice> : null}
      {saved ? <StatusNotice severity="INFO">Профиль сохранён</StatusNotice> : null}

      <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-500">
        <span>
          Заполнено: {completeness.filled} из {completeness.total}
        </span>
        {completeness.missing.length > 0 ? (
          <Badge tone="caution">не заполнено: {completeness.missing.join(', ')}</Badge>
        ) : (
          <Badge tone="positive">профиль заполнен</Badge>
        )}
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Что поставляет компания</CardTitle>
            <CardDescription>
              По одному значению в строке. Сравнение учитывает словоформы: «кабель»
              найдёт «кабеля» и «кабелей», но не «канцелярские товары».
              Словосочетание требует все свои слова.
            </CardDescription>
          </CardHeader>
          <CardBody className="space-y-4">
            <Field label="Ключевые слова и словосочетания">
              {(id) => (
                <Textarea
                  id={id}
                  rows={6}
                  disabled={!canEdit}
                  value={toLines(values.keywords)}
                  onChange={(event) =>
                    setValues({ ...values, keywords: fromLines(event.target.value) })
                  }
                  placeholder={'кабель\nэлектромонтаж\nмонтаж систем видеонаблюдения'}
                />
              )}
            </Field>
            <Field
              label="Чего компания не берёт"
              help="Закупки с этими словами исключаются из поиска, а не понижаются в рейтинге."
            >
              {(id) => (
                <Textarea
                  id={id}
                  rows={4}
                  disabled={!canEdit}
                  value={toLines(values.excludedKeywords)}
                  onChange={(event) =>
                    setValues({
                      ...values,
                      excludedKeywords: fromLines(event.target.value),
                    })
                  }
                  placeholder={'медицинское оборудование\nпродукты питания'}
                />
              )}
            </Field>
          </CardBody>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>География и способы закупки</CardTitle>
              <CardDescription>
                Пустой список означает «без ограничения».
              </CardDescription>
            </CardHeader>
            <CardBody className="space-y-4">
              <Field label="Регионы поставки">
                {(id) => (
                  <Textarea
                    id={id}
                    rows={3}
                    disabled={!canEdit}
                    value={toLines(values.regions)}
                    onChange={(event) =>
                      setValues({ ...values, regions: fromLines(event.target.value) })
                    }
                    placeholder={'Алматы\nАлматинская область'}
                  />
                )}
              </Field>
              <fieldset className="space-y-1.5">
                <legend className="text-[13px] font-medium text-ink-700">
                  Допустимые способы закупки
                </legend>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {(Object.keys(PROCUREMENT_TYPE_LABELS) as ProcurementTypeValue[]).map(
                    (type) => (
                      <label
                        key={type}
                        className="flex items-center gap-2 text-[13px] text-ink-700"
                      >
                        <input
                          type="checkbox"
                          disabled={!canEdit}
                          checked={values.procurementTypes.includes(type)}
                          onChange={() => toggleType(type)}
                          className="size-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500/30"
                        />
                        {PROCUREMENT_TYPE_LABELS[type]}
                      </label>
                    ),
                  )}
                </div>
              </fieldset>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Границы и сроки</CardTitle>
              <CardDescription>
                Закупки за этими границами исключаются из поиска: это не «минус к
                оценке», а отказ от участия.
              </CardDescription>
            </CardHeader>
            <CardBody className="grid gap-4 sm:grid-cols-2">
              <NumberField
                label="Минимальная сумма договора, ₸"
                value={values.minPrice}
                disabled={!canEdit}
                onChange={(value) => setValues({ ...values, minPrice: value })}
              />
              <NumberField
                label="Максимальная сумма договора, ₸"
                value={values.maxPrice}
                disabled={!canEdit}
                onChange={(value) => setValues({ ...values, maxPrice: value })}
              />
              <NumberField
                label="Минимальный срок на поставку, дней"
                value={values.minDeliveryDays}
                disabled={!canEdit}
                onChange={(value) => setValues({ ...values, minDeliveryDays: value })}
              />
              <NumberField
                label="Нужно дней на подготовку заявки"
                value={values.minDaysToDeadline}
                disabled={!canEdit}
                onChange={(value) => setValues({ ...values, minDaysToDeadline: value })}
              />
            </CardBody>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Заказчики</CardTitle>
          <CardDescription>
            БИН из 12 цифр, по одному в строке. Исключённые заказчики отсеиваются,
            знакомые добавляют к оценке соответствия.
          </CardDescription>
        </CardHeader>
        <CardBody className="grid gap-4 md:grid-cols-2">
          <Field label="Исключённые заказчики">
            {(id) => (
              <Textarea
                id={id}
                rows={3}
                disabled={!canEdit}
                value={toLines(values.excludedCustomerBins)}
                onChange={(event) =>
                  setValues({
                    ...values,
                    excludedCustomerBins: fromLines(event.target.value),
                  })
                }
                placeholder="123456789012"
              />
            )}
          </Field>
          <Field label="Знакомые заказчики">
            {(id) => (
              <Textarea
                id={id}
                rows={3}
                disabled={!canEdit}
                value={toLines(values.preferredCustomerBins)}
                onChange={(event) =>
                  setValues({
                    ...values,
                    preferredCustomerBins: fromLines(event.target.value),
                  })
                }
                placeholder="123456789012"
              />
            )}
          </Field>
          <Field label="Заметки" className="md:col-span-2">
            {(id) => (
              <Textarea
                id={id}
                rows={3}
                disabled={!canEdit}
                value={values.notes ?? ''}
                onChange={(event) =>
                  setValues({
                    ...values,
                    notes: event.target.value.length > 0 ? event.target.value : null,
                  })
                }
                placeholder="Особенности, ограничения, договорённости"
              />
            )}
          </Field>
        </CardBody>
      </Card>

      {canEdit ? (
        <Button type="submit" loading={loading} size="lg">
          <Save className="size-4" aria-hidden />
          Сохранить профиль
        </Button>
      ) : (
        <StatusNotice severity="INFO">
          У вашей роли нет права изменять профиль компании.
        </StatusNotice>
      )}
    </form>
  );
}

function NumberField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number | null;
  disabled: boolean;
  onChange: (value: number | null) => void;
}) {
  return (
    <Field label={label} hint="необязательно">
      {(id) => (
        <Input
          id={id}
          type="number"
          min={0}
          disabled={disabled}
          value={value ?? ''}
          onChange={(event) =>
            onChange(event.target.value === '' ? null : Number(event.target.value))
          }
        />
      )}
    </Field>
  );
}
