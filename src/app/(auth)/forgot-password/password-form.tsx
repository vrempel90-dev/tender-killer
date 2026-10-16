'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { StatusNotice } from '@/components/ui/status-notice';
import { RESET_MESSAGE } from '@/lib/auth/password-reset-messages';

export function ForgotPasswordForm() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError('');
    const email = String(new FormData(event.currentTarget).get('email') ?? '');
    try {
      const response = await fetch('/api/auth/forgot-password', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
      const result = await response.json();
      if (!response.ok) { setError(result.error ?? 'Не удалось отправить запрос. Повторите позднее.'); return; }
      setSent(true);
    } catch { setError('Сервер недоступен. Повторите попытку.'); }
    finally { setLoading(false); }
  }
  return <div>
    {sent ? <div role="status"><StatusNotice>{RESET_MESSAGE}</StatusNotice></div>
      : <form onSubmit={submit} className="space-y-4">
        {error && <div role="alert"><StatusNotice severity="CRITICAL">{error}</StatusNotice></div>}
        <Field label="Электронная почта">{id => <Input id={id} name="email" type="email" autoComplete="email" maxLength={254} required />}</Field>
        <Button type="submit" loading={loading} className="w-full" size="lg">Отправить ссылку</Button>
      </form>}
    <p className="mt-6 text-[13px]"><Link href="/login" className="text-brand-600 hover:text-brand-700">Вернуться ко входу</Link></p>
  </div>;
}
