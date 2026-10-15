import { mulMinor } from '../money';
import type { VatMode } from '../finance/types';

export interface SelectedPrice {
  unitPriceMinor: bigint | number;
  specMatch: string;
  quote: { currency: string; fxRate: unknown; pricesIncludeVat: boolean;
    supplierChargesVat?: boolean | null; valuesConfirmed?: boolean;
    verification: string; validUntil: Date | null; documentId: string | null };
}
/** A selected identifier alone is never evidence that a supplier price is usable. */
export function selectedPriceForFinance(selected: SelectedPrice | null, now = new Date()): {
  unitCostMinor: number | null; verified: boolean; vatMode: VatMode; supplierChargesVat: boolean;
} {
  const fallback = { unitCostMinor: null, verified: false, vatMode: 'INCLUSIVE' as VatMode, supplierChargesVat: false };
  if (!selected || selected.specMatch !== 'MATCH' || selected.quote.verification !== 'VERIFIED'
    || !selected.quote.documentId || selected.quote.valuesConfirmed !== true || typeof selected.quote.supplierChargesVat !== 'boolean'
    || (selected.quote.validUntil && selected.quote.validUntil.getTime() < now.getTime())) return fallback;
  const rate = selected.quote.currency === 'KZT' ? 1 : Number(selected.quote.fxRate ?? Number.NaN);
  if (!Number.isFinite(rate) || rate <= 0) return fallback;
  const amount = Number(selected.unitPriceMinor);
  if (!Number.isSafeInteger(amount) || amount <= 0) return fallback;
  return { unitCostMinor: mulMinor(amount, rate), verified: true,
    vatMode: selected.quote.pricesIncludeVat ? 'INCLUSIVE' : 'EXCLUSIVE', supplierChargesVat: selected.quote.supplierChargesVat };
}
