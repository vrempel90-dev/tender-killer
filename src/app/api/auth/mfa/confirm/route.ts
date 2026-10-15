import { z } from 'zod';
import { requirePartialSession } from '@/lib/auth/guard';
import {
  confirmMfaEnrollment,
  markSessionMfaVerified,
} from '@/lib/auth/mfa/service';
import { writeAudit } from '@/lib/audit';
import { clientIp, handleApiError, jsonError, jsonOk } from '@/lib/http';
import { readJson } from '@/lib/security/request';
import { consumeQuota } from '@/lib/security/quota';

const Schema = z.object({ token: z.string().min(1).max(64) });

export async function POST(request: Request) {
  try {
    const session = await requirePartialSession();
    await consumeQuota('mfa-confirm', session.userId, 10, 900);
    const { token } = Schema.parse(await readJson(request));

    const result = await confirmMfaEnrollment({ userId: session.userId, token });
    if (!result.confirmed) {
      await writeAudit({
        companyId: session.companyId,
        userId: session.userId,
        action: 'MFA_VERIFY_FAILED',
        ipAddress: clientIp(request),
        metadata: { stage: 'confirm' },
      });
      return jsonError(result.error ?? 'Код не подошёл', 400);
    }

    // Сессия, подключившая фактор, сразу считается подтверждённой:
    // код из приложения уже предъявлен.
    await markSessionMfaVerified(session.sid);

    await writeAudit({
      companyId: session.companyId,
      userId: session.userId,
      action: 'MFA_ENABLED',
      ipAddress: clientIp(request),
    });

    return jsonOk({ recoveryCodes: result.recoveryCodes });
  } catch (error) {
    return handleApiError(error);
  }
}
