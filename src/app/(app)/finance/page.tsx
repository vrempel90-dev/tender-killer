import Link from 'next/link';
import type { Metadata } from 'next';
import { Banknote, Calculator } from 'lucide-react';
import { prisma } from '@/lib/db';
import { requireSession } from '@/lib/auth/guard';
import { formatMinorKzt, formatRatioAsPercent } from '@/lib/money';
import { PageHeader } from '@/components/layout/page-header';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';

export const metadata: Metadata = { title: 'Финансовая аналитика' };

interface SavedResultShape {
  profit?: { netMinor?: number };
  revenue?: { netMinor?: number; grossMinor?: number };
  margins?: { netRatio?: number | null };
  workingCapital?: { requirementMinor?: number };
  warnings?: Array<{ severity?: string }>;
}

export default async function FinancePage() {
  const session = await requireSession();

  const models = await prisma.financialModel.findMany({
    where: { tender: { companyId: session.companyId } },
    orderBy: { updatedAt: 'desc' },
    include: { tender: { select: { id: true, title: true, stage: true } } },
  });

  const rows = models.map((m) => {
    const r = (m.result ?? {}) as SavedResultShape;
    return {
      id: m.id,
      name: m.name,
      tenderId: m.tender.id,
      tenderTitle: m.tender.title,
      updatedAt: m.updatedAt,
      engineVersion: m.engineVersion,
      netProfitMinor: r.profit?.netMinor ?? null,
      revenueNetMinor: r.revenue?.netMinor ?? null,
      netRatio: r.margins?.netRatio ?? null,
      workingCapitalMinor: r.workingCapital?.requirementMinor ?? null,
      criticalWarnings:
        r.warnings?.filter((w) => w.severity === 'CRITICAL').length ?? 0,
    };
  });

  const totalProfit = rows.reduce((sum, r) => sum + (r.netProfitMinor ?? 0), 0);
  const totalWorkingCapital = rows.reduce(
    (sum, r) => sum + (r.workingCapitalMinor ?? 0),
    0,
  );

  return (
    <>
      <PageHeader
        title="Финансовая аналитика"
        description="Сохранённые расчёты экономики тендеров. Суммы берутся из расчётов, а не оцениваются заново."
      />
      <div className="flex-1 space-y-5 px-5 py-5 sm:px-7">
        {rows.length === 0 ? (
          <EmptyState
            icon={<Calculator className="size-8" aria-hidden />}
            title="Сохранённых расчётов нет"
            description="Откройте тендер и рассчитайте его экономику: выручку, полную себестоимость, прибыль, кассовый разрыв и чувствительность к снижению цены."
            action={
              <ButtonLink href="/tenders">Перейти к тендерам</ButtonLink>
            }
          />
        ) : (
          <>
            <div className="grid gap-3.5 sm:grid-cols-3">
              <Card>
                <CardBody>
                  <p className="text-[12px] uppercase tracking-wide text-ink-400">
                    Расчётная прибыль по всем расчётам
                  </p>
                  <p className="mt-1.5 text-[22px] font-semibold tabular text-ink-900">
                    {formatMinorKzt(totalProfit)}
                  </p>
                </CardBody>
              </Card>
              <Card>
                <CardBody>
                  <p className="text-[12px] uppercase tracking-wide text-ink-400">
                    Суммарная потребность в оборотных средствах
                  </p>
                  <p className="mt-1.5 text-[22px] font-semibold tabular text-ink-900">
                    {formatMinorKzt(totalWorkingCapital)}
                  </p>
                  <p className="mt-1 text-[12px] text-ink-400">
                    Если участвовать во всех одновременно
                  </p>
                </CardBody>
              </Card>
              <Card>
                <CardBody>
                  <p className="text-[12px] uppercase tracking-wide text-ink-400">
                    Расчётов с критическими замечаниями
                  </p>
                  <p className="mt-1.5 text-[22px] font-semibold tabular text-ink-900">
                    {rows.filter((r) => r.criticalWarnings > 0).length} из {rows.length}
                  </p>
                </CardBody>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Расчёты</CardTitle>
                <CardDescription>
                  Нажмите на тендер, чтобы открыть расчёт и изменить параметры.
                </CardDescription>
              </CardHeader>
              <CardBody className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[880px] text-[13px]">
                    <thead>
                      <tr className="border-b border-ink-100 text-left text-[12px] uppercase tracking-wide text-ink-400">
                        <th className="px-5 py-2.5 font-medium">Тендер / расчёт</th>
                        <th className="px-5 py-2.5 text-right font-medium">
                          Выручка без НДС
                        </th>
                        <th className="px-5 py-2.5 text-right font-medium">
                          Чистая прибыль
                        </th>
                        <th className="px-5 py-2.5 text-right font-medium">
                          Рентабельность
                        </th>
                        <th className="px-5 py-2.5 text-right font-medium">
                          Кассовый разрыв
                        </th>
                        <th className="px-5 py-2.5 text-center font-medium">Риски</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr
                          key={row.id}
                          className="border-b border-ink-50 last:border-0 hover:bg-ink-50/60"
                        >
                          <td className="px-5 py-3">
                            <Link
                              href={`/tenders/${row.tenderId}/finance`}
                              className="font-medium text-ink-900 hover:text-brand-700"
                            >
                              {row.tenderTitle}
                            </Link>
                            <p className="mt-0.5 text-[12px] text-ink-400">
                              {row.name} · движок {row.engineVersion} ·{' '}
                              {new Intl.DateTimeFormat('ru-KZ', {
                                dateStyle: 'short',
                                timeStyle: 'short',
                              }).format(row.updatedAt)}
                            </p>
                          </td>
                          <td className="px-5 py-3 text-right tabular text-ink-700">
                            {formatMinorKzt(row.revenueNetMinor)}
                          </td>
                          <td
                            className={
                              (row.netProfitMinor ?? 0) >= 0
                                ? 'px-5 py-3 text-right tabular font-medium text-emerald-700'
                                : 'px-5 py-3 text-right tabular font-medium text-red-700'
                            }
                          >
                            {formatMinorKzt(row.netProfitMinor)}
                          </td>
                          <td className="px-5 py-3 text-right tabular text-ink-600">
                            {formatRatioAsPercent(row.netRatio)}
                          </td>
                          <td className="px-5 py-3 text-right tabular text-ink-600">
                            {row.workingCapitalMinor
                              ? formatMinorKzt(row.workingCapitalMinor)
                              : '—'}
                          </td>
                          <td className="px-5 py-3 text-center">
                            {row.criticalWarnings > 0 ? (
                              <Badge tone="negative">
                                {row.criticalWarnings} критич.
                              </Badge>
                            ) : (
                              <Badge tone="positive">нет</Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>
                  <span className="flex items-center gap-2">
                    <Banknote className="size-4 text-ink-400" aria-hidden />
                    Что показывают эти цифры
                  </span>
                </CardTitle>
              </CardHeader>
              <CardBody>
                <ul className="space-y-1.5 text-[13px] leading-relaxed text-ink-600">
                  <li>
                    <strong className="font-medium text-ink-800">
                      Чистая прибыль
                    </strong>{' '}
                    — расчётный финансовый результат, не деньги на счёте.
                  </li>
                  <li>
                    <strong className="font-medium text-ink-800">
                      Кассовый разрыв
                    </strong>{' '}
                    — сколько денег нужно иметь или привлечь, чтобы дотянуть до
                    оплаты заказчиком.
                  </li>
                  <li>
                    <strong className="font-medium text-ink-800">
                      Рентабельность
                    </strong>{' '}
                    — чистая прибыль к выручке без НДС.
                  </li>
                </ul>
              </CardBody>
            </Card>
          </>
        )}
      </div>
    </>
  );
}
