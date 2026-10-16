import { describe, expect, it } from 'vitest';
import { qrModules, renderQrPath } from '../qr';

const URI =
  'otpauth://totp/TENDER%20KILLER:owner@example.kz?secret=JBSWY3DPEHPK3PXP&issuer=TENDER%20KILLER';

describe('qrModules', () => {
  it('матрица квадратная и допустимого размера версии', () => {
    const modules = qrModules(URI);
    const count = modules.length;
    // Версия N даёт 17 + 4N модулей; минимум 21 (версия 1).
    expect((count - 17) % 4).toBe(0);
    expect(count).toBeGreaterThanOrEqual(21);
    for (const row of modules) {
      expect(row).toHaveLength(count);
    }
  });

  it('содержит три поисковых шаблона в углах', () => {
    const modules = qrModules(URI);
    const count = modules.length;
    // Поисковый шаблон: тёмная рамка 7x7 с тёмным центром 3x3.
    const corners: Array<[number, number]> = [
      [0, 0],
      [0, count - 7],
      [count - 7, 0],
    ];
    for (const [top, left] of corners) {
      expect(modules[top]![left]).toBe(true);
      expect(modules[top + 6]![left + 6]).toBe(true);
      // Светлое кольцо внутри рамки.
      expect(modules[top + 1]![left + 1]).toBe(false);
      // Тёмное ядро.
      expect(modules[top + 3]![left + 3]).toBe(true);
    }
  });

  it('детерминирован для одних и тех же данных', () => {
    expect(qrModules(URI)).toEqual(qrModules(URI));
  });

  it('отвергает пустые данные', () => {
    expect(() => qrModules('')).toThrow(/Нечего кодировать/);
  });
});

describe('renderQrPath', () => {
  it('размер учитывает отступ 4 модуля с каждой стороны', () => {
    const { size } = renderQrPath(URI);
    expect(size).toBe(qrModules(URI).length + 8);
  });

  it('путь состоит только из допустимых команд SVG', () => {
    const { path } = renderQrPath(URI);
    expect(path.length).toBeGreaterThan(0);
    expect(path).toMatch(/^[Mhvz0-9 -]+$/);
  });

  it('разные данные дают разные пути', () => {
    expect(renderQrPath(URI).path).not.toBe(renderQrPath(`${URI}&digits=6`).path);
  });

  it('число тёмных модулей совпадает с суммой длин серий', () => {
    const modules = qrModules(URI);
    const dark = modules.flat().filter(Boolean).length;
    const { path } = renderQrPath(URI);
    const covered = [...path.matchAll(/h(\d+)v1/g)].reduce(
      (sum, match) => sum + Number(match[1]),
      0,
    );
    expect(covered).toBe(dark);
  });
});
