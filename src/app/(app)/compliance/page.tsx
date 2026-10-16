import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { requirePageSession } from '@/lib/auth/page-guard';
import { isAiConfigured } from '@/lib/env';
import { PageHeader } from '@/components/layout/page-header';
import { OverviewList, type OverviewRow } from '@/components/layout/overview-list';
import { NotImplementedNotice } from '@/components/ui/status-notice';

export const metadata: Metadata = { title: 'Проверка документов' };

export default async function ComplianceOverviewPage() {
  const session = await requirePageSession();

  const tenders = await prisma.tender.findMany({
    where: { companyId: session.companyId },
    orderBy: { updatedAt: 'desc' },
    include: {
      requirements: { select: { id: true, confirmedByUser: true } },
      complianceRuns: {
        orderBy: { startedAt: 'desc' },
        take: 1,
        include: { findings: { select: { status: true } } },
      },
    },
  });

  const rows: OverviewRow[] = tenders.map((tender) => {
    const run = tender.complianceRuns[0];
    const confirmed = tender.requirements.filter((r) => r.confirmedByUser).length;

    if (!run) {
      return {
        tenderId: tender.id,
        tenderTitle: tender.title,
        href: `/tenders/${tender.id}/compliance`,
        statusLabel: 'проверки не было',
        statusTone: 'neutral',
        meta: `требований ${tender.requirements.length}, подтверждено ${confirmed}`,
      };
    }

    const problems = run.findings.filter(
      (f) => f.status === 'NOT_FOUND' || f.status === 'MISMATCH',
    ).length;
    const review = run.findings.filter((f) => f.status === 'NEEDS_REVIEW').length;

    return {
      tenderId: tender.id,
      tenderTitle: tender.title,
      href: `/tenders/${tender.id}/compliance`,
      statusLabel: problems > 0 ? `замечаний ${problems}` : 'замечаний нет',
      statusTone: problems > 0 ? 'negative' : 'positive',
      badges: review > 0 ? [{ label: `требует проверки ${review}`, tone: 'caution' }] : [],
      meta: `проверено ${new Intl.DateTimeFormat('ru-KZ', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(run.startedAt)} · требований ${run.findings.length}`,
    };
  });

  return (
    <>
      <PageHeader
        title="Проверка документов"
        description="Состояние проверки заявок по всем тендерам компании."
      />
      <div className="flex-1 space-y-5 px-5 py-5 sm:px-7">
        {!isAiConfigured() ? (
          <NotImplementedNotice
            feature="Автоматическая проверка документов"
            requires="AI-модель недоступна. Обратитесь к администратору. Загрузка документов, извлечение текста и ручное ведение требований работают."
          />
        ) : null}
        <OverviewList
          title="Тендеры"
          description="Перейдите к тендеру, чтобы запустить или посмотреть проверку."
          rows={rows}
          emptyTitle="Тендеров нет"
          emptyDescription="Создайте тендер и загрузите документы, чтобы проверить комплектность заявки."
          emptyActionHref="/tenders/new"
          emptyActionLabel="Создать тендер"
        />
      </div>
    </>
  );
}
