/**
 * Непросмотренные изменения — то, что в интерфейсе показывается как
 * уведомления. Внешней рассылки (почта, push) нет: инфраструктуры для неё
 * в системе нет, и обещать её нельзя. См. docs/tender-guard.md.
 */

import { prisma } from '@/lib/db';
import { requireSession } from '@/lib/auth/guard';
import { handleApiError, jsonOk } from '@/lib/http';

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const url = new URL(request.url);
    const onlyPending = url.searchParams.get('pending') !== 'false';

    const changes = await prisma.watchChange.findMany({
      where: {
        watch: { companyId: session.companyId },
        ...(onlyPending ? { acknowledgedAt: null } : {}),
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 200,
      select: {
        id: true,
        kind: true,
        severity: true,
        summary: true,
        detail: true,
        requiresRecalc: true,
        financialImpact: true,
        acknowledgedAt: true,
        createdAt: true,
        watch: {
          select: {
            id: true,
            tenderId: true,
            tender: { select: { title: true, externalNumber: true } },
          },
        },
      },
    });

    return jsonOk({
      items: changes,
      pending: changes.filter((change) => change.acknowledgedAt === null).length,
      critical: changes.filter(
        (change) => change.severity === 'CRITICAL' && change.acknowledgedAt === null,
      ).length,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
