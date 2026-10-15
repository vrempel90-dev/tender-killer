import { AlertTriangle, CircleAlert, Info, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/cn';

type Severity = 'INFO' | 'WARNING' | 'CRITICAL';

const STYLES: Record<Severity, { box: string; icon: React.ReactNode }> = {
  INFO: {
    box: 'border-sky-200 bg-sky-50 text-sky-900',
    icon: <Info className="size-4 shrink-0 text-sky-600" aria-hidden />,
  },
  WARNING: {
    box: 'border-amber-200 bg-amber-50 text-amber-900',
    icon: <TriangleAlert className="size-4 shrink-0 text-amber-600" aria-hidden />,
  },
  CRITICAL: {
    box: 'border-red-200 bg-red-50 text-red-900',
    icon: <CircleAlert className="size-4 shrink-0 text-red-600" aria-hidden />,
  },
};

export function StatusNotice({
  severity = 'INFO',
  title,
  children,
  className,
}: {
  severity?: Severity;
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const style = STYLES[severity];
  return (
    <div
      className={cn(
        'flex gap-2.5 rounded-lg border px-3.5 py-3 text-[13px] leading-relaxed',
        style.box,
        className,
      )}
    >
      {style.icon}
      <div className="min-w-0">
        {title ? <p className="font-semibold">{title}</p> : null}
        <div className={title ? 'mt-0.5' : undefined}>{children}</div>
      </div>
    </div>
  );
}

/**
 * Явная отметка функции, которая ещё не реализована.
 * Правило проекта: не бывает кнопок, которые ничего не делают, —
 * статус всегда показан.
 */
export function NotImplementedNotice({
  feature,
  requires,
}: {
  feature: string;
  requires: string;
}) {
  return (
    <div className="flex gap-2.5 rounded-lg border border-ink-200 bg-ink-50 px-3.5 py-3 text-[13px] leading-relaxed text-ink-700">
      <AlertTriangle className="size-4 shrink-0 text-ink-400" aria-hidden />
      <div>
        <p className="font-semibold text-ink-800">{feature} — пока недоступно</p>
        <p className="mt-0.5 text-ink-600">{requires}</p>
      </div>
    </div>
  );
}
