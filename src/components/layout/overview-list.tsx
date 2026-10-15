import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ButtonLink } from '@/components/ui/button';

export interface OverviewRow {
  tenderId: string;
  tenderTitle: string;
  href: string;
  /** Левая часть: что сделано. */
  statusLabel: string;
  statusTone: 'positive' | 'negative' | 'caution' | 'neutral' | 'brand';
  /** Дополнительные метки. */
  badges?: Array<{ label: string; tone?: 'positive' | 'negative' | 'caution' | 'neutral' }>;
  meta?: string;
}

/**
 * Обзорный список по всем тендерам для разделов меню.
 * Разделы не дублируют работу, а дают сводку и переход к тендеру.
 */
export function OverviewList({
  title,
  description,
  rows,
  emptyTitle,
  emptyDescription,
  emptyActionHref,
  emptyActionLabel,
}: {
  title: string;
  description: string;
  rows: OverviewRow[];
  emptyTitle: string;
  emptyDescription: string;
  emptyActionHref?: string;
  emptyActionLabel?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardBody className={rows.length === 0 ? undefined : 'space-y-2'}>
        {rows.length === 0 ? (
          <EmptyState
            title={emptyTitle}
            description={emptyDescription}
            action={
              emptyActionHref && emptyActionLabel ? (
                <ButtonLink href={emptyActionHref}>{emptyActionLabel}</ButtonLink>
              ) : undefined
            }
          />
        ) : (
          rows.map((row) => (
            <Link
              key={`${row.tenderId}-${row.href}`}
              href={row.href}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink-200 px-3.5 py-3 transition-colors hover:border-ink-300 hover:bg-ink-50/60"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-medium text-ink-900">
                  {row.tenderTitle}
                </p>
                {row.meta ? (
                  <p className="mt-0.5 text-[12px] text-ink-400">{row.meta}</p>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                {row.badges?.map((badge) => (
                  <Badge key={badge.label} tone={badge.tone ?? 'neutral'}>
                    {badge.label}
                  </Badge>
                ))}
                <Badge tone={row.statusTone}>{row.statusLabel}</Badge>
              </div>
            </Link>
          ))
        )}
      </CardBody>
    </Card>
  );
}
