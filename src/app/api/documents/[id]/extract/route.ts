/** Повторное извлечение содержимого документа. */

import { prisma } from '@/lib/db';
import { requireWriteAccess } from '@/lib/auth/guard';
import { writeAudit } from '@/lib/audit';
import { handleApiError, jsonError, jsonOk } from '@/lib/http';
import { extractDocumentIsolated as extractDocument } from '@/lib/documents/isolated';
import { inspectDocumentBytes } from '@/lib/documents/inspect';
import { scanDocument } from '@/lib/documents/scanner';
import { consumeQuota, acquireParserLease } from '@/lib/security/quota';
import { readStoredFile } from '@/lib/documents/storage';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let release: (() => Promise<void>) | undefined;
  try {
    const session = await requireWriteAccess();
    release = await acquireParserLease(session.companyId);
    await consumeQuota('document-extract', session.companyId, 30, 3600);
    const { id } = await params;

    const document = await prisma.document.findFirst({
      where: { id, companyId: session.companyId, deletedAt: null },
      select: {
        id: true,
        storagePath: true,
        mimeType: true,
        originalName: true,
        sha256: true,
      },
    });
    if (!document || document.storagePath === '') {
      return jsonError('Документ не найден', 404);
    }

    await prisma.documentExtraction.upsert({
      where: { documentId: id },
      update: { status: 'PROCESSING' },
      create: { documentId: id, status: 'PROCESSING' },
    });

    try {
      // Сверка с контрольной суммой из БД: повреждённый или подменённый
      // файл не должен попасть в разбор как «документ пользователя».
      const buffer = await readStoredFile(document.storagePath, document.sha256);
      await inspectDocumentBytes(buffer, document.originalName);
      await scanDocument(buffer);
      const outcome = await extractDocument({
        buffer,
        mimeType: document.mimeType,
        originalName: document.originalName,
      });

      await prisma.documentExtraction.update({
        where: { documentId: id },
        data: {
          status: outcome.status,
          text: outcome.text,
          pageCount: outcome.pageCount,
          unreadablePages: outcome.unreadablePages,
          tables: outcome.tables as unknown as object,
          warnings: outcome.warnings,
          engine: outcome.engine,
          charCount: outcome.charCount,
        },
      });

      await writeAudit({
        companyId: session.companyId,
        userId: session.userId,
        action: 'DOCUMENT_EXTRACT',
        entity: 'Document',
        entityId: id,
        metadata: { status: outcome.status, charCount: outcome.charCount },
      });

      return jsonOk({
        status: outcome.status,
        pageCount: outcome.pageCount,
        unreadablePages: outcome.unreadablePages,
        charCount: outcome.charCount,
        warnings: outcome.warnings,
      });
    } catch (error) {
      const message = (error as Error).message;
      await prisma.documentExtraction.update({
        where: { documentId: id },
        data: { status: 'FAILED', warnings: [`Ошибка извлечения: ${message}`] },
      });
      return jsonError(`Не удалось прочитать содержимое: ${message}`, 422);
    }
  } catch (error) {
    return handleApiError(error);
  } finally {
    if (release) await release().catch(() => console.error(JSON.stringify({ event: "parser_lease_release_failed" })));
  }
}
