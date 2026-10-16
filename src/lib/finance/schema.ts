/**
 * Валидация входных данных финансовой модели.
 * Данные приходят из браузера, поэтому проверяются на сервере до расчёта.
 */

import { z } from 'zod';

const money = z.number().int('Суммы хранятся в целых тиын').min(0).max(Number.MAX_SAFE_INTEGER).finite();
const moneyNullable = money.nullable();
const percent = z.number().min(0).max(1000).finite();
const days = z.number().int().min(0).max(36_500);
const daysNullable = days.nullable();

export const VatModeSchema = z.enum(['INCLUSIVE', 'EXCLUSIVE']);
export const TaxRegimeSchema = z.enum([
  'GENERAL_VAT',
  'GENERAL_NO_VAT',
  'SIMPLIFIED',
  'RETAIL_TAX',
  'INDIVIDUAL_ENTREPRENEUR',
]);
export const SecurityFormSchema = z.enum(['NONE', 'CASH_DEPOSIT', 'BANK_GUARANTEE']);

export const TaxContextSchema = z.object({
  regime: TaxRegimeSchema,
  isVatPayer: z.boolean(),
  vatRatePercent: percent,
  purchaseVatRatePercent: percent,
  vatRecoverySharePercent: z.number().min(0).max(100),
  incomeTaxRatePercent: percent,
  incomeTaxBase: z.enum(['PROFIT', 'TURNOVER']),
  payrollTaxPercent: percent,
  configVersion: z.string().min(1),
});

const SimpleCostLineSchema = z.object({
  label: z.string().min(1, 'Укажите название затраты').max(300),
  amountMinor: money.min(0),
  vatMode: VatModeSchema,
  supplierChargesVat: z.boolean(),
  verified: z.boolean(),
  prepaymentPercent: z.number().min(0).max(100).optional(),
  paymentDay: days.optional(),
});

const ItemCostLineSchema = z.object({
  label: z.string().min(1, 'Укажите наименование позиции').max(300),
  quantity: z.number().min(0).finite(),
  unitCostMinor: money.min(0),
  unit: z.string().max(32).optional(),
  vatMode: VatModeSchema,
  supplierChargesVat: z.boolean(),
  verified: z.boolean(),
  prepaymentPercent: z.number().min(0).max(100).optional(),
  paymentDay: days.optional(),
});

const SecuritySchema = z.object({
  form: SecurityFormSchema,
  percentOfBase: z.number().min(0).max(100).nullable(),
  amountMinor: moneyNullable,
  guaranteeFeePercentAnnual: percent,
  guaranteeFeeFixedMinor: money.min(0),
  heldDays: daysNullable,
});

export const FinanceInputSchema = z.object({
  tender: z.object({
    startPriceMinor: moneyNullable,
    bidPriceMinor: moneyNullable,
    bidPriceVatMode: VatModeSchema,
    startPriceVatMode: VatModeSchema,
    currency: z.string().length(3).default('KZT'),
  }),
  tax: TaxContextSchema,
  costs: z.object({
    unpricedItems: z.array(z.string().max(500)).max(1000).optional(),
    items: z.array(ItemCostLineSchema).max(1000),
    otherDirect: z.array(SimpleCostLineSchema).max(500),
    logistics: z.array(SimpleCostLineSchema).max(500),
    customs: z.object({
      isImport: z.boolean(),
      dutyMinor: money.min(0),
      importVatMinor: money.min(0),
      feesMinor: money.min(0),
      feesVatMode: VatModeSchema,
      feesSupplierChargesVat: z.boolean(),
    }),
    payroll: z.object({
      grossPayrollMinor: money.min(0),
      payrollTaxPercentOverride: percent.nullable(),
    }),
    subcontractors: z.array(SimpleCostLineSchema).max(500),
    overhead: z.array(SimpleCostLineSchema).max(500),
    contingencyPercent: z.number().min(0).max(100),
  }),
  financing: z.object({
    bankFeePercentOfRevenue: z.number().min(0).max(100),
    bankFeeFixedMinor: money.min(0),
    autoFinancePeakGap: z.boolean(),
    loanAmountMinor: moneyNullable,
    loanAnnualRatePercent: percent.nullable(),
    loanTermDays: daysNullable,
    ownCapitalOpportunityRatePercent: percent,
  }),
  securities: z.object({
    bid: SecuritySchema,
    performance: SecuritySchema,
  }),
  schedule: z.object({
    contractDurationDays: daysNullable,
    advancePercent: z.number().min(0).max(100),
    advanceDay: days,
    deliveryDay: daysNullable,
    paymentDelayDays: daysNullable,
    retentionPercent: z.number().min(0).max(100),
    retentionReleaseDays: daysNullable,
    procurementPrepaymentPercent: z.number().min(0).max(100),
    procurementStartDay: days,
  }),
  warranty: z.object({
    months: z.number().int().min(0).max(600).nullable(),
    reservePercentOfRevenue: z.number().min(0).max(100),
  }),
  targets: z.object({
    targetNetProfitMinor: moneyNullable,
    targetNetMarginPercent: z.number().min(-100).max(100).nullable(),
  }),
});

export type FinanceInputParsed = z.infer<typeof FinanceInputSchema>;
