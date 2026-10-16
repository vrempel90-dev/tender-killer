/**
 * Сборка входных данных финансовой модели из данных БД.
 * Используется и страницей расчёта, и генератором отчёта.
 */

import { createEmptyFinanceInput } from './defaults';
import { buildTaxContext, type TaxRateDefinition } from './tax-config';
import { FinanceInputSchema } from './schema';
import type { FinanceInput, TaxRegimeCode, VatMode } from './types';

/** Налоговые ставки из БД → формат конфигурации движка. */
export function toRateDefinitions(
  rows: Array<{
    key: string;
    label: string;
    ratePercent: unknown;
    sourceTitle: string;
    sourceUrl: string | null;
    effectiveFrom: Date;
    effectiveTo: Date | null;
    notes: string | null;
  }>,
): TaxRateDefinition[] {
  return rows.map((r) => ({
    key: r.key,
    label: r.label,
    ratePercent: Number(r.ratePercent),
    sourceTitle: r.sourceTitle,
    sourceUrl: r.sourceUrl,
    effectiveFrom: r.effectiveFrom.toISOString().slice(0, 10),
    effectiveTo: r.effectiveTo ? r.effectiveTo.toISOString().slice(0, 10) : null,
    notes: r.notes ?? undefined,
    needsVerification: (r.notes ?? '').includes('ТРЕБУЕТ СВЕРКИ'),
  }));
}

/**
 * Восстанавливает сохранённые входные данные.
 * Если сохранённая структура не проходит валидацию (например, модель создана
 * более старой версией), возвращается пустой ввод — молча «починить» данные
 * нельзя, иначе расчёт будет опираться на домыслы.
 */
export function parseSavedInput(
  raw: unknown,
): { input: FinanceInput; valid: boolean } {
  const parsed = FinanceInputSchema.safeParse(raw);
  if (parsed.success) {
    return { input: parsed.data as FinanceInput, valid: true };
  }
  return { input: fallbackInput(), valid: false };
}

function fallbackInput(): FinanceInput {
  return createEmptyFinanceInput({ regime: 'GENERAL_VAT', isVatPayer: true });
}

/** Начальный ввод для нового расчёта по тендеру. */
export function buildInitialInput(params: {
  regime: TaxRegimeCode;
  isVatPayer: boolean;
  startPriceMinor: number | null;
  rates: TaxRateDefinition[];
  configVersion?: string;
  /** Позиции тендера с подтверждёнными закупочными ценами. */
  lineItems?: Array<{
    name: string;
    quantity: number;
    unitCostMinor: number | null;
    unit: string;
    verified: boolean;
    vatMode?: VatMode;
    supplierChargesVat?: boolean;
  }>;
}): FinanceInput {
  const base = createEmptyFinanceInput({
    regime: params.regime,
    isVatPayer: params.isVatPayer,
    startPriceMinor: params.startPriceMinor,
  });

  const tax = buildTaxContext({
    regime: params.regime,
    isVatPayer: params.isVatPayer,
    rates: params.rates,
    configVersion: params.configVersion,
  });

  const items = (params.lineItems ?? [])
    .filter((i) => i.unitCostMinor !== null && i.unitCostMinor > 0)
    .map((i) => ({
      label: i.name,
      quantity: i.quantity,
      unitCostMinor: i.unitCostMinor as number,
      unit: i.unit,
      vatMode: i.vatMode ?? 'INCLUSIVE',
      supplierChargesVat: i.supplierChargesVat ?? true,
      verified: i.verified,
    }));

  return {
    ...base,
    tax,
    costs: { ...base.costs, items, unpricedItems: (params.lineItems ?? []).filter(i => i.unitCostMinor === null || i.unitCostMinor <= 0).map(i => i.name) },
  };
}
