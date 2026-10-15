import { readJson } from '@/lib/security/request';
/** Запуск проверки документов заявки на соответствие требованиям. */

import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireSession, requireWriteAccess } from '@/lib/auth/guard';
import { writeAudit } from '@/lib/audit';
import { clientIp, handleApiError, jsonError, jsonOk } from '@/lib/http';
import { checkCompliance } from '@/lib/ai/analyze';
import { AiNotConfiguredError, AiResponseError } from '@/lib/ai/client';
import { toSourceDocuments } from '@/lib/ai/to-source-documents';
import { PROMPT_VERSION } from '@/lib/ai/prompts';

type Params = { params: Promise<{ id: string }> };

const RunSchema = z.object({
  /** Документы поставщика, которыми подтверждается соответствие. */
  supplierDocumentIds: z.array(z.string()).default([]),
  /** Проверять только подтверждённые пользователем требования. */
  onlyConfirmedRequirements: z.boolean().optional().default(true),
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

    const runs = await prisma.complianceRun.findMany({
      where: { tenderId: id },
      orderBy: { startedAt: 'desc' },
      include: {
        findings: {
          orderBy: [{ riskLevel: 'asc' }, { createdAt: 'asc' }],
          include: { document: { select: { originalName: true } } },
        },
      },
    });
    return jsonOk(runs);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const session = await requireWriteAccess();
    const { id } = await params;
    const body = RunSchema.parse(await readJson(request));

    const tender = await prisma.tender.findFirst({
      where: { id, companyId: session.companyId },
      select: { id: true },
    });
    if (!tender) return jsonError('Тендер не найден', 404);

    const requirements = await prisma.requirement.findMany({
      where: {
        tenderId: id,
        ...(body.onlyConfirmedRequirements ? { confirmedByUser: true } : {}),
      },
      select: {
        id: true,
        label: true,
        text: true,
        category: true,
        isMandatory: true,
      },
    });

    if (requirements.length === 0) {
      return jsonError(
        body.onlyConfirmedRequirements
          ? 'Нет подтверждённых требований. Извлеките требования и подтвердите '
            + 'их на странице требований — проверка идёт по подтверждённому списку.'
          : 'Нет требований для проверки.',
        422,
      );
    }

    const documents = await prisma.document.findMany({
      where: {
        id: { in: body.supplierDocumentIds },
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

    const run = await prisma.complianceRun.create({
      data: {
        tenderId: id,
        status: 'RUNNING',
        promptVersion: PROMPT_VERSION,
        analyzedDocumentIds: documents.map((d) => d.id),
        unreadableDocumentIds: documents
          .filter(
            (d) =>
              d.extraction === null ||
              d.extraction.status === 'FAILED' ||
              (d.extraction.text ?? '').length === 0,
          )
          .map((d) => d.id),
      },
    });

    try {
      const { findings, meta } = await checkCompliance({
        requirements: requirements.map((r) => ({
          ...r,
          // У требования может не быть короткого названия — тогда берём текст.
          label: r.label ?? r.text.slice(0, 120),
        })),
        supplierDocuments: toSourceDocuments(documents),
      });

      await prisma.$transaction([
        prisma.complianceFinding.createMany({
          data: findings.map((f) => ({
            runId: run.id,
            requirementId: f.requirementId,
            documentId: f.documentId,
            requirementText: f.requirementText,
            documentName: f.documentName,
            pageNumber: f.pageNumber,
            evidenceQuote: f.evidenceQuote,
            status: f.status,
            riskLevel: f.riskLevel,
            recommendation: f.recommendation,
            uncertaintyReason: f.adjustmentNote
              ? `${f.uncertaintyReason ?? ''}${f.uncertaintyReason ? ' ' : ''}(${f.adjustmentNote})`
              : f.uncertaintyReason,
          })),
        }),
        prisma.complianceRun.update({
          where: { id: run.id },
          data: {
            status: 'SUCCEEDED',
            finishedAt: new Date(),
            aiModel: meta.model,
            tokenUsage: meta.tokenUsage as unknown as object,
          },
        }),
      ]);

      await writeAudit({
        companyId: session.companyId,
        userId: session.userId,
        action: 'AI_COMPLIANCE_RUN',
        entity: 'ComplianceRun',
        entityId: run.id,
        ipAddress: clientIp(request),
        metadata: {
          tenderId: id,
          requirements: requirements.length,
          findings: findings.length,
          adjustedByVerification: meta.adjustedCount,
          model: meta.model,
          tokenUsage: meta.tokenUsage,
        },
      });

      const byStatus = findings.reduce<Record<string, number>>((acc, f) => {
        acc[f.status] = (acc[f.status] ?? 0) + 1;
        return acc;
      }, {});

      return jsonOk({
        runId: run.id,
        findings: findings.length,
        byStatus,
        adjustedByVerification: meta.adjustedCount,
        limitations: meta.limitations,
      });
    } catch (error) {
      const message = (error as Error).message;
      await prisma.complianceRun.update({
        where: { id: run.id },
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
