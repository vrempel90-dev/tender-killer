'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/field';

export function AccountActions() {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deleted, setDeleted] = useState(false);
  async function perform(remove: boolean) {
    setBusy(true); setError('');
    try {
      const response = await fetch(remove ? '/api/auth/account' : '/api/auth/sessions/revoke', {
        method: remove ? 'DELETE' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(remove ? { password, confirmation } : { password }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Не удалось выполнить действие');
      setPassword('');
      if (remove) setDeleted(true); else window.location.assign('/login');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Ошибка соединения'); }
    finally { setBusy(false); }
  }
  if (deleted) return <Card><CardBody><p role="status">Аккаунт удалён. Все сессии завершены. Общие данные компании сохранены.</p><a href="/login" className="text-brand-600 underline">Перейти ко входу</a></CardBody></Card>;
  return <div className="max-w-xl space-y-5">
    <Card><CardHeader><CardTitle>Активные сессии</CardTitle><CardDescription>Завершение всех сессий, включая текущую. Для нового входа потребуется пароль.</CardDescription></CardHeader>
      <CardBody className="space-y-4">
        <Field label="Текущий пароль">{id => <Input id={id} type="password" autoComplete="current-password" maxLength={256} value={password} onChange={e => setPassword(e.target.value)} />}</Field>
        <Button type="button" loading={busy} disabled={!password} onClick={() => void perform(false)}>Выйти на всех устройствах</Button>
      </CardBody></Card>
    <Card><CardHeader><CardTitle>Удалить мой аккаунт</CardTitle><CardDescription>Удаление необратимо: учётная запись, сессии и токены восстановления будут удалены. Тендеры, документы и финансовые записи принадлежат компании и сохраняются. Если у компании есть коллеги, сначала должен остаться другой владелец.</CardDescription></CardHeader>
      <CardBody className="space-y-4">
        <Field label="Для подтверждения введите УДАЛИТЬ">{id => <Input id={id} value={confirmation} autoComplete="off" onChange={e => setConfirmation(e.target.value)} />}</Field>
        <Button type="button" loading={busy} disabled={!password || confirmation !== 'УДАЛИТЬ'} onClick={() => void perform(true)}>Удалить мой аккаунт</Button>
      </CardBody></Card>
    {error && <p role="alert" className="text-red-700">{error}</p>}
  </div>;
}
