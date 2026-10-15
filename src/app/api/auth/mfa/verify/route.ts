import { z } from 'zod';
import { requirePartialSession } from '@/lib/auth/guard';
import { markSessionMfaVerified, verifyMfa } from '@/lib/auth/mfa/service';
import { writeAudit } from '@/lib/audit';
import { clientIp, handleApiError, jsonError, jsonOk } from '@/lib/http';
import { readJson } from '@/lib/security/request';
import { consumeQuota } from '@/lib/security/quota';

const Schema = z.object({ token: z.string().min(1).max(64) });

export async function POST(request: Request) {
  try {
    const session = await requirePartialSession();
    // Жёсткий лимит: 10 попыток за 15 минут на пользователя.
    await consumeQuota('mfa-verify', session.userId, 10, 900);
    const { token } = Schema.parse(await readJson(request));

    const result = await verifyMfa({ userId: session.userId, token });
    if (!result.valid) {
      await writeAudit({
        companyId: session.companyId,
        userId: session.userId,
        action: 'MFA_VERIFY_FAILED',
        ipAddress: clientIp(request),
        metadata: { stage: 'verify' },
      });
      return jsonError(result.error ?? 'Код не подошёл', 401);
    }

    await markSessionMfaVerified(session.sid);

    await writeAudit({
      companyId: session.companyId,
      userId: session.userId,
      action: result.kind === 'RECOVERY_CODE' ? 'MFA_RECOVERY_CODE_USED' : 'MFA_VERIFIED',
      ipAddress: clientIp(request),
      metadata: { recoveryCodesLeft: result.recoveryCodesLeft },
    });

    return jsonOk({
      kind: result.kind,
      recoveryCodesLeft: result.recoveryCodesLeft,
      next: '/dashboard',
    });
  } catch (error) {
    return handleApiError(error);
  }
}
