import { describe, expect, it } from 'vitest';
import {
  constantTimeEquals,
  generateRecoveryCode,
  generateRecoveryCodes,
  matchRecoveryCode,
  normalizeRecoveryCode,
  RECOVERY_CODE_COUNT,
} from '../recovery';

describe('генерация кодов восстановления', () => {
  it('код имеет вид ABCDE-FGHJK', () => {
    expect(generateRecoveryCode()).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
  });

  it('не содержит символов, которые путают при вводе', () => {
    const codes = Array.from({ length: 200 }, () => generateRecoveryCode());
    expect(codes.join('')).not.toMatch(/[01OIL]/);
  });

  it('коды различаются', () => {
    const codes = new Set(Array.from({ length: 100 }, () => generateRecoveryCode()));
    expect(codes.size).toBeGreaterThan(95);
  });

  it('выдаёт набор из 10 кодов и столько же хешей', async () => {
    const result = await generateRecoveryCodes();
    expect(result.plain).toHaveLength(RECOVERY_CODE_COUNT);
    expect(result.hashes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(result.plain).size).toBe(RECOVERY_CODE_COUNT);
  });

  it('хеши не содержат самих кодов', async () => {
    const { plain, hashes } = await generateRecoveryCodes(3);
    for (let i = 0; i < plain.length; i += 1) {
      expect(hashes[i]).toMatch(/^\$argon2id\$/);
      expect(hashes[i]).not.toContain(normalizeRecoveryCode(plain[i]!));
    }
  });
});

describe('нормализация ввода', () => {
  it('не зависит от регистра и дефисов', () => {
    expect(normalizeRecoveryCode('abcde-fghjk')).toBe('ABCDEFGHJK');
    expect(normalizeRecoveryCode('ABCDE FGHJK')).toBe('ABCDEFGHJK');
    expect(normalizeRecoveryCode('AB-CD-EF-GH-JK')).toBe('ABCDEFGHJK');
  });
});

describe('проверка кода восстановления', () => {
  it('принимает выданный код и возвращает его индекс', async () => {
    const { plain, hashes } = await generateRecoveryCodes(5);
    const entries = hashes.map((hash) => ({ hash, usedAt: null }));

    const result = await matchRecoveryCode({ input: plain[2]!, hashes: entries });
    expect(result.matched).toBe(true);
    expect(result.index).toBe(2);
  });

  it('принимает код, введённый в другом регистре и без дефиса', async () => {
    const { plain, hashes } = await generateRecoveryCodes(3);
    const entries = hashes.map((hash) => ({ hash, usedAt: null }));
    const typed = plain[0]!.toLowerCase().replace('-', ' ');

    expect((await matchRecoveryCode({ input: typed, hashes: entries })).matched).toBe(
      true,
    );
  });

  it('ГЛАВНОЕ: не принимает уже использованный код', async () => {
    const { plain, hashes } = await generateRecoveryCodes(3);
    const entries = hashes.map((hash, index) => ({
      hash,
      usedAt: index === 1 ? new Date() : null,
    }));

    const result = await matchRecoveryCode({ input: plain[1]!, hashes: entries });
    expect(result.matched).toBe(false);
    expect(result.index).toBeNull();
  });

  it('не принимает посторонний код', async () => {
    const { hashes } = await generateRecoveryCodes(3);
    const entries = hashes.map((hash) => ({ hash, usedAt: null }));
    expect(
      (await matchRecoveryCode({ input: 'ZZZZZ-ZZZZZ', hashes: entries })).matched,
    ).toBe(false);
  });

  it('не принимает код неверной длины', async () => {
    const { hashes } = await generateRecoveryCodes(2);
    const entries = hashes.map((hash) => ({ hash, usedAt: null }));
    for (const input of ['', 'ABC', 'ABCDE-FGHJK-XYZAB']) {
      expect((await matchRecoveryCode({ input, hashes: entries })).matched).toBe(
        false,
      );
    }
  });

  it('не падает на повреждённом хеше, а отклоняет код', async () => {
    const result = await matchRecoveryCode({
      input: 'ABCDE-FGHJK',
      hashes: [{ hash: 'это-не-хеш', usedAt: null }],
    });
    expect(result.matched).toBe(false);
  });
});

describe('сравнение без утечки по времени', () => {
  it('сравнивает строки корректно', () => {
    expect(constantTimeEquals('одинаково', 'одинаково')).toBe(true);
    expect(constantTimeEquals('одинаково', 'по-другому')).toBe(false);
    expect(constantTimeEquals('', '')).toBe(true);
  });

  it('разная длина не вызывает исключения', () => {
    expect(constantTimeEquals('короткая', 'значительно длиннее')).toBe(false);
  });
});
