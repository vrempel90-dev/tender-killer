/**
 * Загрузка документа тендера.
 *
 * Проверяются: права, принадлежность тендера компании, тип и размер файла.
 * Файл сохраняется вне репозитория, в каталоге компании.
 * Извлечение текста запускается сразу, синхронно: пользователь должен сразу
 * видеть, прочитан документ или нет.
 */

import { prisma } from '@/lib/db';
import { requireWriteAccess } from '@/lib/auth/guard';
import { writeAudit } from '@/lib/audit';
import { clientIp, handleApiError, jsonError, jsonOk } from '@/lib/http';
import { extractDocument } from '@/lib/documents/extract';
import {
  buildStoragePath,
  deleteStoredFile,
  maxUploadBytes,
  saveFile,
  sha256,
  validateUpload,
} from '@/lib/documents/storage';

const DOCUMENT_KINDS = [
  'TECHNICAL_SPEC',
  'CONTRACT_DRAFT',
  'TENDER_NOTICE',
  'SUPPLIER_QUOTE',
  'PRICE_LIST',
  'OWN_CERTIFICATE',
  'OTHER',
] as const;

type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export async function POST(request: Request) {
  try {
    const session = await requireWriteAccess();

    const form = await request.formData();
    const file = form.get('file');
    const tenderId = form.get('tenderId');
    const kindRaw = String(form.get('kind') ?? 'OTHER');

    if (!(file instanceof File)) {
      return jsonError('Файл не передан', 400);
    }
    if (typeof tenderId !== 'string' || tenderId.length === 0) {
      return jsonError('Не указан тендер', 400);
    }
    const kind: DocumentKind = (DOCUMENT_KINDS as readonly string[]).includes(
      kindRaw,
    )
      ? (kindRaw as DocumentKind)
      : 'OTHER';

    // Тендер должен принадлежать компании из сессии.
    const tender = await prisma.tender.findFirst({
      where: { id: tenderId, companyId: session.companyId },
      select: { id: true },
    });
    if (!tender) return jsonError('Тендер не найден', 404);

    const validation = validateUpload({
      originalName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    });
    if (validation) {
      return jsonError(validation.message, 415, { code: validation.code });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    // Размер проверяем повторно по факту: заголовок можно подделать.
    if (buffer.byteLength > maxUploadBytes()) {
      return jsonError('Файл больше допустимого размера', 413);
    }

    const hash = sha256(buffer);

    // Дедупликация в пределах тендера: один и тот же файл не загружаем дважды.
    const duplicate = await prisma.document.findFirst({
      where: {
        companyId: session.companyId,
        tenderId,
        sha256: hash,
        deletedAt: null,
      },
      select: { id: true, originalName: true },
    });
    if (duplicate) {
      return jsonError(
        `Такой файл уже загружен: «${duplicate.originalName}»`,
        409,
        { documentId: duplicate.id },
      );
    }

    const storagePath = buildStoragePath(session.companyId, file.name);
    await saveFile(storagePath, buffer);

    let document;
    try {
      document = await prisma.document.create({
        data: {
          companyId: session.companyId,
          tenderId,
          kind,
          originalName: file.name,
          storagePath,
          mimeType: file.type,
          sizeBytes: buffer.byteLength,
          sha256: hash,
          uploadedById: session.userId,
          extraction: { create: { status: 'PROCESSING' } },
        },
        include: { extraction: true },
      });
    } catch (error) {
      // Если запись в БД не удалась, файл на диске оставлять нельзя.
      await deleteStoredFile(storagePath).catch(() => undefined);
      throw error;
    }

    await writeAudit({
      companyId: session.companyId,
      userId: session.userId,
      action: 'DOCUMENT_UPLOAD',
      entity: 'Document',
      entityId: document.id,
      ipAddress: clientIp(request),
      metadata: {
        tenderId,
        kind,
        sizeBytes: buffer.byteLength,
        sha256: hash,
      },
    });

    // ── Извлечение содержимого ──────────────────────────────────────────
    try {
      const outcome = await extractDocument({
        buffer,
        mimeType: file.type,
        originalName: file.name,
      });

      await prisma.documentExtraction.update({
        where: { documentId: document.id },
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
        entityId: document.id,
        metadata: {
          status: outcome.status,
          engine: outcome.engine,
          pageCount: outcome.pageCount,
          unreadablePages: outcome.unreadablePages.length,
          charCount: outcome.charCount,
        },
      });

      return jsonOk(
        {
          documentId: document.id,
          extraction: {
            status: outcome.status,
            engine: outcome.engine,
            pageCount: outcome.pageCount,
            unreadablePages: outcome.unreadablePages,
            charCount: outcome.charCount,
            warnings: outcome.warnings,
            tableCount: outcome.tables.length,
          },
        },
        201,
      );
    } catch (error) {
      // Файл загружен, но прочитать не удалось. Это не «документа нет»:
      // статус FAILED и текст ошибки сохраняются честно.
      const message = (error as Error).message;
      await prisma.documentExtraction.update({
        where: { documentId: document.id },
        data: {
          status: 'FAILED',
          warnings: [`Ошибка извлечения: ${message}`],
        },
      });
      return jsonOk(
        {
          documentId: document.id,
          extraction: {
            status: 'FAILED',
            warnings: [`Не удалось прочитать содержимое: ${message}`],
          },
        },
        201,
      );
    }
  } catch (error) {
    return handleApiError(error);
  }
}
