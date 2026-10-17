import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

/** Стоимость хеширования. 12 — разумный баланс для веб-приложения. */
export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, { algorithm: 2 /* Argon2id */, memoryCost: 19456, timeCost: 2, parallelism: 1 });
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  try {
    if (hash.startsWith('$argon2id$')) return await verify(hash, plain);
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;
/** Missing accounts still pay the password verification cost. No credential is stored. */
export async function verifyLoginPassword(plain: string, passwordHash: string | null): Promise<boolean> {
  const target = passwordHash ?? await (dummyHash ??= hashPassword(randomBytes(32).toString('hex')));
  const valid = await verifyPassword(plain, target);
  return passwordHash !== null && valid;
}

/** Минимальные требования к паролю. */
export function validatePasswordStrength(password: string): string | null {
  if (password.length > 256) return 'Пароль должен быть не длиннее 256 символов';
  if (password.length < 10) {
    return 'Пароль должен быть не короче 10 символов';
  }
  if (!/[a-zA-Zа-яА-Я]/.test(password)) {
    return 'Пароль должен содержать буквы';
  }
  if (!/\d/.test(password)) {
    return 'Пароль должен содержать хотя бы одну цифру';
  }
  return null;
}
