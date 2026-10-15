import { cookies } from 'next/headers';
import { getCurrentSession, revokeSession, SESSION_COOKIE } from '@/lib/auth/session';
import { writeAudit } from '@/lib/audit';
import { clientIp, handleApiError, jsonOk } from '@/lib/http';

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    if (session) {
      await revokeSession(session.sid);
      await writeAudit({
        companyId: session.companyId,
        userId: session.userId,
        action: 'USER_LOGOUT',
        ipAddress: clientIp(request),
      });
    }
    const store = await cookies();
    store.delete(SESSION_COOKIE);
    return jsonOk({ loggedOut: true });
  } catch (error) {
    return handleApiError(error);
  }
}
