import { readJson } from '@/lib/security/request';
/** Анализ проекта договора (Модуль №5). */

import { z } from 'zod';
import { dbTransaction, prisma } from '@/lib/db';
import { requireSession, requireWriteAccess } from '@/lib/auth/guard';
import { writeAudit } from '@/lib/audit';
import { clientIp, handleApiError, jsonError, jsonOk } from '@/lib/http';
import { analyzeContract } from '@/lib/ai/analyze';
import { AiNotConfiguredError, AiResponseError } from '@/lib/ai/client';
import { toSourceDocuments } from '@/lib/ai/to-source-documents';
import { PROMPT_VERSION } from '@/lib/ai/prompts';

type Params = { params: Promise<{ id: string }> };

const RunSchema = z.object({
  documentId: z.string().min(1, 'Укажите документ договора'),
});

export async function GET(_request: Request, { params }: Params) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const tender = await prisma.tender.findFirst({
      where: { id, companyId: session.companyId },
      select: { id: true },
    });
    if (!tender) return jsonError('Тендер не найден', 404);

    const analyses = await prisma.contractAnalysis.findMany({
      where: { tenderId: id },
      orderBy: { startedAt: 'desc' },
      include: {
        risks: { orderBy: [{ riskLevel: 'asc' }, { createdAt: 'asc' }] },
        document: { select: { originalName: true } },
      },
    });
    return jsonOk(
      analyses.map((a) => ({
        ...a,
        risks: a.risks.map((r) => ({
          ...r,
          financialImpactMinor:
            r.financialImpactMinor === null
              ? null
              : Number(r.financialImpactMinor),
        })),
      })),
    );
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const session = await requireWriteAccess();
    const { id } = await params;
    const body = RunSchema.parse(await readJson(request));

    const document = await prisma.document.findFirst({
      where: {
        id: body.documentId,
        tenderId: id,
        companyId: session.companyId,
        deletedAt: null,
      },
      select: {
        id: true,
        originalName: true,
        extraction: {
          select: { status: true, text: true, unreadablePages: true },
        },
      },
    });
    if (!document) return jsonError('Документ договора не найден', 404);

    const [sourceDocument] = toSourceDocuments([document]);
    if (!sourceDocument) return jsonError('Документ договора не найден', 404);

    const analysis = await prisma.contractAnalysis.create({
      data: {
        tenderId: id,
        documentId: document.id,
        status: 'RUNNING',
        promptVersion: PROMPT_VERSION,
      },
    });

    try {
      const { risks, terms, meta } = await analyzeContract({
        document: sourceDocument,
        signal: request.signal,
      });

      await dbTransaction(async (tx) => {
        await tx.contractRisk.createMany({
          data: risks.map((risk) => ({
            analysisId: analysis.id,
            category: risk.category,
            title: risk.title,
            clauseRef: risk.clauseRef,
            pageNumber: risk.pageNumber,
            sourceQuote: risk.quoteVerified
              ? risk.sourceQuote
              : `${risk.sourceQuote} [цитата не найдена в тексте документа — проверьте вручную]`,
            riskLevel: risk.riskLevel,
            explanation: risk.explanation,
            recommendation: risk.recommendation,
            needsLawyerReview: risk.needsLawyerReview,
            financeHint: (risk.financeHint ?? {}) as object,
          })),
        });
        await tx.contractAnalysis.update({
          where: { id: analysis.id },
          data: {
            status: 'SUCCEEDED',
            finishedAt: new Date(),
            aiModel: meta.model,
            extractedTerms: terms as unknown as object,
            tokenUsage: { ...meta.tokenUsage, provider: meta.provider, modelDigest: meta.modelDigest, limitations: meta.limitations, adjustedCount: meta.adjustedCount } as unknown as object,
          },
        });
      });

      await writeAudit({
        companyId: session.companyId,
        userId: session.userId,
        action: 'AI_CONTRACT_RUN',
        entity: 'ContractAnalysis',
        entityId: analysis.id,
        ipAddress: clientIp(request),
        metadata: {
          tenderId: id,
          risks: risks.length,
          unverifiedQuotes: risks.filter((r) => !r.quoteVerified).length,
          model: meta.model,
          promptVersion: meta.promptVersion,
          provider: meta.provider,
          modelDigest: meta.modelDigest,
          limitationCount: meta.limitations.length,
          tokenUsage: meta.tokenUsage,
        },
      });

      return jsonOk({
        analysisId: analysis.id,
        risks: risks.length,
        unverifiedQuotes: risks.filter((r) => !r.quoteVerified).length,
        needsLawyerReview: risks.filter((r) => r.needsLawyerReview).length,
        terms,
        limitations: meta.limitations,
      });
    } catch (error) {
      const message = (error as Error).message;
      await prisma.contractAnalysis.update({
        where: { id: analysis.id },
        data: { status: 'FAILED', finishedAt: new Date(), error: message },
      });
      if (error instanceof AiNotConfiguredError) {
        return jsonError(error.message, 503);
      }
      if (error instanceof AiResponseError) {
        return jsonError(error.message, 502);
      }
      throw error;
    }
  } catch (error) {
    return handleApiError(error);
  }
}
