import { cn } from '@/lib/cn';

/**
 * Плитка показателя. Пустое значение показывается прочерком — не нулём,
 * чтобы не создавать иллюзию посчитанных данных.
 */
export function StatTile({
  label,
  value,
  hint,
  tone = 'neutral',
  icon,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'neutral' | 'positive' | 'negative' | 'caution';
  icon?: React.ReactNode;
}) {
  const valueTone = {
    neutral: 'text-ink-900',
    positive: 'text-emerald-700',
    negative: 'text-red-700',
    caution: 'text-amber-700',
  }[tone];

  return (
    <div className="rounded-xl border border-ink-200/80 bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-medium uppercase tracking-wide text-ink-400">
          {label}
        </p>
        {icon ? <span className="text-ink-300">{icon}</span> : null}
      </div>
      <p className={cn('mt-2 text-[22px] font-semibold tabular tracking-tight', valueTone)}>
        {value}
      </p>
      {hint ? (
        <p className="mt-1 text-[12px] leading-snug text-ink-400">{hint}</p>
      ) : null}
    </div>
  );
}
