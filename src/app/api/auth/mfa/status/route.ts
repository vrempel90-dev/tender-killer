import { requirePartialSession, sessionMfaGate } from '@/lib/auth/guard';
import { getMfaStatus } from '@/lib/auth/mfa/service';
import { handleApiError, jsonOk } from '@/lib/http';

export async function GET() {
  try {
    // Партиальная сессия: статус нужен именно тем, кто ещё не прошёл фактор.
    const session = await requirePartialSession();
    const status = await getMfaStatus(session.userId);
    return jsonOk({ ...status, gate: sessionMfaGate(session) });
  } catch (error) {
    return handleApiError(error);
  }
}
