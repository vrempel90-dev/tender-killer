import { prisma } from '@/lib/db';
import { requireWriteAccess } from '@/lib/auth/guard';
import { writeAudit } from '@/lib/audit';
import { clientIp, handleApiError, jsonError, jsonOk } from '@/lib/http';

type Params = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, { params }: Params) {
  try {
    const session = await requireWriteAccess();
    const { id } = await params;

    // Фильтр по компании: идентификатор пришёл от клиента.
    const search = await prisma.savedSearch.findFirst({
      where: { id, companyId: session.companyId },
      select: { id: true, name: true },
    });
    if (!search) return jsonError('Поиск не найден', 404);

    await prisma.savedSearch.delete({ where: { id: search.id } });

    await writeAudit({
      companyId: session.companyId,
      userId: session.userId,
      action: 'SAVED_SEARCH_DELETE',
      entity: 'SavedSearch',
      entityId: search.id,
      ipAddress: clientIp(request),
      metadata: { name: search.name },
    });

    return jsonOk({ deleted: true });
  } catch (error) {
    return handleApiError(error);
  }
}
