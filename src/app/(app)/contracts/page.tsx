import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { requirePageSession } from '@/lib/auth/page-guard';
import { isAiConfigured } from '@/lib/env';
import { PageHeader } from '@/components/layout/page-header';
import { OverviewList, type OverviewRow } from '@/components/layout/overview-list';
import { NotImplementedNotice } from '@/components/ui/status-notice';

export const metadata: Metadata = { title: 'Анализ договоров' };

export default async function ContractsOverviewPage() {
  const session = await requirePageSession();

  const tenders = await prisma.tender.findMany({
    where: { companyId: session.companyId },
    orderBy: { updatedAt: 'desc' },
    include: {
      contractAnalyses: {
        orderBy: { startedAt: 'desc' },
        take: 1,
        include: { risks: { select: { riskLevel: true, needsLawyerReview: true } } },
      },
      documents: {
        where: { deletedAt: null, kind: 'CONTRACT_DRAFT' },
        select: { id: true },
      },
    },
  });

  const rows: OverviewRow[] = tenders.map((tender) => {
    const analysis = tender.contractAnalyses[0];

    if (!analysis) {
      return {
        tenderId: tender.id,
        tenderTitle: tender.title,
        href: `/tenders/${tender.id}/contract`,
        statusLabel: 'анализа не было',
        statusTone: 'neutral',
        meta:
          tender.documents.length === 0
            ? 'проект договора не загружен'
            : `загружено проектов договора: ${tender.documents.length}`,
      };
    }

    const high = analysis.risks.filter(
      (r) => r.riskLevel === 'CRITICAL' || r.riskLevel === 'HIGH',
    ).length;
    const lawyer = analysis.risks.filter((r) => r.needsLawyerReview).length;

    return {
      tenderId: tender.id,
      tenderTitle: tender.title,
      href: `/tenders/${tender.id}/contract`,
      statusLabel: high > 0 ? `высоких рисков ${high}` : 'высоких рисков нет',
      statusTone: high > 0 ? 'negative' : 'positive',
      badges: lawyer > 0 ? [{ label: `нужен юрист: ${lawyer}`, tone: 'caution' }] : [],
      meta: `всего рисков ${analysis.risks.length} · ${new Intl.DateTimeFormat('ru-KZ', {
        dateStyle: 'short',
      }).format(analysis.startedAt)}`,
    };
  });

  return (
    <>
      <PageHeader
        title="Анализ договоров"
        description="Договорные риски по всем тендерам компании."
      />
      <div className="flex-1 space-y-5 px-5 py-5 sm:px-7">
        {!isAiConfigured() ? (
          <NotImplementedNotice
            feature="Анализ проекта договора"
            requires="Требуется переменная окружения ANTHROPIC_API_KEY."
          />
        ) : null}
        <OverviewList
          title="Тендеры"
          description="Перейдите к тендеру, чтобы запустить анализ договора или посмотреть результат."
          rows={rows}
          emptyTitle="Тендеров нет"
          emptyDescription="Создайте тендер и загрузите проект договора, чтобы оценить риски."
          emptyActionHref="/tenders/new"
          emptyActionLabel="Создать тендер"
        />
      </div>
    </>
  );
}
