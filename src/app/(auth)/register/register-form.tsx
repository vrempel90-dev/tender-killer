'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { StatusNotice } from '@/components/ui/status-notice';
import { TAX_REGIME_LABELS } from '@/lib/finance/tax-config';

const REGIMES = Object.entries(TAX_REGIME_LABELS);

export function RegisterForm() {
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

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: String(form.get('companyName') ?? ''),
          bin: String(form.get('bin') ?? ''),
          taxRegime: String(form.get('taxRegime') ?? 'GENERAL_VAT'),
          name: String(form.get('name') ?? ''),
          email: String(form.get('email') ?? ''),
          password: String(form.get('password') ?? ''),
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? 'Не удалось зарегистрироваться');
        if (Array.isArray(payload.details)) {
          setDetails(
            payload.details.map(
              (d: { field: string; message: string }) => `${d.field}: ${d.message}`,
            ),
          );
        }
        return;
      }
      router.push('/dashboard');
      router.refresh();
    } catch {
      setError('Сервер недоступен. Повторите попытку.');
    } finally {
      setLoading(false);
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

      <Field label="Название компании">
        {(id) => (
          <Input id={id} name="companyName" required placeholder="ТОО «Пример»" />
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="БИН / ИИН" hint="необязательно">
          {(id) => (
            <Input
              id={id}
              name="bin"
              inputMode="numeric"
              pattern="\d{12}"
              placeholder="12 цифр"
            />
          )}
        </Field>

        <Field
          label="Налоговый режим"
          help="Влияет на расчёт НДС и налога на доход"
        >
          {(id) => (
            <Select id={id} name="taxRegime" defaultValue="GENERAL_VAT">
              {REGIMES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      <Field label="Ваше имя">
        {(id) => <Input id={id} name="name" required placeholder="Имя и фамилия" />}
      </Field>

      <Field label="E-mail">
        {(id) => (
          <Input
            id={id}
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@company.kz"
          />
        )}
      </Field>

      <Field
        label="Пароль"
        help="Не короче 10 символов, с буквами и цифрами"
      >
        {(id) => (
          <Input
            id={id}
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
          />
        )}
      </Field>

      <Button type="submit" loading={loading} className="w-full" size="lg">
        Создать аккаунт
      </Button>
    </form>
  );
}
