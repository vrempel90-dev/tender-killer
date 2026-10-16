import { prisma } from '@/lib/db';
import { requireWriteAccess } from '@/lib/auth/guard';
import { writeAudit } from '@/lib/audit';
import { clientIp, handleApiError, jsonError, jsonOk } from '@/lib/http';

type Params = { params: Promise<{ id: string }> };

/**
 * Отметка «просмотрено». Изменение остаётся в истории: это основание для
 * решения, и удалять его нельзя.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const session = await requireWriteAccess();
    const { id } = await params;

    const change = await prisma.watchChange.findFirst({
      // Фильтр по компании через наблюдение: идентификатор пришёл от клиента.
      where: { id, watch: { companyId: session.companyId } },
      select: { id: true, acknowledgedAt: true, watchId: true, severity: true },
    });
    if (!change) return jsonError('Изменение не найдено', 404);
    if (change.acknowledgedAt !== null) {
      return jsonOk({ acknowledged: true, alreadyAcknowledged: true });
    }

    await prisma.watchChange.update({
      where: { id: change.id },
      data: { acknowledgedAt: new Date(), acknowledgedById: session.userId },
    });

    await writeAudit({
      companyId: session.companyId,
      userId: session.userId,
      action: 'WATCH_CHANGE_ACK',
      entity: 'WatchChange',
      entityId: change.id,
      ipAddress: clientIp(request),
      metadata: { watchId: change.watchId, severity: change.severity },
    });

    return jsonOk({ acknowledged: true });
  } catch (error) {
    return handleApiError(error);
  }
}
