import { after } from 'next/server';
import { ResetEmailSchema, RESET_MESSAGE } from '@/lib/auth/password-reset-policy';
import { issuePasswordReset } from '@/lib/auth/password-reset';
import { resetMailConfig } from '@/lib/email/transport';
import { consumeQuota } from '@/lib/security/quota';
import { readJson } from '@/lib/security/request';
import { clientIp, handleApiError, jsonOk } from '@/lib/http';

export const maxDuration = 30;
export async function POST(request: Request) {
  try {
    await consumeQuota('password-reset-global', 'send', 200, 3600);
    await consumeQuota('password-reset-ip', clientIp(request) ?? 'unknown', 10, 1800);
    const { email } = ResetEmailSchema.parse(await readJson(request));
    await consumeQuota('password-reset-account', email, 3, 1800);
    resetMailConfig();
    after(async () => {
      try { await issuePasswordReset(email); }
      catch { console.error(JSON.stringify({ event: 'password_reset_job_failed' })); }
    });
    return jsonOk({ message: RESET_MESSAGE });
  } catch (error) { return handleApiError(error); }
}
