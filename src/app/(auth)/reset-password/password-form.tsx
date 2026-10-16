'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { StatusNotice } from '@/components/ui/status-notice';

export function ResetPasswordForm() {
  const [token, setToken] = useState('');
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    const secret = new URLSearchParams(window.location.search).get('token') ?? '';
    // Keep the secret only in component memory, never in storage or later URLs.
    window.history.replaceState(null, '', '/reset-password');
    if (/^[a-f0-9]{64}$/.test(secret)) setToken(secret);
    setReady(true);
  }, []);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError('');
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') ?? '');
    const confirmPassword = String(form.get('confirmPassword') ?? '');
    if (password !== confirmPassword) { setError('Пароли не совпадают'); setLoading(false); return; }
    try {
      const response = await fetch('/api/auth/reset-password', { method: 'POST', referrerPolicy: 'no-referrer',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password, confirmPassword }) });
      const result = await response.json();
      if (!response.ok) { setError(result.error ?? 'Не удалось изменить пароль'); return; }
      setToken(''); setSaved(true);
    } catch { setError('Сервер недоступен. Повторите попытку.'); }
    finally { setLoading(false); }
  }
  if (saved) return <div>
    <div role="status"><StatusNotice>Пароль успешно изменён. Теперь вы можете войти в аккаунт</StatusNotice></div>
    <Link href="/login" className="mt-6 inline-flex rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-700">Войти</Link>
  </div>;
  if (ready && !token) return <div role="alert"><StatusNotice severity="WARNING">
    Ссылка недействительна или устарела. <Link href="/forgot-password" className="underline">Запросите новую</Link>.
  </StatusNotice></div>;
  return <form onSubmit={submit} className="space-y-4">
    <p className="text-[13px] text-ink-500">От 10 до 256 символов, с буквами и хотя бы одной цифрой.</p>
    {error && <div role="alert"><StatusNotice severity="CRITICAL">{error}</StatusNotice></div>}
    <Field label="Новый пароль">{id => <Input id={id} name="password" type="password" autoComplete="new-password" minLength={10} maxLength={256} required />}</Field>
    <Field label="Подтвердите новый пароль">{id => <Input id={id} name="confirmPassword" type="password" autoComplete="new-password" minLength={10} maxLength={256} required />}</Field>
    <Button type="submit" loading={loading} disabled={!ready || !token} className="w-full" size="lg">Сохранить новый пароль</Button>
    <p className="text-[13px]"><Link href="/login" className="text-brand-600 hover:text-brand-700">Вернуться ко входу</Link></p>
  </form>;
}
