'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Check, Pencil, X } from 'lucide-react';

/** Правка значения ставки с подтверждением: ставка влияет на все расчёты. */
export function TaxRateEditor({
  rateId,
  value,
}: {
  rateId: string;
  value: number;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  async function save() {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setError(true);
      return;
    }
    setSaving(true);
    setError(false);
    try {
      const response = await fetch('/api/settings/taxes', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rateId, ratePercent: parsed }),
      });
      if (!response.ok) {
        setError(true);
        return;
      }
      setEditing(false);
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 tabular font-medium text-ink-900 hover:bg-ink-100"
        title="Изменить значение"
      >
        {value}
        <Pencil className="size-3 text-ink-400" aria-hidden />
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="number"
        step="any"
        min="0"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className={
          error
            ? 'h-8 w-24 rounded border border-red-400 px-2 text-right text-[13px]'
            : 'h-8 w-24 rounded border border-ink-300 px-2 text-right text-[13px]'
        }
        aria-label="Значение ставки"
      />
      <button
        type="button"
        onClick={() => void save()}
        disabled={saving}
        className="rounded p-1 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
        aria-label="Сохранить"
      >
        <Check className="size-4" aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => {
          setEditing(false);
          setDraft(String(value));
          setError(false);
        }}
        className="rounded p-1 text-ink-500 hover:bg-ink-100"
        aria-label="Отменить"
      >
        <X className="size-4" aria-hidden />
      </button>
    </span>
  );
}
