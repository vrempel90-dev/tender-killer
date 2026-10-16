import { requireWriteAccess } from '@/lib/auth/guard';
import { prisma } from '@/lib/db';
import { readJson } from '@/lib/security/request';
import { handleApiError, jsonError, jsonOk } from '@/lib/http';
import { interpretSources } from '@/lib/ai/semantic';
import { AiNotConfiguredError, AiResponseError } from '@/lib/ai/client';
import { writeAudit } from '@/lib/audit';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireWriteAccess();
    await readJson(request);
    const { id } = await params;
    const change = await prisma.watchChange.findFirst({ where: { id, watch: { companyId: session.companyId } },
      select: { fromSnapshot: { select: { specText: true } }, toSnapshot: { select: { specText: true } } } });
    if (!change) return jsonError('Изменение не найдено', 404);
    if (!change.fromSnapshot?.specText || !change.toSnapshot.specText) return jsonError('Текст обеих редакций недоступен. Требует ручной проверки.', 422);
    const result = await interpretSources({ kind: 'GUARD', first: change.fromSnapshot.specText, second: change.toSnapshot.specText, signal: request.signal });
    await writeAudit({ companyId: session.companyId, userId: session.userId, action: 'AI_SEMANTIC_RUN',
      entity: 'WatchChange', entityId: id, metadata: { kind: 'GUARD', model: result.model, provider: result.provider, modelDigest: result.modelDigest, promptVersion: result.promptVersion, classification: result.classification, quoteVerified: result.quoteVerified, tokenUsage: result.tokenUsage } });
    return jsonOk(result);
  } catch (error) {
    if (error instanceof AiNotConfiguredError || error instanceof AiResponseError) return jsonError(error.message, 503);
    return handleApiError(error);
  }
}
