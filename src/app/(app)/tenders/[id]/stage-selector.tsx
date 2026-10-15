'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Select } from '@/components/ui/field';
import { Badge } from '@/components/ui/badge';
import { TENDER_STAGE_LABELS } from '@/lib/tender-labels';

type Stage = keyof typeof TENDER_STAGE_LABELS;

export function StageSelector({
  tenderId,
  stage,
  canEdit,
}: {
  tenderId: string;
  stage: Stage;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState<Stage>(stage);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  if (!canEdit) {
    return <Badge>{TENDER_STAGE_LABELS[stage]}</Badge>;
  }

  async function handleChange(next: Stage) {
    const previous = value;
    setValue(next);
    setSaving(true);
    setError(false);
    try {
      const response = await fetch(`/api/tenders/${tenderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: next }),
      });
      if (!response.ok) {
        setValue(previous);
        setError(true);
        return;
      }
      router.refresh();
    } catch {
      setValue(previous);
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Select
        value={value}
        disabled={saving}
        onChange={(e) => void handleChange(e.target.value as Stage)}
        className="h-8 w-auto min-w-[150px] text-[12.5px]"
        aria-label="Стадия тендера"
      >
        {Object.entries(TENDER_STAGE_LABELS).map(([code, label]) => (
          <option key={code} value={code}>
            {label}
          </option>
        ))}
      </Select>
      {error ? (
        <span className="text-[11.5px] text-red-600">Не удалось сохранить</span>
      ) : null}
    </span>
  );
}
