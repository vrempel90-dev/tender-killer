import { createHash } from 'node:crypto';
import { prisma } from '../db';
import { buildTaxContext } from './tax-config';
import { toRateDefinitions } from './from-db';
import type { FinanceInput } from './types';

export async function getCompanyTaxRates(companyId: string, at = new Date()) {
  const rows = await prisma.taxRateConfig.findMany({
    where: { effectiveFrom: { lte: at }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date(at.toISOString().slice(0,10)) } }] },
    orderBy: { effectiveFrom: 'desc' },
    include: { companyOverrides: { where: { companyId } } },
  });
  const seen = new Set<string>();
  return rows.filter(r => { if (seen.has(r.key)) return false; seen.add(r.key); return true; })
    .map(r => ({ ...r, ratePercent: r.companyOverrides[0]?.ratePercent ?? r.ratePercent,
      notes: r.companyOverrides[0] ? `${r.notes ?? ''} USER_CONFIRMED: ставка компании; не подтверждение нормы.` : r.notes,
      updatedAt: r.companyOverrides[0]?.updatedAt ?? r.updatedAt }));
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
