import { requireRole } from '@/lib/auth/guard';
import { readJson } from '@/lib/security/request';
import { consumeQuota } from '@/lib/security/quota';
import { handleApiError, jsonError, jsonOk } from '@/lib/http';
import { AiNotConfiguredError, AiResponseError } from '@/lib/ai/client';
import { aiSummary, testAiConnection } from '@/lib/ai/status';

export async function GET() {
  try { await requireRole('ADMIN'); return jsonOk(aiSummary()); }
  catch (error) {
    if (error instanceof AiNotConfiguredError) return jsonError(error.message, 503);
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireRole('ADMIN');
    // Validate Origin, media type and size. User input never configures a URL/provider.
    const input = await readJson(request);
    if (!input || typeof input !== 'object' || Object.keys(input).length !== 0) return jsonError('Параметры AI меняются только в серверной конфигурации администратором инфраструктуры.', 422);
    await consumeQuota('ai-health-check', session.companyId, 5, 60);
    return jsonOk(await testAiConnection(request.signal));
  } catch (error) {
    if (error instanceof AiNotConfiguredError || error instanceof AiResponseError) return jsonError(error.message, 503);
    return handleApiError(error);
  }
}
