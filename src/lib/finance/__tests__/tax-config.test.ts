import { describe, expect, it } from 'vitest';
import {
  buildTaxContext,
  CAN_BE_VAT_PAYER,
  DEFAULT_TAX_RATES,
  getUnverifiedRates,
  TAX_CONFIG_VERSION,
} from '../tax-config';

describe('налоговая конфигурация', () => {
  it('у каждой ставки есть источник и дата начала действия', () => {
    for (const rate of DEFAULT_TAX_RATES) {
      expect(rate.sourceTitle.length).toBeGreaterThan(5);
      expect(rate.effectiveFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isFinite(rate.ratePercent)).toBe(true);
    }
  });

  it('ставка НДС по умолчанию — 16 % с 2026 года', () => {
    const vat = DEFAULT_TAX_RATES.find((r) => r.key === 'VAT_STANDARD')!;
    expect(vat.ratePercent).toBe(16);
    expect(vat.effectiveFrom).toBe('2026-01-01');
  });

  it('ставка КПН по умолчанию — 20 %', () => {
    const cit = DEFAULT_TAX_RATES.find((r) => r.key === 'CIT_STANDARD')!;
    expect(cit.ratePercent).toBe(20);
  });

  it('помечает ставки, не сверенные с первоисточником', () => {
    const unverified = getUnverifiedRates();
    expect(unverified.length).toBeGreaterThan(0);
    for (const r of unverified) {
      expect(r.needsVerification).toBe(true);
      expect(r.notes).toBeTruthy();
    }
  });

  it('строит контекст для плательщика НДС на общем режиме', () => {
    const ctx = buildTaxContext({ regime: 'GENERAL_VAT', isVatPayer: true });
    expect(ctx.vatRatePercent).toBe(16);
    expect(ctx.purchaseVatRatePercent).toBe(16);
    expect(ctx.vatRecoverySharePercent).toBe(100);
    expect(ctx.incomeTaxBase).toBe('PROFIT');
    expect(ctx.incomeTaxRatePercent).toBe(20);
    expect(ctx.configVersion).toBe(TAX_CONFIG_VERSION);
  });

  it('не делает плательщиком НДС того, кто им быть не может', () => {
    // применяющий СНР не подлежит постановке на учёт по НДС
    expect(CAN_BE_VAT_PAYER.SIMPLIFIED).toBe(false);
    const ctx = buildTaxContext({ regime: 'SIMPLIFIED', isVatPayer: true });
    expect(ctx.isVatPayer).toBe(false);
    expect(ctx.vatRatePercent).toBe(0);
    // но поставщики всё равно выставляют НДС
    expect(ctx.purchaseVatRatePercent).toBe(16);
    expect(ctx.vatRecoverySharePercent).toBe(0);
  });

  it('для СНР налог считается с оборота', () => {
    const ctx = buildTaxContext({ regime: 'SIMPLIFIED', isVatPayer: false });
    expect(ctx.incomeTaxBase).toBe('TURNOVER');
    expect(ctx.incomeTaxRatePercent).toBe(4);
  });

  it('падает с ошибкой, если нужной ставки нет, вместо подстановки значения', () => {
    expect(() =>
      buildTaxContext({
        regime: 'GENERAL_VAT',
        isVatPayer: true,
        rates: [],
      }),
    ).toThrow(/VAT_STANDARD/);
  });

  it('поддерживает пропорциональный зачёт НДС', () => {
    const ctx = buildTaxContext({
      regime: 'GENERAL_VAT',
      isVatPayer: true,
      vatRecoverySharePercent: 60,
    });
    expect(ctx.vatRecoverySharePercent).toBe(60);
  });
});
