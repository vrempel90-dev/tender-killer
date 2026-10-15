import { describe, expect, it } from 'vitest';
import { computeSecurity } from '../securities';
import { kzt } from './fixtures';

describe('обеспечения', () => {
  it('денежный залог НЕ является расходом: расход — только стоимость денег', () => {
    const r = computeSecurity(
      {
        form: 'CASH_DEPOSIT',
        percentOfBase: 1,
        amountMinor: null,
        guaranteeFeePercentAnnual: 0,
        guaranteeFeeFixedMinor: 0,
        heldDays: 365,
      },
      kzt(50_000_000),
      14,
    );
    // сумма залога
    expect(r.amountMinor).toBe(kzt(500_000));
    expect(r.frozenCashMinor).toBe(kzt(500_000));
    // расход = 500 000 × 14 % × 365/365 = 70 000 ₸, а не 500 000 ₸
    expect(r.costMinor).toBe(kzt(70_000));
    expect(r.costMinor).toBeLessThan(r.amountMinor);
  });

  it('пропорционально сокращает стоимость денег при коротком сроке', () => {
    const r = computeSecurity(
      {
        form: 'CASH_DEPOSIT',
        percentOfBase: 1,
        amountMinor: null,
        guaranteeFeePercentAnnual: 0,
        guaranteeFeeFixedMinor: 0,
        heldDays: 45,
      },
      kzt(50_000_000),
      14,
    );
    // 500 000 × 14 % × 45/365
    expect(r.costMinor).toBe(Math.round(kzt(500_000) * 0.14 * (45 / 365)));
  });

  it('банковская гарантия не блокирует деньги, расход — комиссия банка', () => {
    const r = computeSecurity(
      {
        form: 'BANK_GUARANTEE',
        percentOfBase: 3,
        amountMinor: null,
        guaranteeFeePercentAnnual: 5,
        guaranteeFeeFixedMinor: kzt(25_000),
        heldDays: 365,
      },
      kzt(46_000_000),
      14,
    );
    expect(r.amountMinor).toBe(kzt(1_380_000));
    expect(r.frozenCashMinor).toBe(0);
    // 1 380 000 × 5 % + 25 000 фикс
    expect(r.costMinor).toBe(kzt(69_000) + kzt(25_000));
  });

  it('абсолютная сумма имеет приоритет над процентом', () => {
    const r = computeSecurity(
      {
        form: 'CASH_DEPOSIT',
        percentOfBase: 1,
        amountMinor: kzt(999_000),
        guaranteeFeePercentAnnual: 0,
        guaranteeFeeFixedMinor: 0,
        heldDays: 0,
      },
      kzt(50_000_000),
      14,
    );
    expect(r.amountMinor).toBe(kzt(999_000));
  });

  it('не считает обеспечение, если база неизвестна', () => {
    const r = computeSecurity(
      {
        form: 'CASH_DEPOSIT',
        percentOfBase: 1,
        amountMinor: null,
        guaranteeFeePercentAnnual: 0,
        guaranteeFeeFixedMinor: 0,
        heldDays: 30,
      },
      null,
      14,
    );
    expect(r.amountMinor).toBe(0);
  });

  it('форма NONE даёт нулевые суммы', () => {
    const r = computeSecurity(
      {
        form: 'NONE',
        percentOfBase: 1,
        amountMinor: kzt(1_000),
        guaranteeFeePercentAnnual: 5,
        guaranteeFeeFixedMinor: kzt(100),
        heldDays: 30,
      },
      kzt(1_000_000),
      14,
    );
    expect(r.amountMinor).toBe(0);
    expect(r.costMinor).toBe(0);
    expect(r.frozenCashMinor).toBe(0);
  });
});
