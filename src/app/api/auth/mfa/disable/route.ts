import { z } from 'zod';
import { requireSession } from '@/lib/auth/guard';
import { disableMfa, getMfaStatus } from '@/lib/auth/mfa/service';
import { writeAudit } from '@/lib/audit';
import { clientIp, handleApiError, jsonError, jsonOk } from '@/lib/http';
import { readJson } from '@/lib/security/request';
import { consumeQuota } from '@/lib/security/quota';

const Schema = z.object({ token: z.string().min(1).max(64) });

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    await consumeQuota('mfa-disable', session.userId, 10, 900);
    const { token } = Schema.parse(await readJson(request));

    // Если фактор обязателен политикой компании, отключить его нельзя:
    // иначе требование обходится в один запрос.
    const status = await getMfaStatus(session.userId);
    if (status.required) {
      return jsonError(
        'Для вашей роли второй фактор обязателен. Отключение возможно только '
        + 'после изменения политики компании владельцем.',
        403,
      );
    }

    const result = await disableMfa({ userId: session.userId, token });
    if (!result.disabled) {
      await writeAudit({
        companyId: session.companyId,
        userId: session.userId,
        action: 'MFA_VERIFY_FAILED',
        ipAddress: clientIp(request),
        metadata: { stage: 'disable' },
      });
      return jsonError(result.error ?? 'Код не подошёл', 400);
    }

    await writeAudit({
      companyId: session.companyId,
      userId: session.userId,
      action: 'MFA_DISABLED',
      ipAddress: clientIp(request),
    });

    return jsonOk({ disabled: true });
  } catch (error) {
    return handleApiError(error);
  }
}
