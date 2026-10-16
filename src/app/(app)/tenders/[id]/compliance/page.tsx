import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { canWrite } from '@/lib/auth/guard';
import { requirePageSession } from '@/lib/auth/page-guard';
import { isAiConfigured } from '@/lib/env';
import { PageHeader } from '@/components/layout/page-header';
import { CompliancePanel, type RunRow } from '@/components/compliance/compliance-panel';
import type { PickableDocument } from '@/components/compliance/document-picker';

export const metadata: Metadata = { title: 'Проверка документов' };

export default async function CompliancePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requirePageSession();
  const { id } = await params;

  const tender = await prisma.tender.findFirst({
    where: { id, companyId: session.companyId },
    include: {
      requirements: { select: { id: true, confirmedByUser: true } },
      complianceRuns: {
        orderBy: { startedAt: 'desc' },
        take: 10,
        include: {
          findings: {
            include: { document: { select: { originalName: true } } },
          },
        },
      },
    },
  });

  if (!tender) notFound();

  // Свои документы компании: могут быть привязаны к этому тендеру или общие.
  const ownDocs = await prisma.document.findMany({
    where: {
      companyId: session.companyId,
      deletedAt: null,
      OR: [{ tenderId: id }, { tenderId: null }],
      kind: { in: ['OWN_CERTIFICATE', 'OTHER', 'SUPPLIER_QUOTE'] },
    },
    orderBy: { createdAt: 'desc' },
    include: {
      extraction: {
        select: { status: true, charCount: true, unreadablePages: true },
      },
    },
  });

  const documents: PickableDocument[] = ownDocs.map((d) => ({
    id: d.id,
    originalName: d.originalName,
    kind: d.kind,
    extractionStatus: d.extraction?.status ?? null,
    charCount: d.extraction?.charCount ?? null,
    unreadablePagesCount: d.extraction?.unreadablePages.length ?? 0,
  }));

  // Имена нечитаемых документов для последнего запуска
  const docNameById = new Map(ownDocs.map((d) => [d.id, d.originalName]));

  const runs: RunRow[] = tender.complianceRuns.map((run) => ({
    id: run.id,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    status: run.status,
    aiModel: run.aiModel,
    error: run.error,
    unreadableDocumentNames: run.unreadableDocumentIds.map(
      (docId) => docNameById.get(docId) ?? 'документ удалён',
    ),
    findings: run.findings.map((f) => ({
      id: f.id,
      requirementText: f.requirementText,
      status: f.status,
      riskLevel: f.riskLevel,
      documentName: f.documentName ?? f.document?.originalName ?? null,
      pageNumber: f.pageNumber,
      evidenceQuote: f.evidenceQuote,
      recommendation: f.recommendation,
      uncertaintyReason: f.uncertaintyReason,
    })),
  }));

  return (
    <>
      <PageHeader
        title="Проверка документов заявки"
        description={`${tender.title} · шаг 6 из 7`}
      />
      <div className="flex-1 px-5 py-5 sm:px-7">
        <CompliancePanel
          tenderId={tender.id}
          runs={runs}
          ownDocuments={documents}
          confirmedRequirementsCount={
            tender.requirements.filter((r) => r.confirmedByUser).length
          }
          totalRequirementsCount={tender.requirements.length}
          aiConfigured={isAiConfigured()}
          canEdit={canWrite(session.role)}
        />
      </div>
    </>
  );
}
