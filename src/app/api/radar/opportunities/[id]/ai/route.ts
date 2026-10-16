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
    const [opportunity, profile] = await Promise.all([
      prisma.procurementOpportunity.findFirst({ where: { id, companyId: session.companyId }, select: { title: true, procurementType: true, region: true } }),
      prisma.companyProfile.findUnique({ where: { companyId: session.companyId }, select: { keywords: true, excludedKeywords: true, notes: true, regions: true } }),
    ]);
    if (!opportunity) return jsonError('Закупка не найдена', 404);
    if (!profile) return jsonError('Заполните профиль компании', 422);
    const result = await interpretSources({ kind: 'RADAR', first: JSON.stringify(profile), second: JSON.stringify(opportunity), signal: request.signal });
    await writeAudit({ companyId: session.companyId, userId: session.userId, action: 'AI_SEMANTIC_RUN',
      entity: 'ProcurementOpportunity', entityId: id, metadata: { kind: 'RADAR', model: result.model, provider: result.provider, modelDigest: result.modelDigest, promptVersion: result.promptVersion, classification: result.classification, quoteVerified: result.quoteVerified, tokenUsage: result.tokenUsage } });
    return jsonOk(result);
  } catch (error) {
    if (error instanceof AiNotConfiguredError || error instanceof AiResponseError) return jsonError(error.message, 503);
    return handleApiError(error);
  }
}
