import { createHash } from 'node:crypto';
import { prisma } from '../db';
import { buildTaxContext } from './tax-config';
import { toRateDefinitions } from './from-db';
import type { FinanceInput } from './types';

export async function getCompanyTaxRates(companyId: string, at = new Date()) {
  const [rows, overrides] = await Promise.all([prisma.taxRateConfig.findMany({
    where: { effectiveFrom: { lte: at }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date(at.toISOString().slice(0,10)) } }] },
    orderBy: { effectiveFrom: 'desc' },
  }), prisma.companyTaxRate.findMany({ where: { companyId } })]);
  // Query the tenant model directly so its RLS transaction is initialized.
  // A nested relation on the global taxRateConfig model bypasses that hook.
  const byRate = new Map(overrides.map(override => [override.rateId, override]));
  const seen = new Set<string>();
  return rows.filter(r => { if (seen.has(r.key)) return false; seen.add(r.key); return true; })
    .map(r => ({ ...r, ratePercent: byRate.get(r.id)?.ratePercent ?? r.ratePercent,
      notes: byRate.has(r.id) ? `${r.notes ?? ''} USER_CONFIRMED: ставка компании; не подтверждение нормы.` : r.notes,
      updatedAt: byRate.get(r.id)?.updatedAt ?? r.updatedAt }));
}

export async function canonicalFinanceInput(companyId: string, input: FinanceInput): Promise<FinanceInput> {
  const [company, rows] = await Promise.all([
    prisma.company.findUniqueOrThrow({ where: { id: companyId } }), getCompanyTaxRates(companyId),
  ]);
  const rates = toRateDefinitions(rows);
  const version = 'company-tax:' + createHash('sha256').update(JSON.stringify(rates)).digest('hex').slice(0,24);
  return { ...input, tax: buildTaxContext({ regime: company.taxRegime, isVatPayer: company.isVatPayer,
    rates, configVersion: version, vatRecoverySharePercent: input.tax.vatRecoverySharePercent }) };
}
