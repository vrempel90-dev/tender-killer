import { cn } from '@/lib/cn';

/**
 * Пустое состояние. Используется вместо выдуманных демо-данных:
 * если данных нет — честно сообщаем об этом и предлагаем действие.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-xl border border-dashed',
        'border-ink-200 bg-ink-50/40 px-6 py-12 text-center',
        className,
      )}
    >
      {icon ? <div className="mb-3 text-ink-300">{icon}</div> : null}
      <p className="text-sm font-medium text-ink-800">{title}</p>
      {description ? (
        <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-ink-500">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
