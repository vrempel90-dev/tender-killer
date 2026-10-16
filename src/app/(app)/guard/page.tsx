import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { canWrite } from '@/lib/auth/guard';
import { requirePageSession } from '@/lib/auth/page-guard';
import { PageHeader } from '@/components/layout/page-header';
import { GuardPanel, type WatchRow, type TenderOption } from '@/components/guard/guard-panel';

export const metadata: Metadata = { title: 'TENDER GUARD' };

export default async function GuardPage() {
  const session = await requirePageSession();

  const [watches, tenders] = await Promise.all([
    prisma.tenderWatch.findMany({
      where: { companyId: session.companyId },
      orderBy: [{ isActive: 'desc' }, { updatedAt: 'desc' }],
      take: 200,
      select: {
        id: true,
        tenderId: true,
        isActive: true,
        note: true,
        updatedAt: true,
        tender: {
          select: {
            title: true,
            externalNumber: true,
            submissionDeadline: true,
            deliveryDeadline: true,
            startPriceMinor: true,
          },
        },
        _count: { select: { snapshots: true, changes: true } },
        changes: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: {
            id: true,
            kind: true,
            severity: true,
            summary: true,
            detail: true,
            requiresRecalc: true,
            financialImpact: true,
            acknowledgedAt: true,
            createdAt: true,
            fromSnapshot: { select: { revision: true } },
            toSnapshot: { select: { revision: true } },
          },
        },
        snapshots: {
          orderBy: { revision: 'desc' },
          select: {
            id: true,
            revision: true,
            sourceKind: true,
            capturedAt: true,
            specCharCount: true,
            note: true,
            document: { select: { originalName: true } },
          },
        },
      },
    }),
    // Тендеры, которые можно поставить на контроль.
    prisma.tender.findMany({
      where: { companyId: session.companyId, watch: null },
      orderBy: { updatedAt: 'desc' },
      take: 200,
      select: {
        id: true,
        title: true,
        externalNumber: true,
        documents: {
          where: { deletedAt: null, kind: 'TECHNICAL_SPEC' },
          orderBy: { createdAt: 'desc' },
          select: { id: true, originalName: true, createdAt: true },
        },
      },
    }),
  ]);

  const rows: WatchRow[] = watches.map((watch) => ({
    id: watch.id,
    tenderId: watch.tenderId,
    title: watch.tender.title,
    externalNumber: watch.tender.externalNumber,
    isActive: watch.isActive,
    note: watch.note,
    revisions: watch._count.snapshots,
    changesTotal: watch._count.changes,
    startPrice:
      watch.tender.startPriceMinor === null
        ? null
        : Number(watch.tender.startPriceMinor) / 100,
    submissionDeadline: watch.tender.submissionDeadline?.toISOString() ?? null,
    deliveryDeadline: watch.tender.deliveryDeadline?.toISOString() ?? null,
    updatedAt: watch.updatedAt.toISOString(),
    changes: watch.changes.map((change) => ({
      id: change.id,
      kind: change.kind,
      severity: change.severity,
      summary: change.summary,
      detail: change.detail as Record<string, unknown>,
      requiresRecalc: change.requiresRecalc,
      financialImpact: change.financialImpact as Record<string, unknown> | null,
      acknowledgedAt: change.acknowledgedAt?.toISOString() ?? null,
      createdAt: change.createdAt.toISOString(),
      fromRevision: change.fromSnapshot?.revision ?? null,
      toRevision: change.toSnapshot.revision,
    })),
    snapshots: watch.snapshots.map((snapshot) => ({
      id: snapshot.id,
      revision: snapshot.revision,
      sourceKind: snapshot.sourceKind,
      capturedAt: snapshot.capturedAt.toISOString(),
      specCharCount: snapshot.specCharCount,
      note: snapshot.note,
      documentName: snapshot.document?.originalName ?? null,
    })),
  }));

  const options: TenderOption[] = tenders.map((tender) => ({
    id: tender.id,
    title: tender.title,
    externalNumber: tender.externalNumber,
    specDocuments: tender.documents.map((document) => ({
      id: document.id,
      name: document.originalName,
    })),
  }));

  const pending = rows.reduce(
    (sum, row) => sum + row.changes.filter((change) => change.acknowledgedAt === null).length,
    0,
  );

  return (
    <>
      <PageHeader
        title="TENDER GUARD"
        description={
          'Контроль изменений по выбранным тендерам: сроки, начальная цена и '
          + 'состав требований. Важное ограничение: приложение не узнаёт об '
          + 'изменении само — законного доступа к API порталов у него нет. '
          + 'Новую редакцию приносите вы (документ или новые сроки), а GUARD '
          + 'сравнивает её с предыдущей, объясняет разницу и переоценивает '
          + 'финансовые последствия по сохранённому расчёту.'
        }
      />
      <div className="flex-1 px-5 py-5 sm:px-7">
        <GuardPanel
          canWrite={canWrite(session.role)}
          watches={rows}
          tenderOptions={options}
          pendingCount={pending}
        />
      </div>
    </>
  );
}
