/**
 * Профиль возможностей компании: что она поставляет, где и на какие суммы.
 *
 * Профиль — это то, с чем сопоставляются закупки. Он заполняется
 * пользователем и никогда не выводится «автоматически из истории»: догадка
 * о профиле компании привела бы к тому, что часть подходящих закупок
 * молча исчезала бы из поиска.
 */

import { z } from 'zod';
import { toMinor } from '../money';
import { PROCUREMENT_TYPES, type ProcurementTypeValue } from './filters';
import type { MatchProfile } from './match';

const phrase = z.string().trim().min(2, 'Слишком короткое значение').max(120);

export const ProfileSchema = z.object({
  keywords: z.array(phrase).max(100).default([]),
  excludedKeywords: z.array(phrase).max(100).default([]),
  regions: z.array(phrase).max(30).default([]),
  procurementTypes: z.array(z.enum(PROCUREMENT_TYPES)).max(6).default([]),
  /** Границы в тенге: так их вводит человек. В БД хранятся тиын. */
  minPrice: z.number().finite().min(0).max(1e12).nullable().default(null),
  maxPrice: z.number().finite().min(0).max(1e12).nullable().default(null),
  minDeliveryDays: z.number().int().min(0).max(3650).nullable().default(null),
  excludedCustomerBins: z
    .array(z.string().regex(/^\d{12}$/, 'БИН состоит из 12 цифр'))
    .max(200)
    .default([]),
  preferredCustomerBins: z
    .array(z.string().regex(/^\d{12}$/, 'БИН состоит из 12 цифр'))
    .max(200)
    .default([]),
  minDaysToDeadline: z.number().int().min(0).max(365).nullable().default(null),
  notes: z.string().trim().max(2000).nullable().default(null),
}).strict().refine(
  (value) =>
    value.minPrice === null
    || value.maxPrice === null
    || value.minPrice <= value.maxPrice,
  { message: 'Минимальная сумма больше максимальной', path: ['minPrice'] },
);

export type ProfileInput = z.infer<typeof ProfileSchema>;

/** Хранимый вид профиля (деньги — в тиын). */
export interface StoredProfile {
  keywords: string[];
  excludedKeywords: string[];
  regions: string[];
  procurementTypes: ProcurementTypeValue[];
  minPriceMinor: bigint | null;
  maxPriceMinor: bigint | null;
  minDeliveryDays: number | null;
  excludedCustomerBins: string[];
  preferredCustomerBins: string[];
  minDaysToDeadline: number | null;
  notes: string | null;
}

export function toStoredProfile(input: ProfileInput): StoredProfile {
  return {
    keywords: dedupe(input.keywords),
    excludedKeywords: dedupe(input.excludedKeywords),
    regions: dedupe(input.regions),
    procurementTypes: [...new Set(input.procurementTypes)],
    minPriceMinor: input.minPrice === null ? null : BigInt(toMinor(input.minPrice)),
    maxPriceMinor: input.maxPrice === null ? null : BigInt(toMinor(input.maxPrice)),
    minDeliveryDays: input.minDeliveryDays,
    excludedCustomerBins: [...new Set(input.excludedCustomerBins)],
    preferredCustomerBins: [...new Set(input.preferredCustomerBins)],
    minDaysToDeadline: input.minDaysToDeadline,
    notes: input.notes,
  };
}

/** Приводит хранимый профиль к виду, который понимает сопоставление. */
export function toMatchProfile(stored: StoredProfile | null): MatchProfile {
  return {
    keywords: stored?.keywords ?? [],
    excludedKeywords: stored?.excludedKeywords ?? [],
    regions: stored?.regions ?? [],
    procurementTypes: stored?.procurementTypes ?? [],
    minPriceMinor: stored?.minPriceMinor === null || stored?.minPriceMinor === undefined
      ? null
      : Number(stored.minPriceMinor),
    maxPriceMinor: stored?.maxPriceMinor === null || stored?.maxPriceMinor === undefined
      ? null
      : Number(stored.maxPriceMinor),
    minDeliveryDays: stored?.minDeliveryDays ?? null,
    excludedCustomerBins: stored?.excludedCustomerBins ?? [],
    preferredCustomerBins: stored?.preferredCustomerBins ?? [],
    minDaysToDeadline: stored?.minDaysToDeadline ?? null,
  };
}

/** Насколько профиль заполнен — показывается пользователю как подсказка. */
export function profileCompleteness(stored: StoredProfile | null): {
  filled: number;
  total: number;
  missing: string[];
} {
  const checks: Array<{ label: string; done: boolean }> = [
    { label: 'что поставляет компания', done: (stored?.keywords.length ?? 0) > 0 },
    { label: 'регионы поставки', done: (stored?.regions.length ?? 0) > 0 },
    {
      label: 'границы суммы договора',
      done: stored?.minPriceMinor !== null && stored?.minPriceMinor !== undefined
        || stored?.maxPriceMinor !== null && stored?.maxPriceMinor !== undefined,
    },
    { label: 'допустимые способы закупки', done: (stored?.procurementTypes.length ?? 0) > 0 },
    { label: 'срок на подготовку заявки', done: stored?.minDaysToDeadline !== null && stored?.minDaysToDeadline !== undefined },
  ];
  return {
    filled: checks.filter((c) => c.done).length,
    total: checks.length,
    missing: checks.filter((c) => !c.done).map((c) => c.label),
  };
}

/** Убирает повторы без учёта регистра, сохраняя написание пользователя. */
function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}
