import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { canWrite, requireSession } from '@/lib/auth/guard';
import { isAiConfigured } from '@/lib/env';
import { PageHeader } from '@/components/layout/page-header';
import {
  ContractPanel,
  type ContractAnalysisRow,
} from '@/components/contracts/contract-panel';
import type { PickableDocument } from '@/components/compliance/document-picker';

export const metadata: Metadata = { title: 'Анализ договора' };

export default async function ContractPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;

  const tender = await prisma.tender.findFirst({
    where: { id, companyId: session.companyId },
    include: {
      documents: {
        where: { deletedAt: null, kind: { in: ['CONTRACT_DRAFT', 'OTHER'] } },
        orderBy: { createdAt: 'desc' },
        include: {
          extraction: {
            select: { status: true, charCount: true, unreadablePages: true },
          },
        },
      },
      contractAnalyses: {
        orderBy: { startedAt: 'desc' },
        take: 5,
        include: {
          risks: true,
          document: { select: { originalName: true } },
        },
      },
    },
  });

  if (!tender) notFound();

  const contractDocuments: PickableDocument[] = tender.documents.map((d) => ({
    id: d.id,
    originalName: d.originalName,
    kind: d.kind,
    extractionStatus: d.extraction?.status ?? null,
    charCount: d.extraction?.charCount ?? null,
    unreadablePagesCount: d.extraction?.unreadablePages.length ?? 0,
  }));

  const analyses: ContractAnalysisRow[] = tender.contractAnalyses.map((a) => ({
    id: a.id,
    documentName: a.document.originalName,
    startedAt: a.startedAt.toISOString(),
    status: a.status,
    aiModel: a.aiModel,
    error: a.error,
    extractedTerms: (a.extractedTerms ?? null) as Record<string, number | null> | null,
    risks: a.risks.map((r) => ({
      id: r.id,
      category: r.category,
      title: r.title,
      clauseRef: r.clauseRef,
      pageNumber: r.pageNumber,
      sourceQuote: r.sourceQuote,
      riskLevel: r.riskLevel,
      explanation: r.explanation,
      recommendation: r.recommendation,
      needsLawyerReview: r.needsLawyerReview,
      financeHint: (r.financeHint ?? null) as Record<string, number | null> | null,
    })),
  }));

  return (
    <>
      <PageHeader
        title="Анализ проекта договора"
        description={`${tender.title} · шаг 7 из 7`}
      />
      <div className="flex-1 px-5 py-5 sm:px-7">
        <ContractPanel
          tenderId={tender.id}
          analyses={analyses}
          contractDocuments={contractDocuments}
          aiConfigured={isAiConfigured()}
          canEdit={canWrite(session.role)}
          financeHref={`/tenders/${tender.id}/finance`}
        />
      </div>
    </>
  );
}
