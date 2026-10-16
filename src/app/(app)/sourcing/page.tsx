import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { requirePageSession } from '@/lib/auth/page-guard';
import { formatMinorKzt } from '@/lib/money';
import { PageHeader } from '@/components/layout/page-header';
import { OverviewList, type OverviewRow } from '@/components/layout/overview-list';

export const metadata: Metadata = { title: 'AI-Снабженец' };

export default async function SourcingOverviewPage() {
  const session = await requirePageSession();

  const tenders = await prisma.tender.findMany({
    where: { companyId: session.companyId },
    orderBy: { updatedAt: 'desc' },
    include: {
      lineItems: {
        select: {
          id: true,
          quantity: true,
          selectedQuoteItem: {
            select: {
              unitPriceMinor: true,
              quote: { select: { currency: true, fxRate: true } },
            },
          },
        },
      },
      supplierQuotes: { select: { id: true, verification: true } },
    },
  });

  const rows: OverviewRow[] = tenders.map((tender) => {
    let confirmedCost = 0;
    let withPrice = 0;
    for (const item of tender.lineItems) {
      const selected = item.selectedQuoteItem;
      if (!selected) continue;
      const rate =
        selected.quote.currency === 'KZT'
          ? 1
          : selected.quote.fxRate === null
            ? null
            : Number(selected.quote.fxRate);
      if (rate === null) continue;
      withPrice += 1;
      confirmedCost += Math.round(
        Number(selected.unitPriceMinor) * rate * Number(item.quantity),
      );
    }

    const total = tender.lineItems.length;
    const unverified = tender.supplierQuotes.filter(
      (q) => q.verification === 'UNVERIFIED',
    ).length;

    return {
      tenderId: tender.id,
      tenderTitle: tender.title,
      href: `/tenders/${tender.id}/sourcing`,
      statusLabel:
        total === 0
          ? 'позиций нет'
          : withPrice === total
            ? 'все цены подтверждены'
            : `с ценой ${withPrice} из ${total}`,
      statusTone:
        total === 0
          ? 'neutral'
          : withPrice === total
            ? 'positive'
            : 'caution',
      badges:
        unverified > 0
          ? [{ label: `без документа: ${unverified}`, tone: 'caution' as const }]
          : [],
      meta:
        confirmedCost > 0
          ? `подтверждённая закупка ${formatMinorKzt(confirmedCost)} · предложений ${tender.supplierQuotes.length}`
          : `предложений поставщиков: ${tender.supplierQuotes.length}`,
    };
  });

  return (
    <>
      <PageHeader
        title="AI-Снабженец"
        description="Позиции закупок и подтверждённость закупочных цен по всем тендерам."
      />
      <div className="flex-1 px-5 py-5 sm:px-7">
        <OverviewList
          title="Тендеры"
          description="Подтверждённые цены поставщиков автоматически попадают в расчёт экономики."
          rows={rows}
          emptyTitle="Тендеров нет"
          emptyDescription="Создайте тендер, загрузите техническую спецификацию и добавьте предложения поставщиков."
          emptyActionHref="/tenders/new"
          emptyActionLabel="Создать тендер"
        />
      </div>
    </>
  );
}
