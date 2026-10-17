import { cookies } from 'next/headers';
import { z } from 'zod';
import { requirePartialSession } from '@/lib/auth/guard';
import { revokeAllSessions } from '@/lib/auth/account';
import { SESSION_COOKIE } from '@/lib/auth/session';
import { consumeQuota } from '@/lib/security/quota';
import { readJson } from '@/lib/security/request';
import { handleApiError, jsonOk } from '@/lib/http';

const Schema = z.object({ password: z.string().min(1).max(256) }).strict();
export async function POST(request: Request) {
  try {
    const session = await requirePartialSession();
    await consumeQuota('sessions-revoke', session.userId, 5, 900);
    const { password } = Schema.parse(await readJson(request));
    await revokeAllSessions(session, password);
    (await cookies()).delete(SESSION_COOKIE);
    return jsonOk({ revoked: true });
  } catch (error) { return handleApiError(error); }
}
