import { z } from 'zod';
import { requireSession } from '@/lib/auth/guard';
import { regenerateRecoveryCodes } from '@/lib/auth/mfa/service';
import { writeAudit } from '@/lib/audit';
import { clientIp, handleApiError, jsonError, jsonOk } from '@/lib/http';
import { readJson } from '@/lib/security/request';
import { consumeQuota } from '@/lib/security/quota';

const Schema = z.object({ token: z.string().min(1).max(64) });

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    await consumeQuota('mfa-recovery', session.userId, 5, 3600);
    const { token } = Schema.parse(await readJson(request));

    const result = await regenerateRecoveryCodes({ userId: session.userId, token });
    if (result.error) {
      await writeAudit({
        companyId: session.companyId,
        userId: session.userId,
        action: 'MFA_VERIFY_FAILED',
        ipAddress: clientIp(request),
        metadata: { stage: 'recovery-codes' },
      });
      return jsonError(result.error, 400);
    }

    await writeAudit({
      companyId: session.companyId,
      userId: session.userId,
      action: 'MFA_RECOVERY_CODES_REISSUED',
      ipAddress: clientIp(request),
    });

    return jsonOk({ recoveryCodes: result.codes });
  } catch (error) {
    return handleApiError(error);
  }
}
