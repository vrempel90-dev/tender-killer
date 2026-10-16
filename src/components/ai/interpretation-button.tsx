'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

interface Interpretation { explanation: string; classification: string; quoteVerified: boolean; firstQuote: string; secondQuote: string; model: string; missingInformation: string[] }
export function InterpretationButton({ endpoint, label }: { endpoint: string; label: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Interpretation | null>(null);
  const [error, setError] = useState('');
  async function run() {
    setBusy(true); setError('');
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const body = await response.json();
      if (!body.ok) { setError(body.error); return; }
      setResult(body.data);
    } catch { setError('AI-анализ не завершён. Повторите позднее.'); }
    finally { setBusy(false); }
  }
  return <div className="space-y-2 text-sm">
    <Button variant="outline" size="sm" loading={busy} onClick={run}>{label}</Button>
    {error && <p role="alert">{error}</p>}
    {result && <div className="space-y-1 rounded-lg bg-ink-50 p-3" role="status">
      <p className="font-medium">Требует ручной проверки · {result.classification}</p>
      <p>{result.explanation}</p>
      <blockquote>Первый источник: «{result.firstQuote}»</blockquote>
      <blockquote>Второй источник: «{result.secondQuote}»</blockquote>
      <p>Цитаты: {result.quoteVerified ? 'найдены' : 'не подтверждены'}. Модель: {result.model}.</p>
      {result.missingInformation.map((text, i) => <p key={i}>{text}</p>)}
    </div>}
  </div>;
}
