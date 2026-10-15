import { z } from 'zod';

const minorFromMajor = z
  .number()
  .finite()
  .min(0)
  .max(1e13)
  .transform((major) => Math.round(major * 100));

export const TenderCreateSchema = z.object({
  title: z.string().min(3, 'Название должно быть не короче 3 символов').max(300),
  externalNumber: z.string().max(100).optional().or(z.literal('')),
  sourceUrl: z.url('Некорректная ссылка').optional().or(z.literal('')),
  customerName: z.string().max(300).optional().or(z.literal('')),
  customerBin: z
    .string()
    .regex(/^\d{12}$/, 'БИН состоит из 12 цифр')
    .optional()
    .or(z.literal('')),
  procurementType: z
    .enum([
      'OPEN_TENDER',
      'REQUEST_FOR_QUOTATIONS',
      'SINGLE_SOURCE',
      'AUCTION',
      'CORPORATE',
      'OTHER',
    ])
    .default('OPEN_TENDER'),
  /** Начальная цена вводится в тенге, хранится в тиын. */
  startPrice: minorFromMajor.nullable().optional(),
  submissionDeadline: z.iso.date().optional().or(z.literal('')),
  deliveryDeadline: z.iso.date().optional().or(z.literal('')),
  region: z.string().max(120).optional().or(z.literal('')),
  notes: z.string().max(5000).optional().or(z.literal('')),
});

export const TenderUpdateSchema = TenderCreateSchema.partial().extend({
  stage: z
    .enum([
      'DRAFT',
      'ANALYSIS',
      'DECIDED_GO',
      'DECIDED_NO_GO',
      'SUBMITTED',
      'WON',
      'LOST',
      'ARCHIVED',
    ])
    .optional(),
});

export type TenderCreateInput = z.infer<typeof TenderCreateSchema>;

/** Пустая строка → null, чтобы в БД не попадали пустые значения. */
export function emptyToNull(value: string | undefined | null): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function dateOrNull(value: string | undefined | null): Date | null {
  const v = emptyToNull(value ?? null);
  if (!v) return null;
  const date = new Date(`${v}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}
