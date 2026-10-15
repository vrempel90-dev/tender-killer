'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { StatusNotice } from '@/components/ui/status-notice';
import { CAN_BE_VAT_PAYER, TAX_REGIME_LABELS } from '@/lib/finance/tax-config';
import type { TaxRegimeCode } from '@/lib/finance/types';

export function CompanySettingsForm({
  company,
  canEdit,
}: {
  company: {
    name: string;
    bin: string | null;
    taxRegime: TaxRegimeCode;
    isVatPayer: boolean;
    isSmallBusiness: boolean;
  };
  canEdit: boolean;
}) {
  const router = useRouter();
  const [regime, setRegime] = useState<TaxRegimeCode>(company.taxRegime);
  const [isVatPayer, setIsVatPayer] = useState(company.isVatPayer);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canBeVatPayer = CAN_BE_VAT_PAYER[regime];

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch('/api/settings/company', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: String(form.get('name') ?? ''),
          bin: String(form.get('bin') ?? ''),
          taxRegime: regime,
          isVatPayer: canBeVatPayer ? isVatPayer : false,
          isSmallBusiness: form.get('isSmallBusiness') === 'on',
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? 'Не удалось сохранить');
        return;
      }
      setMessage('Сохранено. Новые расчёты используют обновлённый режим.');
      router.refresh();
    } catch {
      setError('Сервер недоступен.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error ? <StatusNotice severity="CRITICAL">{error}</StatusNotice> : null}
      {message ? <StatusNotice severity="INFO">{message}</StatusNotice> : null}

      <Field label="Название компании">
        {(id) => (
          <Input
            id={id}
            name="name"
            defaultValue={company.name}
            required
            disabled={!canEdit}
          />
        )}
      </Field>

      <Field label="БИН / ИИН" hint="необязательно">
        {(id) => (
          <Input
            id={id}
            name="bin"
            defaultValue={company.bin ?? ''}
            pattern="\d{12}"
            inputMode="numeric"
            disabled={!canEdit}
          />
        )}
      </Field>

      <Field label="Налоговый режим">
        {(id) => (
          <Select
            id={id}
            value={regime}
            disabled={!canEdit}
            onChange={(e) => {
              const next = e.target.value as TaxRegimeCode;
              setRegime(next);
              if (!CAN_BE_VAT_PAYER[next]) setIsVatPayer(false);
            }}
          >
            {Object.entries(TAX_REGIME_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <label className="flex items-start gap-2 text-[13px] text-ink-700">
        <input
          type="checkbox"
          checked={isVatPayer}
          disabled={!canEdit || !canBeVatPayer}
          onChange={(e) => setIsVatPayer(e.target.checked)}
          className="mt-0.5 size-4 rounded border-ink-300"
        />
        <span>
          Плательщик НДС
          {!canBeVatPayer ? (
            <span className="mt-0.5 block text-[12px] text-ink-500">
              На выбранном режиме постановка на учёт по НДС по внутренним
              оборотам не предусмотрена. НДС по импорту при этом остаётся
              отдельным обязательством и учитывается в расчёте.
            </span>
          ) : null}
        </span>
      </label>

      <label className="flex items-center gap-2 text-[13px] text-ink-700">
        <input
          type="checkbox"
          name="isSmallBusiness"
          defaultChecked={company.isSmallBusiness}
          disabled={!canEdit}
          className="size-4 rounded border-ink-300"
        />
        Субъект малого предпринимательства
      </label>

      {canEdit ? (
        <Button type="submit" loading={saving}>
          Сохранить
        </Button>
      ) : (
        <p className="text-[12.5px] text-ink-500">
          Изменять параметры компании могут владелец и администратор.
        </p>
      )}
    </form>
  );
}
