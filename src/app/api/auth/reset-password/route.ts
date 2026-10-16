import { cookies } from 'next/headers';
import { completePasswordReset } from '@/lib/auth/password-reset';
import { ResetPasswordSchema } from '@/lib/auth/password-reset-policy';
import { SESSION_COOKIE } from '@/lib/auth/session';
import { consumeQuota } from '@/lib/security/quota';
import { readJson } from '@/lib/security/request';
import { clientIp, handleApiError, jsonOk } from '@/lib/http';

export async function POST(request: Request) {
  try {
    await consumeQuota('password-reset-global', 'complete', 300, 3600);
    await consumeQuota('password-reset-complete-ip', clientIp(request) ?? 'unknown', 30, 1800);
    const data = ResetPasswordSchema.parse(await readJson(request));
    await completePasswordReset(data.token, data.password);
    (await cookies()).delete(SESSION_COOKIE);
    return jsonOk({ message: 'Пароль успешно изменён. Теперь вы можете войти в аккаунт' });
  } catch (error) { return handleApiError(error); }
}
