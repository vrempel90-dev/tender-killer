import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { requireSession } from '@/lib/auth/guard';
import { formatMinorKzt, formatRatioAsPercent } from '@/lib/money';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusNotice } from '@/components/ui/status-notice';
import {
  computeDiscountStats,
  modelPriceOptions,
  type MarketRecord,
} from '@/lib/market/analytics';

export const metadata: Metadata = { title: 'Ценовая стратегия' };

interface SavedResult {
  breakEven?: { priceMinor?: number | null };
  profit?: { netMinor?: number };
}

export default async function PricingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ customer?: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;
  const { customer } = await searchParams;

  const tender = await prisma.tender.findFirst({
    where: { id, companyId: session.companyId },
    include: {
      financialModels: { orderBy: { updatedAt: 'desc' }, take: 1 },
    },
  });
  if (!tender) notFound();

  // Для сопоставления берутся закупки того же заказчика, если он известен,
  // иначе — все импортированные записи. Выборка всегда показана пользователю.
  const filterByCustomer =
    customer === 'all' ? false : tender.customerBin !== null;

  const rows = await prisma.historicalTender.findMany({
    where: {
      companyId: session.companyId,
      ...(filterByCustomer ? { customerBin: tender.customerBin } : {}),
    },
    take: 5000,
  });

  const records: MarketRecord[] = rows.map((row) => ({
    id: row.id,
    title: row.title,
    customerName: row.customerName,
    customerBin: row.customerBin,
    region: row.region,
    startPriceMinor:
      row.startPriceMinor === null ? null : Number(row.startPriceMinor),
    finalPriceMinor:
      row.finalPriceMinor === null ? null : Number(row.finalPriceMinor),
    winnerName: row.winnerName,
    winnerBin: row.winnerBin,
    participantsCount: row.participantsCount,
    awardedAt: row.awardedAt,
    procurementType: row.procurementType,
    sourceRef: row.sourceRef,
  }));

  const savedResult = tender.financialModels[0]?.result as SavedResult | undefined;
  const breakEvenPriceMinor = savedResult?.breakEven?.priceMinor ?? null;
  const startPriceMinor =
    tender.startPriceMinor === null ? null : Number(tender.startPriceMinor);

  const discountStats = computeDiscountStats(records);
  const model =
    startPriceMinor === null
      ? null
      : modelPriceOptions({
          startPriceMinor,
          breakEvenPriceMinor,
          discountStats,
        });

  return (
    <>
      <PageHeader
        title="Ценовая стратегия"
        description={`${tender.title} · сопоставление исторического снижения цены с вашей экономикой`}
      />
      <div className="flex-1 space-y-5 px-5 py-5 sm:px-7">
        {startPriceMinor === null ? (
          <StatusNotice severity="WARNING" title="Не указана начальная цена закупки">
            Без начальной цены смоделировать ценовые предложения нельзя.
            Укажите её в карточке тендера.
          </StatusNotice>
        ) : null}

        {breakEvenPriceMinor === null ? (
          <StatusNotice severity="WARNING" title="Нет сохранённого финансового расчёта">
            Чтобы понять, какое снижение цены вы можете себе позволить,
            выполните и сохраните расчёт на странице{' '}
            <Link
              href={`/tenders/${tender.id}/finance`}
              className="font-medium text-brand-600 hover:text-brand-700"
            >
              «Экономика тендера»
            </Link>
            .
          </StatusNotice>
        ) : null}

        <Card>
          <CardHeader
            action={
              tender.customerBin ? (
                <Link
                  href={`/tenders/${tender.id}/pricing?customer=${filterByCustomer ? 'all' : 'same'}`}
                  className="text-[13px] font-medium text-brand-600 hover:text-brand-700"
                >
                  {filterByCustomer
                    ? 'Показать по всем заказчикам'
                    : 'Только этот заказчик'}
                </Link>
              ) : null
            }
          >
            <CardTitle>Историческая база для сопоставления</CardTitle>
            <CardDescription>
              {filterByCustomer
                ? `Закупки заказчика с БИН ${tender.customerBin}: ${records.length} записей.`
                : `Все импортированные закупки: ${records.length} записей.`}{' '}
              {discountStats.note}
            </CardDescription>
          </CardHeader>
          <CardBody>
            {records.length === 0 ? (
              <EmptyState
                title="Исторических данных нет"
                description="Импортируйте выгрузку завершённых закупок в разделе «Аналитика конкурентов». Платформа не создаёт статистику по реальным закупкам сама."
              />
            ) : (
              <div className="grid gap-3.5 sm:grid-cols-4">
                <Metric
                  label="Записей в выборке"
                  value={String(discountStats.sampleSize)}
                />
                <Metric
                  label="Медианное снижение"
                  value={formatRatioAsPercent(discountStats.medianDiscountRatio)}
                />
                <Metric
                  label="Среднее снижение"
                  value={formatRatioAsPercent(discountStats.averageDiscountRatio)}
                />
                <Metric
                  label="Максимальное"
                  value={formatRatioAsPercent(discountStats.maxDiscountRatio)}
                />
              </div>
            )}
          </CardBody>
        </Card>

        {model && model.scenarios.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Варианты ценового предложения</CardTitle>
              <CardDescription>
                Каждый вариант показывает, остаётся ли сделка прибыльной при
                таком снижении. Основание каждого расчёта указано явно.
              </CardDescription>
            </CardHeader>
            <CardBody className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-[13px]">
                  <thead>
                    <tr className="border-b border-ink-100 text-left text-[12px] uppercase tracking-wide text-ink-400">
                      <th className="px-5 py-2.5 font-medium">Вариант</th>
                      <th className="px-5 py-2.5 text-right font-medium">Снижение</th>
                      <th className="px-5 py-2.5 text-right font-medium">Цена</th>
                      <th className="px-5 py-2.5 text-right font-medium">
                        Запас над безубыточной
                      </th>
                      <th className="px-5 py-2.5 text-center font-medium">Результат</th>
                    </tr>
                  </thead>
                  <tbody>
                    {model.scenarios.map((scenario) => (
                      <tr
                        key={scenario.label}
                        className="border-b border-ink-50 align-top last:border-0"
                      >
                        <td className="px-5 py-3">
                          <p className="font-medium text-ink-900">{scenario.label}</p>
                          <p className="mt-0.5 text-[12px] text-ink-400">
                            {scenario.basis}
                          </p>
                        </td>
                        <td className="px-5 py-3 text-right tabular text-ink-700">
                          {formatRatioAsPercent(scenario.discountRatio)}
                        </td>
                        <td className="px-5 py-3 text-right tabular font-medium text-ink-900">
                          {formatMinorKzt(scenario.priceMinor)}
                        </td>
                        <td className="px-5 py-3 text-right tabular text-ink-600">
                          {formatRatioAsPercent(scenario.marginOverBreakEvenRatio)}
                        </td>
                        <td className="px-5 py-3 text-center">
                          {scenario.aboveBreakEven === null ? (
                            <Badge tone="neutral">не определено</Badge>
                          ) : scenario.aboveBreakEven ? (
                            <Badge tone="positive">прибыльно</Badge>
                          ) : (
                            <Badge tone="negative">убыток</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>
        ) : null}

        {model ? (
          <Card>
            <CardHeader>
              <CardTitle>Что важно понимать</CardTitle>
            </CardHeader>
            <CardBody>
              <ul className="space-y-2 text-[13px] leading-relaxed text-ink-700">
                {model.warnings.map((warning) => (
                  <li key={warning} className="flex gap-2">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-400" />
                    {warning}
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        ) : null}
      </div>
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-ink-200 px-3.5 py-3">
      <p className="text-[12px] uppercase tracking-wide text-ink-400">{label}</p>
      <p className="mt-1 text-[18px] font-semibold tabular text-ink-900">{value}</p>
    </div>
  );
}
