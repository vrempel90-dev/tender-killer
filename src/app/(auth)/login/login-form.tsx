'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { StatusNotice } from '@/components/ui/status-notice';

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: String(form.get('email') ?? ''),
          password: String(form.get('password') ?? ''),
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? 'Не удалось войти');
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
      {error ? <StatusNotice severity="CRITICAL">{error}</StatusNotice> : null}

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

      <Field label="Пароль">
        {(id) => (
          <Input
            id={id}
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        )}
      </Field>

      <Button type="submit" loading={loading} className="w-full" size="lg">
        Войти
      </Button>
    </form>
  );
}
