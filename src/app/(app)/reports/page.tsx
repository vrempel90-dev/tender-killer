import Link from 'next/link';
import type { Metadata } from 'next';
import { FileText } from 'lucide-react';
import { prisma } from '@/lib/db';
import { requireSession } from '@/lib/auth/guard';
import { formatMinorKzt } from '@/lib/money';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { VERDICT_LABELS, type DecisionVerdict } from '@/lib/reports/decision-report';

export const metadata: Metadata = { title: 'Отчёты' };

interface SavedPayload {
  tender?: { title?: string };
  finance?: { netProfitMinor?: number; workingCapitalMinor?: number } | null;
  compliance?: { byStatus?: Record<string, number> } | null;
  contract?: { risksByLevel?: Record<string, number> } | null;
  gaps?: string[];
}

export default async function ReportsPage() {
  const session = await requireSession();

  const [reports, tenders] = await Promise.all([
    prisma.report.findMany({
      where: { companyId: session.companyId },
      orderBy: { createdAt: 'desc' },
      include: { tender: { select: { id: true, title: true } } },
      take: 100,
    }),
    prisma.tender.findMany({
      where: { companyId: session.companyId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        title: true,
        financialModels: { select: { id: true }, take: 1 },
        complianceRuns: { select: { id: true }, take: 1 },
        contractAnalyses: { select: { id: true }, take: 1 },
      },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Отчёты"
        description="Сохранённые снимки отчётов для принятия решения и быстрый переход к формированию новых."
      />
      <div className="flex-1 space-y-5 px-5 py-5 sm:px-7">
        <Card>
          <CardHeader>
            <CardTitle>Сформировать отчёт по тендеру</CardTitle>
            <CardDescription>
              Отчёт сводит экономику, денежный поток, проверку документов и риски
              договора, а также отдельно перечисляет, каких данных не хватает.
            </CardDescription>
          </CardHeader>
          <CardBody className={tenders.length === 0 ? undefined : 'space-y-2'}>
            {tenders.length === 0 ? (
              <EmptyState
                icon={<FileText className="size-8" aria-hidden />}
                title="Тендеров нет"
                description="Создайте тендер, чтобы сформировать по нему отчёт."
                action={
                  <ButtonLink href="/tenders/new">Создать тендер</ButtonLink>
                }
              />
            ) : (
              tenders.map((tender) => {
                const parts = [
                  tender.financialModels.length > 0 ? 'расчёт' : null,
                  tender.complianceRuns.length > 0 ? 'проверка' : null,
                  tender.contractAnalyses.length > 0 ? 'договор' : null,
                ].filter(Boolean);
                return (
                  <Link
                    key={tender.id}
                    href={`/tenders/${tender.id}/report`}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink-200 px-3.5 py-3 transition-colors hover:border-ink-300 hover:bg-ink-50/60"
                  >
                    <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-ink-900">
                      {tender.title}
                    </span>
                    <span className="flex shrink-0 gap-1.5">
                      {parts.length === 0 ? (
                        <Badge tone="caution">данных для отчёта нет</Badge>
                      ) : (
                        parts.map((part) => (
                          <Badge key={part} tone="positive">
                            {part}
                          </Badge>
                        ))
                      )}
                    </span>
                  </Link>
                );
              })
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Сохранённые снимки ({reports.length})</CardTitle>
            <CardDescription>
              Снимок фиксирует состояние данных на момент принятия решения.
            </CardDescription>
          </CardHeader>
          <CardBody className={reports.length === 0 ? undefined : 'p-0'}>
            {reports.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-ink-400">
                Снимков нет. Откройте отчёт по тендеру и нажмите «Сохранить
                снимок».
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-[13px]">
                  <thead>
                    <tr className="border-b border-ink-100 text-left text-[12px] uppercase tracking-wide text-ink-400">
                      <th className="px-5 py-2.5 font-medium">Тендер</th>
                      <th className="px-5 py-2.5 font-medium">Создан</th>
                      <th className="px-5 py-2.5 text-right font-medium">
                        Чистая прибыль
                      </th>
                      <th className="px-5 py-2.5 text-center font-medium">Пробелы</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reports.map((report) => {
                      const payload = report.payload as SavedPayload;
                      const net = payload.finance?.netProfitMinor ?? null;
                      const gaps = payload.gaps?.length ?? 0;
                      return (
                        <tr
                          key={report.id}
                          className="border-b border-ink-50 last:border-0 hover:bg-ink-50/60"
                        >
                          <td className="px-5 py-3">
                            <Link
                              href={`/tenders/${report.tender.id}/report`}
                              className="font-medium text-ink-900 hover:text-brand-700"
                            >
                              {report.tender.title}
                            </Link>
                          </td>
                          <td className="px-5 py-3 text-ink-600">
                            {new Intl.DateTimeFormat('ru-KZ', {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            }).format(report.createdAt)}
                          </td>
                          <td
                            className={
                              net === null
                                ? 'px-5 py-3 text-right text-ink-400'
                                : net >= 0
                                  ? 'px-5 py-3 text-right tabular text-emerald-700'
                                  : 'px-5 py-3 text-right tabular text-red-700'
                            }
                          >
                            {net === null ? 'нет расчёта' : formatMinorKzt(net)}
                          </td>
                          <td className="px-5 py-3 text-center">
                            {gaps === 0 ? (
                              <Badge tone="positive">нет</Badge>
                            ) : (
                              <Badge tone="caution">{gaps}</Badge>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Как читать итоговую оценку</CardTitle>
          </CardHeader>
          <CardBody>
            <dl className="space-y-2 text-[13px] leading-relaxed">
              {(
                [
                  [
                    'ACCEPTABLE',
                    'Расчёт положительный, критических замечаний не выявлено.',
                  ],
                  [
                    'RISKY',
                    'Участие возможно, но есть замечания, которые нужно устранить.',
                  ],
                  [
                    'NOT_RECOMMENDED',
                    'Расчёт показывает убыток — участие не рекомендуется.',
                  ],
                  [
                    'INSUFFICIENT_DATA',
                    'Данных недостаточно: решение принимать рано.',
                  ],
                ] as Array<[DecisionVerdict, string]>
              ).map(([verdict, text]) => (
                <div key={verdict} className="flex gap-2.5">
                  <dt className="shrink-0">
                    <Badge
                      tone={
                        verdict === 'ACCEPTABLE'
                          ? 'positive'
                          : verdict === 'RISKY'
                            ? 'caution'
                            : verdict === 'NOT_RECOMMENDED'
                              ? 'negative'
                              : 'neutral'
                      }
                    >
                      {VERDICT_LABELS[verdict]}
                    </Badge>
                  </dt>
                  <dd className="text-ink-600">{text}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-[12px] leading-relaxed text-ink-400">
              Оценка не является гарантией допуска к закупке или победы в ней.
              Решение принимает ответственное лицо компании.
            </p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
