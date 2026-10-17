import Link from 'next/link';
import type { Metadata } from 'next';
import {
  AlertTriangle,
  Banknote,
  FileText,
  Plus,
  ScrollText,
  TrendingUp,
} from 'lucide-react';
import { prisma } from '@/lib/db';
import { requirePageSession } from '@/lib/auth/page-guard';
import { getAiAvailability } from '@/lib/ai/availability';
import { formatMinorKzt } from '@/lib/money';
import { PageHeader } from '@/components/layout/page-header';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { StatTile } from '@/components/ui/stat-tile';
import { StatusNotice } from '@/components/ui/status-notice';
import { Badge } from '@/components/ui/badge';
import { TENDER_STAGE_LABELS } from '@/lib/tender-labels';
import { PipelineChart } from '@/components/dashboard/pipeline-chart';

export const metadata: Metadata = { title: 'Главная' };

export default async function DashboardPage() {
  const session = await requirePageSession();
  const companyId = session.companyId;

  const [tenders, documentCount, complianceRuns, financialModels, ai] = await Promise.all([
    prisma.tender.findMany({
      where: { companyId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        title: true,
        stage: true,
        startPriceMinor: true,
        submissionDeadline: true,
        updatedAt: true,
        customerName: true,
      },
    }),
    prisma.document.count({ where: { companyId, deletedAt: null } }),
    prisma.complianceRun.findMany({
      where: { tender: { companyId } },
      orderBy: { startedAt: 'desc' },
      take: 5,
      select: {
        id: true,
        startedAt: true,
        status: true,
        tenderId: true,
        tender: { select: { title: true } },
        findings: { select: { status: true, riskLevel: true } },
      },
    }),
    prisma.financialModel.findMany({
      where: { tender: { companyId } },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, tenderId: true, result: true, updatedAt: true },
    }),
    getAiAvailability(),
  ]);

  const activeStages = ['DRAFT', 'ANALYSIS', 'DECIDED_GO', 'SUBMITTED'] as const;
  const activeTenders = tenders.filter((t) =>
    (activeStages as readonly string[]).includes(t.stage),
  );

  const contractSumMinor = activeTenders.reduce(
    (sum, t) => sum + Number(t.startPriceMinor ?? 0n),
    0,
  );

  // Расчётная прибыль берётся ТОЛЬКО из сохранённых расчётов.
  // Если расчётов нет — показывается прочерк, а не ноль.
  const latestByTender = new Map<string, unknown>();
  for (const model of financialModels) {
    if (!latestByTender.has(model.tenderId) && model.result) {
      latestByTender.set(model.tenderId, model.result);
    }
  }
  let plannedProfitMinor: number | null = null;
  for (const result of latestByTender.values()) {
    const net = extractNetProfit(result);
    if (net !== null) {
      plannedProfitMinor = (plannedProfitMinor ?? 0) + net;
    }
  }

  const riskyRuns = complianceRuns.filter((run) =>
    run.findings.some(
      (f) =>
        f.status === 'NOT_FOUND' ||
        f.status === 'MISMATCH' ||
        f.riskLevel === 'CRITICAL' ||
        f.riskLevel === 'HIGH',
    ),
  );

  return (
    <>
      <PageHeader
        title="Главная"
        description="Сводка по тендерам компании. Все суммы — из введённых и сохранённых вами данных."
        actions={
          <ButtonLink href="/tenders/new">
            <Plus className="size-4" aria-hidden />
            Проанализировать тендер
          </ButtonLink>
        }
      />

      <div className="flex-1 space-y-5 px-5 py-5 sm:px-7">
        <StatusNotice severity={ai.state === 'available' || ai.state === 'unverified' ? 'INFO' : 'WARNING'} title={ai.title}>
          {ai.description}
        </StatusNotice>

        <section className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Тендеров в работе"
            value={String(activeTenders.length)}
            hint={`Всего карточек: ${tenders.length}`}
            icon={<FileText className="size-4" aria-hidden />}
          />
          <StatTile
            label="Сумма рассматриваемых закупок"
            value={
              activeTenders.length === 0
                ? '—'
                : formatMinorKzt(contractSumMinor)
            }
            hint="По начальной цене закупки"
            icon={<Banknote className="size-4" aria-hidden />}
          />
          <StatTile
            label="Расчётная прибыль по проектам"
            value={
              plannedProfitMinor === null ? '—' : formatMinorKzt(plannedProfitMinor)
            }
            hint={
              plannedProfitMinor === null
                ? 'Нет сохранённых финансовых расчётов'
                : `По ${latestByTender.size} сохранённым расчётам`
            }
            tone={
              plannedProfitMinor === null
                ? 'neutral'
                : plannedProfitMinor >= 0
                  ? 'positive'
                  : 'negative'
            }
            icon={<TrendingUp className="size-4" aria-hidden />}
          />
          <StatTile
            label="Тендеры с выявленными рисками"
            value={String(riskyRuns.length)}
            hint={`Загружено документов: ${documentCount}`}
            tone={riskyRuns.length > 0 ? 'caution' : 'neutral'}
            icon={<AlertTriangle className="size-4" aria-hidden />}
          />
        </section>

        <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
          <Card>
            <CardHeader
              action={
                tenders.length > 0 ? (
                  <Link
                    href="/tenders"
                    className="text-[13px] font-medium text-brand-600 hover:text-brand-700"
                  >
                    Все тендеры
                  </Link>
                ) : null
              }
            >
              <CardTitle>Последние тендеры</CardTitle>
            </CardHeader>
            <CardBody className="p-0">
              {tenders.length === 0 ? (
                <div className="p-5">
                  <EmptyState
                    icon={<FileText className="size-8" aria-hidden />}
                    title="Тендеров пока нет"
                    description="Создайте карточку тендера, загрузите техническую спецификацию и проект договора — платформа рассчитает экономику и покажет риски."
                    action={
                      <ButtonLink href="/tenders/new">
                        <Plus className="size-4" aria-hidden />
                        Создать первый тендер
                      </ButtonLink>
                    }
                  />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[620px] text-[13px]">
                    <thead>
                      <tr className="border-b border-ink-100 text-left text-[12px] uppercase tracking-wide text-ink-400">
                        <th className="px-5 py-2.5 font-medium">Тендер</th>
                        <th className="px-5 py-2.5 font-medium">Стадия</th>
                        <th className="px-5 py-2.5 text-right font-medium">
                          Начальная цена
                        </th>
                        <th className="px-5 py-2.5 font-medium">Срок подачи</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tenders.slice(0, 8).map((tender) => (
                        <tr
                          key={tender.id}
                          className="border-b border-ink-50 last:border-0 hover:bg-ink-50/60"
                        >
                          <td className="px-5 py-3">
                            <Link
                              href={`/tenders/${tender.id}`}
                              className="font-medium text-ink-900 hover:text-brand-700"
                            >
                              {tender.title}
                            </Link>
                            {tender.customerName ? (
                              <p className="mt-0.5 text-[12px] text-ink-400">
                                {tender.customerName}
                              </p>
                            ) : null}
                          </td>
                          <td className="px-5 py-3">
                            <Badge tone={stageTone(tender.stage)}>
                              {TENDER_STAGE_LABELS[tender.stage]}
                            </Badge>
                          </td>
                          <td className="px-5 py-3 text-right tabular text-ink-700">
                            {tender.startPriceMinor === null
                              ? '—'
                              : formatMinorKzt(Number(tender.startPriceMinor))}
                          </td>
                          <td className="px-5 py-3 text-ink-600">
                            {tender.submissionDeadline
                              ? new Intl.DateTimeFormat('ru-KZ', {
                                  day: '2-digit',
                                  month: '2-digit',
                                  year: 'numeric',
                                }).format(tender.submissionDeadline)
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardBody>
          </Card>

          <div className="space-y-5">
            <Card>
              <CardHeader>
                <CardTitle>Тендеры по стадиям</CardTitle>
              </CardHeader>
              <CardBody>
                {tenders.length === 0 ? (
                  <p className="py-6 text-center text-[13px] text-ink-400">
                    Нет данных для графика
                  </p>
                ) : (
                  <PipelineChart
                    data={Object.entries(
                      tenders.reduce<Record<string, number>>((acc, t) => {
                        acc[t.stage] = (acc[t.stage] ?? 0) + 1;
                        return acc;
                      }, {}),
                    ).map(([stage, count]) => ({
                      stage:
                        TENDER_STAGE_LABELS[
                          stage as keyof typeof TENDER_STAGE_LABELS
                        ] ?? stage,
                      count,
                    }))}
                  />
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Последние проверки документов</CardTitle>
              </CardHeader>
              <CardBody className="space-y-2.5">
                {complianceRuns.length === 0 ? (
                  <p className="py-4 text-center text-[13px] text-ink-400">
                    Проверок пока не было
                  </p>
                ) : (
                  complianceRuns.map((run) => {
                    const problems = run.findings.filter(
                      (f) => f.status === 'NOT_FOUND' || f.status === 'MISMATCH',
                    ).length;
                    return (
                      <Link
                        key={run.id}
                        href={`/tenders/${run.tenderId}/compliance`}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ink-100 px-3 py-2.5 hover:border-ink-200 hover:bg-ink-50/60"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium text-ink-900">
                            {run.tender.title}
                          </p>
                          <p className="text-[12px] text-ink-400">
                            {new Intl.DateTimeFormat('ru-KZ', {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            }).format(run.startedAt)}
                          </p>
                        </div>
                        <Badge tone={run.status !== 'SUCCEEDED' || run.findings.length === 0 ? 'caution' : problems > 0 ? 'negative' : 'positive'}>
                          {run.status !== 'SUCCEEDED' || run.findings.length === 0 ? 'Проверка не завершена' : problems > 0
                            ? `Замечаний: ${problems}`
                            : `Проверено: ${run.findings.length}`}
                        </Badge>
                      </Link>
                    );
                  })
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Как устроен расчёт</CardTitle>
              </CardHeader>
              <CardBody>
                <ul className="space-y-2 text-[13px] leading-relaxed text-ink-600">
                  <li className="flex gap-2">
                    <ScrollText className="mt-0.5 size-3.5 shrink-0 text-ink-400" aria-hidden />
                    Прибыль и денежный поток считаются отдельно: прибыльный тендер
                    может дать кассовый разрыв.
                  </li>
                  <li className="flex gap-2">
                    <ScrollText className="mt-0.5 size-3.5 shrink-0 text-ink-400" aria-hidden />
                    Обеспечения заявки и договора — возвратные: в расходы попадает
                    только их стоимость.
                  </li>
                  <li className="flex gap-2">
                    <ScrollText className="mt-0.5 size-3.5 shrink-0 text-ink-400" aria-hidden />
                    Налоговые ставки берутся из настроек с указанием источника и даты
                    актуальности.
                  </li>
                </ul>
                <Link
                  href="/settings/taxes"
                  className="mt-3 inline-block text-[13px] font-medium text-brand-600 hover:text-brand-700"
                >
                  Проверить налоговые ставки
                </Link>
              </CardBody>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}

/** Извлекает чистую прибыль из сохранённого результата расчёта. */
function extractNetProfit(result: unknown): number | null {
  if (typeof result !== 'object' || result === null) return null;
  const profit = (result as { profit?: unknown }).profit;
  if (typeof profit !== 'object' || profit === null) return null;
  const net = (profit as { netMinor?: unknown }).netMinor;
  return typeof net === 'number' && Number.isFinite(net) ? net : null;
}

function stageTone(
  stage: string,
): 'neutral' | 'brand' | 'positive' | 'negative' | 'caution' {
  switch (stage) {
    case 'WON':
      return 'positive';
    case 'LOST':
    case 'DECIDED_NO_GO':
      return 'negative';
    case 'ANALYSIS':
      return 'brand';
    case 'SUBMITTED':
    case 'DECIDED_GO':
      return 'caution';
    default:
      return 'neutral';
  }
}
