import { describe, expect, it } from 'vitest';
import {
  buildOtpAuthUri,
  decodeBase32,
  encodeBase32,
  formatSecretForDisplay,
  generateTotp,
  generateTotpSecret,
  hotp,
  verifyTotp,
} from '../totp';

/**
 * Контрольные векторы RFC 4226 (приложение D) и RFC 6238 (приложение B).
 * Если реализация разойдётся со стандартом, коды не совпадут ни с одним
 * приложением-аутентификатором.
 */
const RFC4226_SECRET = Buffer.from('12345678901234567890', 'utf8');

describe('Base32 (RFC 4648)', () => {
  it('кодирует и декодирует без потерь', () => {
    for (const text of ['', 'a', 'ab', 'abc', 'abcd', 'abcde', '1234567890']) {
      const buffer = Buffer.from(text, 'utf8');
      expect(decodeBase32(encodeBase32(buffer))).toEqual(buffer);
    }
  });

  it('соответствует контрольным векторам RFC 4648', () => {
    expect(encodeBase32(Buffer.from('f'))).toBe('MY');
    expect(encodeBase32(Buffer.from('fo'))).toBe('MZXQ');
    expect(encodeBase32(Buffer.from('foo'))).toBe('MZXW6');
    expect(encodeBase32(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
  });

  it('игнорирует пробелы и регистр при декодировании', () => {
    expect(decodeBase32('mzxw 6ytb oi')).toEqual(Buffer.from('foobar'));
  });

  it('отвергает символы вне алфавита Base32', () => {
    expect(() => decodeBase32('MZXW6YTB01')).toThrow(/Base32/);
  });
});

describe('HOTP: контрольные векторы RFC 4226', () => {
  // Приложение D RFC 4226
  const EXPECTED = [
    '755224', '287082', '359152', '969429', '338314',
    '254676', '287922', '162583', '399871', '520489',
  ];

  it.each(EXPECTED.map((code, counter) => [counter, code]))(
    'счётчик %i даёт код %s',
    (counter, expected) => {
      expect(hotp({ secret: RFC4226_SECRET, counter: counter as number })).toBe(
        expected,
      );
    },
  );
});

describe('TOTP: контрольные векторы RFC 6238', () => {
  const secret = encodeBase32(RFC4226_SECRET);

  // Приложение B RFC 6238, алгоритм SHA-1, 8 знаков
  const VECTORS: Array<[number, string]> = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
  ];

  it.each(VECTORS)('время %i с даёт код %s', (seconds, expected) => {
    expect(
      generateTotp({ secret, timestampMs: seconds * 1000, digits: 8 }),
    ).toBe(expected);
  });

  it('шестизначный код — это последние 6 цифр восьмизначного', () => {
    expect(generateTotp({ secret, timestampMs: 59_000, digits: 6 })).toBe(
      '287082',
    );
  });
});

describe('проверка кода', () => {
  const secret = generateTotpSecret();
  const now = 1_760_000_000_000;

  it('принимает код текущего шага', () => {
    const token = generateTotp({ secret, timestampMs: now });
    const result = verifyTotp({ secret, token, timestampMs: now });
    expect(result.valid).toBe(true);
    expect(result.counter).toBe(Math.floor(now / 1000 / 30));
  });

  it('принимает код соседнего шага (допуск на расхождение часов)', () => {
    const previous = generateTotp({ secret, timestampMs: now - 30_000 });
    expect(verifyTotp({ secret, token: previous, timestampMs: now }).valid).toBe(
      true,
    );
    const next = generateTotp({ secret, timestampMs: now + 30_000 });
    expect(verifyTotp({ secret, token: next, timestampMs: now }).valid).toBe(true);
  });

  it('отвергает код за пределами допуска', () => {
    const old = generateTotp({ secret, timestampMs: now - 120_000 });
    expect(verifyTotp({ secret, token: old, timestampMs: now }).valid).toBe(false);
  });

  it('ГЛАВНОЕ: не принимает код повторно', () => {
    const token = generateTotp({ secret, timestampMs: now });
    const first = verifyTotp({ secret, token, timestampMs: now });
    expect(first.valid).toBe(true);

    // Повторное предъявление того же кода отклоняется
    const replay = verifyTotp({
      secret,
      token,
      timestampMs: now,
      lastUsedCounter: first.counter,
    });
    expect(replay.valid).toBe(false);
  });

  it('не принимает код более раннего шага после использования позднего', () => {
    const current = Math.floor(now / 1000 / 30);
    const previous = generateTotp({ secret, timestampMs: now - 30_000 });
    expect(
      verifyTotp({
        secret,
        token: previous,
        timestampMs: now,
        lastUsedCounter: current,
      }).valid,
    ).toBe(false);
  });

  it('отвергает код неверной длины и нечисловой', () => {
    for (const token of ['12345', '1234567', 'abcdef', '', '12 34 56 78']) {
      expect(verifyTotp({ secret, token, timestampMs: now }).valid).toBe(false);
    }
  });

  it('отвергает код от другого секрета', () => {
    const other = generateTotpSecret();
    const token = generateTotp({ secret: other, timestampMs: now });
    expect(verifyTotp({ secret, token, timestampMs: now }).valid).toBe(false);
  });

  it('не падает на некорректном секрете, а отвергает код', () => {
    expect(
      verifyTotp({ secret: 'не-base32!!', token: '123456', timestampMs: now })
        .valid,
    ).toBe(false);
  });
});

describe('секрет и ссылка для приложения-аутентификатора', () => {
  it('секрет имеет длину 32 символа Base32 (160 бит)', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  });

  it('каждый вызов даёт новый секрет', () => {
    expect(generateTotpSecret()).not.toBe(generateTotpSecret());
  });

  it('строит otpauth-ссылку с экранированием', () => {
    const uri = buildOtpAuthUri({
      secret: 'JBSWY3DPEHPK3PXP',
      accountName: 'user@company.kz',
      issuer: 'TENDER KILLER',
    });
    expect(uri.startsWith('otpauth://totp/')).toBe(true);
    expect(uri).toContain('TENDER%20KILLER');
    expect(uri).toContain('user%40company.kz');
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXP');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });

  it('форматирует секрет группами по 4 символа для ручного ввода', () => {
    expect(formatSecretForDisplay('JBSWY3DPEHPK3PXP')).toBe(
      'JBSW Y3DP EHPK 3PXP',
    );
  });
});
