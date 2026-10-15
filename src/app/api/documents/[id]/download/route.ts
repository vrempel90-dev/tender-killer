/**
 * Выдача загруженного файла. Доступ только к документам своей компании:
 * проверка идёт по БД, а не по пути в запросе.
 */

import { prisma } from '@/lib/db';
import { requireSession } from '@/lib/auth/guard';
import { handleApiError, jsonError } from '@/lib/http';
import { readStoredFile } from '@/lib/documents/storage';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession();
    const { id } = await params;

    const document = await prisma.document.findFirst({
      where: { id, companyId: session.companyId, deletedAt: null },
      select: { storagePath: true, mimeType: true, originalName: true },
    });
    if (!document || document.storagePath === '') {
      return jsonError('Документ не найден', 404);
    }

    const buffer = await readStoredFile(document.storagePath);

    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': document.mimeType,
        // attachment: файл не исполняется в браузере
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(document.originalName)}`,
        'Content-Length': String(buffer.byteLength),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
