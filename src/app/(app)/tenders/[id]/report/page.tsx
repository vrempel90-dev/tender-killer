import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { canWrite, requireSession } from '@/lib/auth/guard';
import { PageHeader } from '@/components/layout/page-header';
import { buildDecisionReport } from '@/lib/reports/build-report';
import {
  buildDecisionSummary,
  DECISION_DISCLAIMER,
  VERDICT_LABELS,
} from '@/lib/reports/decision-report';
import { DecisionReportView } from '@/components/reports/decision-report-view';

export const metadata: Metadata = { title: 'Отчёт по тендеру' };

export default async function ReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;

  const data = await buildDecisionReport({
    tenderId: id,
    companyId: session.companyId,
  });
  if (!data) notFound();

  const summary = buildDecisionSummary(data);

  return (
    <>
      <PageHeader
        title="Отчёт для принятия решения"
        description={data.tender.title}
      />
      <div className="flex-1 px-5 py-5 sm:px-7">
        <DecisionReportView
          data={data}
          summary={summary}
          disclaimer={DECISION_DISCLAIMER}
          verdictLabel={VERDICT_LABELS[summary.verdict]}
          canSave={canWrite(session.role)}
        />
      </div>
    </>
  );
}
