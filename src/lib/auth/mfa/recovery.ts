/**
 * Коды восстановления доступа.
 *
 * Нужны, когда устройство с приложением-аутентификатором потеряно. Код
 * одноразовый: после успешного применения он помечается использованным.
 * В базе хранится только Argon2id-хеш — по содержимому базы восстановить
 * код нельзя.
 */

import { randomInt, timingSafeEqual } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

/** Без похожих символов: 0/O, 1/I/L — их путают при ручном вводе. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const GROUP_LENGTH = 5;
const GROUPS = 2;
export const RECOVERY_CODE_COUNT = 10;

/**
 * Параметры Argon2id для кодов восстановления.
 * Код содержит ~49 бит энтропии, поэтому подбор по хешу непрактичен и без
 * максимальной стоимости; параметры совпадают с хешированием паролей.
 */
const ARGON_OPTIONS = {
  algorithm: 2 as const, // Argon2id
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

/** Один код вида `ABCDE-FGHJK`. */
export function generateRecoveryCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < GROUPS; g += 1) {
    let group = '';
    for (let i = 0; i < GROUP_LENGTH; i += 1) {
      // randomInt — криптографический источник, в отличие от Math.random
      group += ALPHABET[randomInt(ALPHABET.length)];
    }
    groups.push(group);
  }
  return groups.join('-');
}

export interface GeneratedRecoveryCodes {
  /** Показываются пользователю ОДИН раз и больше нигде не хранятся. */
  plain: string[];
  /** Хеши для записи в базу. */
  hashes: string[];
}

export async function generateRecoveryCodes(
  count = RECOVERY_CODE_COUNT,
): Promise<GeneratedRecoveryCodes> {
  const plain: string[] = [];
  const seen = new Set<string>();
  while (plain.length < count) {
    const code = generateRecoveryCode();
    if (seen.has(code)) continue; // исключаем совпадения внутри набора
    seen.add(code);
    plain.push(code);
  }
  const hashes = await Promise.all(
    plain.map((code) => hash(normalizeRecoveryCode(code), ARGON_OPTIONS)),
  );
  return { plain, hashes };
}

/**
 * Приведение к каноническому виду: регистр и дефисы не должны влиять на
 * проверку, иначе пользователь не сможет ввести выданный ему код.
 */
export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export interface RecoveryMatch {
  matched: boolean;
  /** Индекс сработавшего кода — его нужно пометить использованным. */
  index: number | null;
}

/**
 * Ищет совпадение среди неиспользованных кодов.
 *
 * Проверяются ВСЕ кандидаты без раннего выхода: иначе время ответа выдаёт,
 * сколько кодов осталось и насколько введённый код близок к верному.
 */
export async function matchRecoveryCode(params: {
  input: string;
  hashes: Array<{ hash: string; usedAt: Date | null }>;
}): Promise<RecoveryMatch> {
  const normalized = normalizeRecoveryCode(params.input);
  if (normalized.length !== GROUP_LENGTH * GROUPS) {
    return { matched: false, index: null };
  }

  let matchedIndex: number | null = null;
  for (let index = 0; index < params.hashes.length; index += 1) {
    const entry = params.hashes[index]!;
    if (entry.usedAt !== null) continue;
    let ok = false;
    try {
      ok = await verify(entry.hash, normalized);
    } catch {
      ok = false;
    }
    if (ok && matchedIndex === null) matchedIndex = index;
  }

  return { matched: matchedIndex !== null, index: matchedIndex };
}

/** Сравнение строк постоянной длины без утечки по времени. */
export function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
