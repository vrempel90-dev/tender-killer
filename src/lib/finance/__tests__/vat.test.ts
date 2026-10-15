import { describe, expect, it } from 'vitest';
import { splitVat, splitVatInput } from '../vat';

describe('разложение НДС', () => {
  it('выделяет НДС из суммы с НДС (ставка 16 %)', () => {
    const r = splitVat(116_000_000, 'INCLUSIVE', 16, true);
    expect(r.netMinor).toBe(100_000_000);
    expect(r.vatMinor).toBe(16_000_000);
    expect(r.grossMinor).toBe(116_000_000);
    // инвариант: net + vat = gross
    expect(r.netMinor + r.vatMinor).toBe(r.grossMinor);
  });

  it('начисляет НДС сверху на сумму без НДС', () => {
    const r = splitVat(100_000_000, 'EXCLUSIVE', 16, true);
    expect(r.netMinor).toBe(100_000_000);
    expect(r.vatMinor).toBe(16_000_000);
    expect(r.grossMinor).toBe(116_000_000);
  });

  it('сохраняет инвариант net + vat = gross при неудобных числах', () => {
    for (const amount of [1, 7, 333, 123_457, 999_999_999]) {
      const r = splitVat(amount, 'INCLUSIVE', 16, true);
      expect(r.netMinor + r.vatMinor).toBe(r.grossMinor);
      expect(r.grossMinor).toBe(amount);
    }
  });

  it('не выделяет НДС, если он не начисляется', () => {
    const r = splitVat(116_000_000, 'INCLUSIVE', 16, false);
    expect(r.netMinor).toBe(116_000_000);
    expect(r.vatMinor).toBe(0);
  });

  it('не выделяет НДС при нулевой ставке', () => {
    const r = splitVat(116_000_000, 'INCLUSIVE', 0, true);
    expect(r.vatMinor).toBe(0);
    expect(r.netMinor).toBe(116_000_000);
  });

  it('возвращает нули для нулевой суммы', () => {
    const r = splitVat(0, 'INCLUSIVE', 16, true);
    expect(r).toEqual({ netMinor: 0, vatMinor: 0, grossMinor: 0 });
  });
});

describe('зачёт входящего НДС', () => {
  it('плательщик НДС принимает в зачёт весь входящий НДС', () => {
    const r = splitVatInput(9_600_000, true, 100);
    expect(r.recoverableMinor).toBe(9_600_000);
    expect(r.nonRecoverableMinor).toBe(0);
  });

  it('НЕплательщик НДС не принимает в зачёт ничего — это расход', () => {
    const r = splitVatInput(9_600_000, false, 100);
    expect(r.recoverableMinor).toBe(0);
    expect(r.nonRecoverableMinor).toBe(9_600_000);
  });

  it('при пропорциональном зачёте делит НДС по доле', () => {
    const r = splitVatInput(10_000_000, true, 70);
    expect(r.recoverableMinor).toBe(7_000_000);
    expect(r.nonRecoverableMinor).toBe(3_000_000);
    expect(r.recoverableMinor + r.nonRecoverableMinor).toBe(10_000_000);
  });

  it('ограничивает долю зачёта диапазоном 0…100 %', () => {
    expect(splitVatInput(1000, true, 150).recoverableMinor).toBe(1000);
    expect(splitVatInput(1000, true, -50).recoverableMinor).toBe(0);
  });
});
