/**
 * TOTP (RFC 6238) и Base32 (RFC 4648) на node:crypto, без внешних зависимостей.
 *
 * Своя реализация выбрана сознательно: алгоритм компактный и стабильный, а
 * каждая новая зависимость в цепочке аутентификации — дополнительный
 * supply-chain риск. Корректность проверяется контрольными векторами из
 * приложения A RFC 6238 (см. __tests__/totp.test.ts).
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Параметры по умолчанию: совместимы с Google Authenticator и аналогами. */
export const TOTP_DEFAULTS = {
  digits: 6,
  periodSeconds: 30,
  algorithm: 'sha1' as const,
  /**
   * Допуск по времени: ±1 шаг (±30 с). Больше окно — выше риск повторного
   * использования перехваченного кода.
   */
  window: 1,
};

export function encodeBase32(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function decodeBase32(input: string): Buffer {
  const normalized = input.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error('Некорректный ключ: допустимы только символы Base32');
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Новый секрет TOTP. 20 байт — размер, рекомендованный RFC 4226. */
export function generateTotpSecret(): string {
  return encodeBase32(randomBytes(20));
}

/**
 * Код для конкретного счётчика (HOTP, RFC 4226).
 * Экспортируется ради тестов на контрольных векторах.
 */
export function hotp(params: {
  secret: Buffer;
  counter: number;
  digits?: number;
  algorithm?: 'sha1' | 'sha256' | 'sha512';
}): string {
  const digits = params.digits ?? TOTP_DEFAULTS.digits;
  const counterBuffer = Buffer.alloc(8);
  // Счётчик — 64-битное целое; BigInt исключает потерю точности.
  counterBuffer.writeBigUInt64BE(BigInt(params.counter));

  const digest = createHmac(params.algorithm ?? TOTP_DEFAULTS.algorithm, params.secret)
    .update(counterBuffer)
    .digest();

  // Динамическое усечение по RFC 4226 §5.4
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);

  return String(binary % 10 ** digits).padStart(digits, '0');
}

export function generateTotp(params: {
  secret: string;
  timestampMs?: number;
  digits?: number;
  periodSeconds?: number;
  algorithm?: 'sha1' | 'sha256' | 'sha512';
}): string {
  const period = params.periodSeconds ?? TOTP_DEFAULTS.periodSeconds;
  const timestamp = params.timestampMs ?? Date.now();
  const counter = Math.floor(timestamp / 1000 / period);
  return hotp({
    secret: decodeBase32(params.secret),
    counter,
    digits: params.digits,
    algorithm: params.algorithm,
  });
}

export interface TotpVerification {
  valid: boolean;
  /**
   * Шаг времени, на котором код совпал. Нужен для защиты от повторного
   * использования: один и тот же шаг нельзя принять дважды.
   */
  counter: number | null;
}

/**
 * Проверка кода с допуском по времени.
 *
 * Сравнение — постоянное по времени: иначе по задержке ответа можно
 * подбирать код посимвольно.
 */
export function verifyTotp(params: {
  secret: string;
  token: string;
  timestampMs?: number;
  digits?: number;
  periodSeconds?: number;
  window?: number;
  algorithm?: 'sha1' | 'sha256' | 'sha512';
  /** Шаг, уже использованный этим пользователем: повтор отклоняется. */
  lastUsedCounter?: number | null;
}): TotpVerification {
  const digits = params.digits ?? TOTP_DEFAULTS.digits;
  const normalized = params.token.replace(/\s+/g, '');
  if (!new RegExp(`^\\d{${digits}}$`).test(normalized)) {
    return { valid: false, counter: null };
  }

  const period = params.periodSeconds ?? TOTP_DEFAULTS.periodSeconds;
  const window = params.window ?? TOTP_DEFAULTS.window;
  const timestamp = params.timestampMs ?? Date.now();
  const current = Math.floor(timestamp / 1000 / period);

  let secret: Buffer;
  try {
    secret = decodeBase32(params.secret);
  } catch {
    return { valid: false, counter: null };
  }

  const candidate = Buffer.from(normalized, 'utf8');
  for (let drift = -window; drift <= window; drift += 1) {
    const counter = current + drift;
    if (counter < 0) continue;
    // Код из уже использованного или более раннего шага не принимается.
    if (
      params.lastUsedCounter !== null &&
      params.lastUsedCounter !== undefined &&
      counter <= params.lastUsedCounter
    ) {
      continue;
    }
    const expected = Buffer.from(
      hotp({ secret, counter, digits, algorithm: params.algorithm }),
      'utf8',
    );
    if (
      expected.length === candidate.length &&
      timingSafeEqual(expected, candidate)
    ) {
      return { valid: true, counter };
    }
  }
  return { valid: false, counter: null };
}

/**
 * otpauth-URI для приложения-аутентификатора.
 * Метки и эмитент кодируются: иначе название компании с пробелом ломает QR.
 */
export function buildOtpAuthUri(params: {
  secret: string;
  accountName: string;
  issuer: string;
  digits?: number;
  periodSeconds?: number;
  algorithm?: 'sha1' | 'sha256' | 'sha512';
}): string {
  const label = `${encodeURIComponent(params.issuer)}:${encodeURIComponent(params.accountName)}`;
  const query = new URLSearchParams({
    secret: params.secret,
    issuer: params.issuer,
    algorithm: (params.algorithm ?? TOTP_DEFAULTS.algorithm).toUpperCase(),
    digits: String(params.digits ?? TOTP_DEFAULTS.digits),
    period: String(params.periodSeconds ?? TOTP_DEFAULTS.periodSeconds),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}

/** Секрет в группах по 4 символа — так его проще ввести вручную. */
export function formatSecretForDisplay(secret: string): string {
  return secret.replace(/(.{4})/g, '$1 ').trim();
}
