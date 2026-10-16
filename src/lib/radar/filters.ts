/**
 * TENDER RADAR: фильтры поиска.
 *
 * Один и тот же разбор используется и в API, и в сохранённых поисках:
 * сохранённый поиск — это буквально эти фильтры под именем. Поэтому схема
 * задана один раз и проверяется при каждом применении, включая запуск
 * ранее сохранённого набора: с момента сохранения правила могли
 * измениться, и доверять записанному в БД JSON как валидному нельзя.
 */

import { z } from 'zod';
import { toMinor } from '../money';

export const PROCUREMENT_TYPES = [
  'OPEN_TENDER',
  'REQUEST_FOR_QUOTATIONS',
  'SINGLE_SOURCE',
  'AUCTION',
  'CORPORATE',
  'OTHER',
] as const;

export type ProcurementTypeValue = (typeof PROCUREMENT_TYPES)[number];

export const PROCUREMENT_TYPE_LABELS: Record<ProcurementTypeValue, string> = {
  OPEN_TENDER: 'Открытый конкурс',
  REQUEST_FOR_QUOTATIONS: 'Запрос ценовых предложений',
  SINGLE_SOURCE: 'Из одного источника',
  AUCTION: 'Аукцион',
  CORPORATE: 'Корпоративная закупка',
  OTHER: 'Иное',
};

/** Длина строки поиска ограничена: это защита от тяжёлых запросов. */
const text = z.string().trim().max(200);

export const SearchFiltersSchema = z.object({
  /** Поиск по наименованию и заказчику. */
  query: text.optional(),
  regions: z.array(text.min(1)).max(20).optional(),
  procurementTypes: z.array(z.enum(PROCUREMENT_TYPES)).max(6).optional(),
  customerBin: z.string().regex(/^\d{12}$/, 'БИН состоит из 12 цифр').optional(),
  /** Границы плановой суммы в тенге (не в тиын): так их вводит человек. */
  minPrice: z.number().finite().min(0).max(1e12).optional(),
  maxPrice: z.number().finite().min(0).max(1e12).optional(),
  deadlineFrom: z.string().datetime().optional(),
  deadlineTo: z.string().datetime().optional(),
  /** Только те, где приём заявок ещё не закончился. */
  onlyOpen: z.boolean().optional(),
  /** Только подходящие по профилю (без препятствий). */
  onlySuitable: z.boolean().optional(),
  /** Минимальная оценка соответствия, 0–100. */
  minScore: z.number().int().min(0).max(100).optional(),
  /** Только те, что ещё не переданы в финансовый модуль. */
  notTransferred: z.boolean().optional(),
  /** Ограничить одной партией импорта. */
  importId: z.string().min(1).max(64).optional(),
  sort: z.enum(['score', 'deadline', 'price', 'imported']).optional(),
}).strict();

export type SearchFilters = z.infer<typeof SearchFiltersSchema>;

/** Разбирает фильтры из произвольного значения (тело запроса или JSON из БД). */
export function parseFilters(input: unknown): SearchFilters {
  if (input === null || input === undefined) return {};
  return SearchFiltersSchema.parse(input);
}

export interface OpportunityWhere {
  companyId: string;
  importId?: string;
  customerBin?: string;
  tenderId?: null;
  procurementType?: { in: ProcurementTypeValue[] };
  priceMinor?: { gte?: bigint; lte?: bigint };
  deadline?: { gte?: Date; lte?: Date };
  OR?: Array<Record<string, unknown>>;
  AND?: Array<Record<string, unknown>>;
}

/**
 * Собирает условие выборки для БД.
 *
 * Фильтры, зависящие от профиля (соответствие и оценка), здесь не
 * применяются: они считаются в приложении по объяснимым правилам, и
 * переносить их в SQL значило бы дублировать логику в двух местах.
 */
export function buildWhere(
  companyId: string,
  filters: SearchFilters,
  now: Date = new Date(),
): OpportunityWhere {
  const where: OpportunityWhere = { companyId };

  if (filters.importId) where.importId = filters.importId;
  if (filters.customerBin) where.customerBin = filters.customerBin;
  if (filters.notTransferred) where.tenderId = null;
  if (filters.procurementTypes && filters.procurementTypes.length > 0) {
    where.procurementType = { in: filters.procurementTypes };
  }

  if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
    where.priceMinor = {};
    if (filters.minPrice !== undefined) {
      where.priceMinor.gte = BigInt(toMinor(filters.minPrice));
    }
    if (filters.maxPrice !== undefined) {
      where.priceMinor.lte = BigInt(toMinor(filters.maxPrice));
    }
  }

  const deadline: { gte?: Date; lte?: Date } = {};
  if (filters.onlyOpen) deadline.gte = now;
  if (filters.deadlineFrom) {
    const from = new Date(filters.deadlineFrom);
    // Если заданы оба условия, берём более позднюю нижнюю границу.
    deadline.gte = deadline.gte && deadline.gte > from ? deadline.gte : from;
  }
  if (filters.deadlineTo) deadline.lte = new Date(filters.deadlineTo);
  if (deadline.gte || deadline.lte) where.deadline = deadline;

  if (filters.query && filters.query.length > 0) {
    where.OR = [
      { title: { contains: filters.query, mode: 'insensitive' } },
      { customerName: { contains: filters.query, mode: 'insensitive' } },
      { externalId: { contains: filters.query, mode: 'insensitive' } },
    ];
  }

  if (filters.regions && filters.regions.length > 0) {
    // Регион в выгрузках пишут по-разному («Алматы», «г. Алматы»),
    // поэтому сравнение по вхождению, а не по равенству.
    where.AND = [
      {
        OR: filters.regions.map((region) => ({
          region: { contains: region, mode: 'insensitive' },
        })),
      },
    ];
  }

  return where;
}

/** Порядок выборки из БД. Сортировка по оценке выполняется в приложении. */
export function buildOrderBy(filters: SearchFilters) {
  switch (filters.sort) {
    case 'deadline':
      // Записи без срока уходят в конец: иначе они занимали бы начало списка.
      return [{ deadline: 'asc' as const }];
    case 'price':
      return [{ priceMinor: 'desc' as const }];
    case 'imported':
    case undefined:
    case 'score':
    default:
      return [{ createdAt: 'desc' as const }];
  }
}

/** Человекочитаемое описание набора фильтров — для списка сохранённых поисков. */
export function describeFilters(filters: SearchFilters): string {
  const parts: string[] = [];
  if (filters.query) parts.push(`«${filters.query}»`);
  if (filters.regions?.length) parts.push(`регионы: ${filters.regions.join(', ')}`);
  if (filters.procurementTypes?.length) {
    parts.push(
      `способы: ${filters.procurementTypes
        .map((type) => PROCUREMENT_TYPE_LABELS[type])
        .join(', ')}`,
    );
  }
  if (filters.customerBin) parts.push(`заказчик ${filters.customerBin}`);
  if (filters.minPrice !== undefined) parts.push(`от ${filters.minPrice} ₸`);
  if (filters.maxPrice !== undefined) parts.push(`до ${filters.maxPrice} ₸`);
  if (filters.onlyOpen) parts.push('приём не закончен');
  if (filters.onlySuitable) parts.push('без препятствий');
  if (filters.minScore !== undefined) parts.push(`оценка от ${filters.minScore}`);
  if (filters.notTransferred) parts.push('не переданы в расчёт');
  return parts.length > 0 ? parts.join(' · ') : 'без ограничений';
}
