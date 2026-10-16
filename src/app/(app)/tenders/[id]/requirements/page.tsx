import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { canWrite } from '@/lib/auth/guard';
import { requirePageSession } from '@/lib/auth/page-guard';
import { isAiConfigured } from '@/lib/env';
import { PageHeader } from '@/components/layout/page-header';
import { RequirementsPanel, type RequirementRow } from '@/components/compliance/requirements-panel';
import type { PickableDocument } from '@/components/compliance/document-picker';

export const metadata: Metadata = { title: 'Требования закупки' };

export default async function RequirementsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requirePageSession();
  const { id } = await params;

  const tender = await prisma.tender.findFirst({
    where: { id, companyId: session.companyId },
    include: {
      requirements: {
        orderBy: [{ isMandatory: 'desc' }, { createdAt: 'asc' }],
        include: { document: { select: { originalName: true } } },
      },
      documents: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        include: {
          extraction: {
            select: { status: true, charCount: true, unreadablePages: true },
          },
        },
      },
    },
  });

  if (!tender) notFound();

  const requirements: RequirementRow[] = tender.requirements.map((req) => ({
    id: req.id,
    label: req.label,
    text: req.text,
    category: req.category,
    isMandatory: req.isMandatory,
    pageNumber: req.pageNumber,
    sourceQuote: req.sourceQuote,
    confirmedByUser: req.confirmedByUser,
    origin: req.origin,
    documentName: req.document?.originalName ?? null,
  }));

  // Для извлечения требований подходят документы закупки, а не наши документы.
  const sourceKinds = ['TECHNICAL_SPEC', 'TENDER_NOTICE', 'CONTRACT_DRAFT', 'OTHER'];
  const documents: PickableDocument[] = tender.documents
    .filter((d) => sourceKinds.includes(d.kind))
    .map((d) => ({
      id: d.id,
      originalName: d.originalName,
      kind: d.kind,
      extractionStatus: d.extraction?.status ?? null,
      charCount: d.extraction?.charCount ?? null,
      unreadablePagesCount: d.extraction?.unreadablePages.length ?? 0,
    }));

  return (
    <>
      <PageHeader
        title="Требования закупки"
        description={`${tender.title} · шаг 3 из 7`}
      />
      <div className="flex-1 px-5 py-5 sm:px-7">
        <RequirementsPanel
          tenderId={tender.id}
          requirements={requirements}
          documents={documents}
          aiConfigured={isAiConfigured()}
          canEdit={canWrite(session.role)}
        />
      </div>
    </>
  );
}
