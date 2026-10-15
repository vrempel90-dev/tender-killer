import { prisma } from '@/lib/db';
import { isAiConfigured } from '@/lib/env';

/**
 * Проверка готовности для Docker / Railway.
 * Не требует авторизации и не раскрывает данные компаний.
 */
export async function GET() {
  const checks: Record<string, string> = {};
  let healthy = true;

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = 'ok';
  } catch {
    checks.database = 'unavailable';
    healthy = false;
  }

  checks.ai = isAiConfigured() ? 'configured' : 'not_configured';

  return Response.json(
    { status: healthy ? 'ok' : 'degraded', checks },
    { status: healthy ? 200 : 503 },
  );
}
