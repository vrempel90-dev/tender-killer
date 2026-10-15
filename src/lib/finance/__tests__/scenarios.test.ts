import { describe, expect, it } from 'vitest';
import { calculateAllScenarios, calculateScenario, DEFAULT_SCENARIOS } from '../scenarios';
import { realisticTenderInput } from './fixtures';

describe('сценарии расчёта', () => {
  const input = realisticTenderInput();
  const all = calculateAllScenarios(input);

  it('считает три сценария', () => {
    expect(all.map((s) => s.code)).toEqual(['OPTIMISTIC', 'BASE', 'STRESS']);
  });

  it('прибыль убывает от оптимистичного к стрессовому', () => {
    const [optimistic, base, stress] = all;
    expect(optimistic!.result.profit.netMinor).toBeGreaterThan(
      base!.result.profit.netMinor,
    );
    expect(stress!.result.profit.netMinor).toBeLessThan(base!.result.profit.netMinor);
  });

  it('стрессовый сценарий увеличивает потребность в оборотном капитале', () => {
    const base = all.find((s) => s.code === 'BASE')!;
    const stress = all.find((s) => s.code === 'STRESS')!;
    expect(stress.result.workingCapital.requirementMinor).toBeGreaterThan(
      base.result.workingCapital.requirementMinor,
    );
  });

  it('базовый сценарий совпадает с расчётом по введённым данным', () => {
    const base = calculateScenario(input, 'BASE');
    expect(base.adjustment.priceFactor).toBe(1);
    expect(base.adjustment.costFactor).toBe(1);
    expect(base.result.revenue.grossMinor).toBe(input.tender.bidPriceMinor);
  });

  it('параметры сценария раскрываются пользователю, а не скрыты', () => {
    for (const s of all) {
      expect(s.description.length).toBeGreaterThan(10);
      expect(s.adjustment).toBeDefined();
      expect(typeof s.adjustment.costFactor).toBe('number');
    }
  });

  it('стрессовый сценарий снижает цену и увеличивает задержку оплаты', () => {
    const adj = DEFAULT_SCENARIOS.STRESS;
    expect(adj.priceFactor).toBeLessThan(1);
    expect(adj.costFactor).toBeGreaterThan(1);
    expect(adj.paymentDelayAddDays).toBeGreaterThan(0);
  });
});
