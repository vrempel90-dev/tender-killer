import { readJson } from '@/lib/security/request';
/**
 * Извлечение требований закупки из загруженных документов (AI)
 * и ручное управление списком требований.
 */

import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireSession, requireWriteAccess } from '@/lib/auth/guard';
import { writeAudit } from '@/lib/audit';
import { clientIp, handleApiError, jsonError, jsonOk } from '@/lib/http';
import { extractRequirements } from '@/lib/ai/analyze';
import { AiNotConfiguredError, AiResponseError } from '@/lib/ai/client';
import { toSourceDocuments } from '@/lib/ai/to-source-documents';

type Params = { params: Promise<{ id: string }> };

const ExtractSchema = z.object({
  /** Документы, из которых извлекать требования. */
  documentIds: z.array(z.string()).min(1, 'Выберите хотя бы один документ'),
  /** Удалить ранее извлечённые AI-требования перед записью новых. */
  replaceExisting: z.boolean().optional().default(false),
});

const UpdateSchema = z.object({
  requirementId: z.string(),
  confirmedByUser: z.boolean().optional(),
  text: z.string().min(3).max(4000).optional(),
  label: z.string().min(1).max(300).optional(),
  isMandatory: z.boolean().optional(),
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

    const requirements = await prisma.requirement.findMany({
      where: { tenderId: id },
      orderBy: [{ category: 'asc' }, { createdAt: 'asc' }],
      include: { document: { select: { originalName: true } } },
    });
    return jsonOk(requirements);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const session = await requireWriteAccess();
    const { id } = await params;
    const body = ExtractSchema.parse(await readJson(request));

    const tender = await prisma.tender.findFirst({
      where: { id, companyId: session.companyId },
      select: { id: true },
    });
    if (!tender) return jsonError('Тендер не найден', 404);

    // Документы берём только из этого тендера и этой компании.
    const documents = await prisma.document.findMany({
      where: {
        id: { in: body.documentIds },
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
    if (documents.length === 0) {
      return jsonError('Выбранные документы не найдены', 404);
    }

    try {
      const { requirements, meta } = await extractRequirements({
        documents: toSourceDocuments(documents),
        signal: request.signal,
      });

      if (body.replaceExisting) {
        // Удаляем только то, что извлёк AI: ручные требования пользователя
        // не затрагиваем.
        await prisma.requirement.deleteMany({
          where: { tenderId: id, origin: 'AI', confirmedByUser: false },
        });
      }

      await prisma.requirement.createMany({
        data: requirements.map((req) => ({
          tenderId: id,
          documentId: req.documentId,
          category: req.category,
          text: req.text,
          label: req.label,
          pageNumber: req.pageNumber,
          sourceQuote: req.quoteVerified ? req.sourceQuote : `${req.sourceQuote} [Требует ручной проверки: ${req.verificationNote}]`,
          isMandatory: req.isMandatory,
          confirmedByUser: false,
          origin: 'AI',
        })),
      });

      await writeAudit({
        companyId: session.companyId,
        userId: session.userId,
        action: 'AI_REQUIREMENTS_RUN',
        entity: 'Tender',
        entityId: id,
        ipAddress: clientIp(request),
        metadata: {
          extracted: requirements.length,
          unverifiedQuotes: requirements.filter((r) => !r.quoteVerified).length,
          model: meta.model,
          provider: meta.provider,
          modelDigest: meta.modelDigest,
          limitations: meta.limitations,
          promptVersion: meta.promptVersion,
          tokenUsage: meta.tokenUsage,
        },
      });

      return jsonOk({
        extracted: requirements.length,
        unverifiedQuotes: requirements.filter((r) => !r.quoteVerified).length,
        limitations: meta.limitations,
        model: meta.model,
      });
    } catch (error) {
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

export async function PATCH(request: Request, { params }: Params) {
  try {
    const session = await requireWriteAccess();
    const { id } = await params;
    const data = UpdateSchema.parse(await readJson(request));

    // Требование должно принадлежать тендеру этой компании.
    const requirement = await prisma.requirement.findFirst({
      where: {
        id: data.requirementId,
        tenderId: id,
        tender: { companyId: session.companyId },
      },
      select: { id: true },
    });
    if (!requirement) return jsonError('Требование не найдено', 404);

    await prisma.requirement.update({
      where: { id: data.requirementId },
      data: {
        ...(data.confirmedByUser !== undefined
          ? { confirmedByUser: data.confirmedByUser }
          : {}),
        ...(data.text !== undefined ? { text: data.text } : {}),
        ...(data.label !== undefined ? { label: data.label } : {}),
        ...(data.isMandatory !== undefined
          ? { isMandatory: data.isMandatory }
          : {}),
      },
    });

    return jsonOk({ updated: true });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const session = await requireWriteAccess();
    const { id } = await params;
    const url = new URL(request.url);
    const requirementId = url.searchParams.get('requirementId');
    if (!requirementId) return jsonError('Не указано требование', 400);

    const requirement = await prisma.requirement.findFirst({
      where: {
        id: requirementId,
        tenderId: id,
        tender: { companyId: session.companyId },
      },
      select: { id: true },
    });
    if (!requirement) return jsonError('Требование не найдено', 404);

    await prisma.requirement.delete({ where: { id: requirementId } });
    return jsonOk({ deleted: true });
  } catch (error) {
    return handleApiError(error);
  }
}
