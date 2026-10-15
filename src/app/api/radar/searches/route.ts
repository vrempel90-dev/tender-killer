/**
 * Сохранённые поиски: набор фильтров под именем.
 *
 * Фильтры проверяются схемой и при сохранении, и при применении: между
 * этими моментами правила могли измениться, и доверять записанному в БД
 * JSON как заведомо корректному нельзя.
 */

import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireSession, requireWriteAccess } from '@/lib/auth/guard';
import { writeAudit } from '@/lib/audit';
import { clientIp, handleApiError, jsonError, jsonOk } from '@/lib/http';
import { readJson } from '@/lib/security/request';
import { describeFilters, parseFilters, SearchFiltersSchema } from '@/lib/radar/filters';

const CreateSchema = z.object({
  name: z.string().trim().min(2, 'Укажите название поиска').max(100),
  filters: SearchFiltersSchema,
});

export async function GET() {
  try {
    const session = await requireSession();
    const searches = await prisma.savedSearch.findMany({
      where: { companyId: session.companyId },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });

    return jsonOk(
      searches.map((search) => {
        // Если сохранённый набор больше не проходит проверку (схема
        // изменилась), об этом говорится прямо, а не применяется молча.
        let filters = null;
        let invalid: string | null = null;
        try {
          filters = parseFilters(search.filters);
        } catch {
          invalid = 'Набор фильтров устарел и требует пересохранения';
        }
        return {
          id: search.id,
          name: search.name,
          filters,
          description: filters ? describeFilters(filters) : null,
          invalid,
          lastRunAt: search.lastRunAt,
          updatedAt: search.updatedAt,
        };
      }),
    );
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireWriteAccess();
    const data = CreateSchema.parse(await readJson(request));

    const existing = await prisma.savedSearch.findFirst({
      where: { companyId: session.companyId, name: data.name },
      select: { id: true },
    });

    const saved = existing
      ? await prisma.savedSearch.update({
        where: { id: existing.id },
        data: { filters: data.filters, lastRunAt: new Date() },
      })
      : await prisma.savedSearch.create({
        data: {
          companyId: session.companyId,
          name: data.name,
          filters: data.filters,
          createdById: session.userId,
          lastRunAt: new Date(),
        },
      });

    await writeAudit({
      companyId: session.companyId,
      userId: session.userId,
      action: 'SAVED_SEARCH_CREATE',
      entity: 'SavedSearch',
      entityId: saved.id,
      ipAddress: clientIp(request),
      metadata: { name: saved.name, replaced: existing !== null },
    });

    return jsonOk(
      {
        id: saved.id,
        name: saved.name,
        description: describeFilters(data.filters),
        replaced: existing !== null,
      },
      existing ? 200 : 201,
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      return jsonError('Поиск с таким названием уже есть', 409);
    }
    return handleApiError(error);
  }
}
