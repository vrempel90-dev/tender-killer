import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { canWrite, requireSession } from '@/lib/auth/guard';
import { maxUploadBytes } from '@/lib/documents/storage';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusNotice } from '@/components/ui/status-notice';
import { DocumentUploadForm } from '@/components/documents/upload-form';
import { DocumentList, type DocumentRow } from '@/components/documents/document-list';

export const metadata: Metadata = { title: 'Документы тендера' };

export default async function TenderDocumentsPage({
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
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        include: { extraction: true },
      },
    },
  });

  if (!tender) notFound();

  const rows: DocumentRow[] = tender.documents.map((doc) => ({
    id: doc.id,
    originalName: doc.originalName,
    kind: doc.kind,
    sizeBytes: doc.sizeBytes,
    createdAt: doc.createdAt.toISOString(),
    sha256: doc.sha256,
    extraction: doc.extraction
      ? {
          status: doc.extraction.status,
          pageCount: doc.extraction.pageCount,
          charCount: doc.extraction.charCount,
          unreadablePages: doc.extraction.unreadablePages,
          warnings: doc.extraction.warnings,
          engine: doc.extraction.engine,
        }
      : null,
  }));

  const partial = rows.filter(
    (r) => r.extraction?.status === 'PARTIAL' || r.extraction?.status === 'FAILED',
  );

  return (
    <>
      <PageHeader
        title="Документы тендера"
        description={tender.title}
      />
      <div className="flex-1 space-y-5 px-5 py-5 sm:px-7">
        {canWrite(session.role) ? (
          <Card>
            <CardHeader>
              <CardTitle>Загрузка документа</CardTitle>
              <CardDescription>
                Поддерживаются PDF, DOCX и XLSX. Текст извлекается сразу после
                загрузки: вы увидите, прочитано содержимое или нет. Распознавание
                сканов не выполняется — для таких страниц система честно
                сообщает, что текст не прочитан.
              </CardDescription>
            </CardHeader>
            <CardBody>
              <DocumentUploadForm
                tenderId={tender.id}
                maxMb={Math.round(maxUploadBytes() / 1_048_576)}
              />
            </CardBody>
          </Card>
        ) : (
          <StatusNotice severity="INFO">
            У вашей роли нет прав на загрузку и удаление документов.
          </StatusNotice>
        )}

        {partial.length > 0 ? (
          <StatusNotice severity="WARNING" title="Часть документов прочитана не полностью">
            {partial.length} документов содержат страницы без текстового слоя.
            Их содержимое не участвует в автоматической проверке — проверьте эти
            страницы вручную.
          </StatusNotice>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Загруженные документы ({rows.length})</CardTitle>
          </CardHeader>
          <CardBody>
            <DocumentList documents={rows} canEdit={canWrite(session.role)} />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
