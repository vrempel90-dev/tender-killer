import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { canWrite } from '@/lib/auth/guard';
import { requirePageSession } from '@/lib/auth/page-guard';
import { PageHeader } from '@/components/layout/page-header';
import { MarketPanel, type ImportBatch } from '@/components/market/market-panel';
import {
  computeCustomers,
  computeDiscountStats,
  computeWinners,
  type MarketRecord,
} from '@/lib/market/analytics';

export const metadata: Metadata = { title: 'Аналитика конкурентов' };

export default async function MarketPage() {
  const session = await requirePageSession();

  const rows = await prisma.historicalTender.findMany({
    where: { companyId: session.companyId },
    orderBy: { awardedAt: 'desc' },
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

  // Группировка по партиям импорта
  const batchMap = new Map<string, ImportBatch>();
  for (const row of rows) {
    const key = row.importBatchId ?? 'без-партии';
    const existing = batchMap.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      batchMap.set(key, {
        batchId: key,
        sourceRef: row.sourceRef,
        importedAt: row.importedAt.toISOString(),
        count: 1,
      });
    }
  }

  return (
    <>
      <PageHeader
        title="Аналитика закупок и конкурентов"
        description="Статистика по импортированным завершённым закупкам: снижение цены, победители, заказчики."
      />
      <div className="flex-1 px-5 py-5 sm:px-7">
        <MarketPanel
          recordsCount={records.length}
          discountStats={computeDiscountStats(records)}
          winners={computeWinners(records)}
          customers={computeCustomers(records)}
          batches={[...batchMap.values()].sort(
            (a, b) => new Date(b.importedAt).getTime() - new Date(a.importedAt).getTime(),
          )}
          canEdit={canWrite(session.role)}
        />
      </div>
    </>
  );
}
