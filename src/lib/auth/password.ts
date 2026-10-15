import bcrypt from 'bcryptjs';

/** Стоимость хеширования. 12 — разумный баланс для веб-приложения. */
const SALT_ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

/** Минимальные требования к паролю. */
export function validatePasswordStrength(password: string): string | null {
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
