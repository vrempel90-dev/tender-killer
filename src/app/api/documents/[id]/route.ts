import { dbTransaction, prisma } from '@/lib/db';
import { requireSession, requireWriteAccess } from '@/lib/auth/guard';
import { writeAudit } from '@/lib/audit';
import { clientIp, handleApiError, jsonError, jsonOk } from '@/lib/http';
import { deleteStoredFile } from '@/lib/documents/storage';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const document = await prisma.document.findFirst({
      where: { id, companyId: session.companyId, deletedAt: null },
      include: { extraction: true },
    });
    if (!document) return jsonError('Документ не найден', 404);
    return jsonOk(document);
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * Удаление документа пользователя: файл стирается с диска,
 * запись помечается удалённой (для журнала), извлечённый текст удаляется.
 */
export async function DELETE(request: Request, { params }: Params) {
  try {
    const session = await requireWriteAccess();
    const { id } = await params;

    const document = await prisma.document.findFirst({
      where: { id, companyId: session.companyId, deletedAt: null },
      select: { id: true, storagePath: true, originalName: true, tenderId: true },
    });
    if (!document) return jsonError('Документ не найден', 404);

    await deleteStoredFile(document.storagePath);

    await dbTransaction(async (tx) => {
      await tx.documentExtraction.deleteMany({ where: { documentId: id } });
      await tx.document.update({
        where: { id },
        data: { deletedAt: new Date(), storagePath: '' },
      });
    });

    await writeAudit({
      companyId: session.companyId,
      userId: session.userId,
      action: 'DOCUMENT_DELETE',
      entity: 'Document',
      entityId: id,
      ipAddress: clientIp(request),
      metadata: {
        originalName: document.originalName,
        tenderId: document.tenderId,
      },
    });

    return jsonOk({ deleted: true });
  } catch (error) {
    return handleApiError(error);
  }
}
