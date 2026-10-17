'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { StatusNotice } from '@/components/ui/status-notice';
import { loginRetryMessage, loginRetrySeconds } from '@/lib/auth/login-messages';

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const [now, setNow] = useState(0);
  const remaining = Math.max(0, Math.ceil((retryAt - now) / 1000));

  useEffect(() => {
    if (!retryAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [retryAt]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || remaining > 0) return;
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
        if (response.status === 429) {
          const seconds = loginRetrySeconds(response.headers.get('Retry-After'), payload.details?.retryAfterSeconds);
          if (seconds !== null) {
            const receivedAt = Date.now();
            setNow(receivedAt);
            setRetryAt(receivedAt + seconds * 1000);
          } else setError('Слишком много попыток входа. Повторите позднее.');
          return;
        }
        setError(payload.error ?? 'Не удалось войти');
        return;
      }
      // Куда идти, решает сервер: при включённом втором факторе это /mfa.
      const next = typeof payload.data?.next === 'string' ? payload.data.next : '/dashboard';
      router.push(next);
      router.refresh();
    } catch {
      setError('Сервер недоступен. Повторите попытку.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {remaining > 0 || error ? <div role="alert"><StatusNotice severity="CRITICAL">
        {remaining > 0 ? loginRetryMessage(remaining) : error}
      </StatusNotice></div> : null}

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

      <div className="text-right">
        <Link href="/forgot-password" className="text-[12px] font-medium text-brand-600 hover:text-brand-700">
          Забыли пароль?
        </Link>
      </div>
      <Button type="submit" loading={loading} disabled={remaining > 0} className="w-full" size="lg">
        Войти
      </Button>
    </form>
  );
}
