'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

interface Summary {
  provider: string; model: string; configured: boolean;
  limits: { timeoutMs: number; parallel: number; contextTokens: number; maxOutputTokens: number; maxDocumentChars: number; maxChunks: number; dailyCalls: number };
}
interface Job { id: string; kind: string; status: string; completedChunks: number; totalChunks: number; error: string | null }

export function AiPanel({ summary }: { summary: Summary }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Подключение ещё не проверено.');
  const [jobs, setJobs] = useState<Job[]>([]);
  async function check() {
    setBusy(true);
    try {
      const response = await fetch('/api/settings/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const body = await response.json();
      setMessage(body.ok ? `Сервис доступен. Модель установлена. Тестовый запрос выполнен за ${body.data.durationMs} мс.` : body.error);
    } catch { setMessage('Проверка не завершена. Повторите позднее.'); }
    finally { setBusy(false); }
  }
  async function loadJobs() {
    try { const response = await fetch('/api/settings/ai/jobs'); const body = await response.json(); if (body.ok) setJobs(body.data); }
    catch { setMessage('Не удалось получить состояние заданий.'); }
  }
  return <div className="space-y-3 text-sm">
    <dl className="space-y-1">
      <div>Провайдер: <strong>{summary.provider}</strong></div>
      <div>Модель: <strong>{summary.model}</strong></div>
      <div>Конфигурация: {summary.configured ? 'готова к проверке' : 'требует настройки'}</div>
      <div>Лимиты: {summary.limits.parallel} запрос одновременно; {summary.limits.timeoutMs / 1000} с на генерацию; {summary.limits.dailyCalls} вызовов в сутки на компанию.</div>
      <div>Контекст: {summary.limits.contextTokens} токенов; ответ до {summary.limits.maxOutputTokens} токенов; документ до {summary.limits.maxDocumentChars} символов / {summary.limits.maxChunks} фрагментов.</div>
    </dl>
    <p role="status" aria-live="polite">{message}</p>
    <Button onClick={check} loading={busy} variant="outline">Проверить подключение</Button>
    {summary.provider === 'anthropic' && <p className="text-amber-800">Тест обращается к платному провайдеру и расходует его квоту.</p>}
    <p className="text-ink-500">Провайдера меняет администратор инфраструктуры в серверной конфигурации. Результаты AI требуют ручной проверки.</p>
    <Button onClick={loadJobs} variant="ghost">Обновить задания</Button>
    <ul className="space-y-2">{jobs.map(job => <li key={job.id}>
      <a className="underline" href={`/api/settings/ai/jobs?id=${encodeURIComponent(job.id)}`} target="_blank" rel="noreferrer">{job.kind}: {job.status}, {job.completedChunks}/{job.totalChunks}</a>
      {job.error && <p>{job.error}. Требует ручной проверки.</p>}
    </li>)}</ul>
  </div>;
}
