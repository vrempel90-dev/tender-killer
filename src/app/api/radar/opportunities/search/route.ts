/**
 * TENDER RADAR: поиск по импортированным объявлениям.
 *
 * Метод POST, а не GET, потому что фильтров много и они вложенные: то же
 * тело принимает сохранённый поиск. Ответ не кэшируется (см. jsonOk).
 *
 * Оценка соответствия считается в приложении объяснимыми правилами
 * (src/lib/radar/match.ts), поэтому фильтры по ней применяются после
 * выборки из БД, а не в SQL: дублировать это правило в двух местах значило
 * бы однажды их разойтись.
 */

import { prisma } from '@/lib/db';
import { requireSession } from '@/lib/auth/guard';
import { handleApiError, jsonOk } from '@/lib/http';
import { readJson } from '@/lib/security/request';
import { consumeQuota } from '@/lib/security/quota';
import { buildOrderBy, buildWhere, parseFilters } from '@/lib/radar/filters';
import { matchOpportunity, scoreLabel } from '@/lib/radar/match';
import { toMatchProfile } from '@/lib/radar/profile';

/**
 * Предел выборки из БД до применения фильтров по профилю. Без предела
 * большой импорт превратил бы поиск в полное сканирование с расчётом
 * оценки по каждой записи.
 */
const SCAN_LIMIT = 2000;
const PAGE_SIZE = 50;

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    await consumeQuota('radar-search', session.companyId, 240, 60);

    const body = await readJson(request);
    const payload = (body ?? {}) as Record<string, unknown>;
    const filters = parseFilters(payload.filters ?? {});
    const page = Math.max(
      1,
      Math.min(100, Number.parseInt(String(payload.page ?? '1'), 10) || 1),
    );

    const now = new Date();
    const [profileRow, rows, total] = await Promise.all([
      prisma.companyProfile.findUnique({ where: { companyId: session.companyId } }),
      prisma.procurementOpportunity.findMany({
        where: buildWhere(session.companyId, filters, now),
        orderBy: buildOrderBy(filters),
        take: SCAN_LIMIT,
        include: {
          import: {
            select: {
              id: true,
              sourceName: true,
              sourceUrl: true,
              fileName: true,
              actualAt: true,
              importedAt: true,
            },
          },
          tender: { select: { id: true, stage: true } },
        },
      }),
      prisma.procurementOpportunity.count({
        where: buildWhere(session.companyId, filters, now),
      }),
    ]);

    const profile = toMatchProfile(profileRow);

    const evaluated = rows.map((row) => {
      const match = matchOpportunity(
        profile,
        {
          title: row.title,
          customerBin: row.customerBin,
          priceMinor: row.priceMinor === null ? null : Number(row.priceMinor),
          procurementType: row.procurementType,
          region: row.region,
          deadline: row.deadline,
          deliveryDeadline: row.deliveryDeadline,
        },
        now,
      );
      return {
        id: row.id,
        externalId: row.externalId,
        title: row.title,
        customerName: row.customerName,
        customerBin: row.customerBin,
        price: row.priceMinor === null ? null : Number(row.priceMinor) / 100,
        currency: row.currency,
        procurementType: row.procurementType,
        region: row.region,
        deadline: row.deadline,
        deliveryDeadline: row.deliveryDeadline,
        sourceUrl: row.sourceUrl,
        // Источник и дата актуальности идут вместе с каждой записью:
        // пользователь должен видеть, откуда это и насколько свежо.
        source: {
          importId: row.import.id,
          name: row.import.sourceName,
          url: row.import.sourceUrl,
          fileName: row.import.fileName,
          actualAt: row.import.actualAt,
          importedAt: row.import.importedAt,
        },
        tender: row.tender,
        match: {
          score: match.score,
          label: scoreLabel(match.score),
          suitable: match.suitable,
          reasons: match.reasons,
          blockers: match.blockers,
          matchedKeywords: match.matchedKeywords,
        },
      };
    });

    const filtered = evaluated.filter((item) => {
      if (filters.onlySuitable && !item.match.suitable) return false;
      if (filters.minScore !== undefined && item.match.score < filters.minScore) {
        return false;
      }
      return true;
    });

    if (filters.sort === 'score' || filters.sort === undefined) {
      // Внутри одинаковой оценки раньше идут те, где срок ближе.
      filtered.sort((a, b) => {
        if (b.match.score !== a.match.score) return b.match.score - a.match.score;
        const left = a.deadline?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const right = b.deadline?.getTime() ?? Number.MAX_SAFE_INTEGER;
        return left - right;
      });
    }

    const offset = (page - 1) * PAGE_SIZE;

    return jsonOk({
      items: filtered.slice(offset, offset + PAGE_SIZE),
      page,
      pageSize: PAGE_SIZE,
      /** Сколько записей прошло фильтры (включая фильтры по профилю). */
      matched: filtered.length,
      /** Сколько записей отобрала БД до фильтров по профилю. */
      scanned: rows.length,
      /** Всего записей под условием БД — может быть больше предела выборки. */
      total,
      truncated: total > rows.length,
      profileFilled: profileRow !== null,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
