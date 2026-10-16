/**
 * Чтение подписанных данных сессии из cookie.
 *
 * Отдельный модуль без обращения к БД: его импортирует слой доступа к
 * данным (src/lib/db.ts), чтобы узнать компанию запроса для политик RLS.
 * Если бы это жило в session.ts, возникла бы циклическая зависимость.
 *
 * Содержимое cookie подписано сервером (HS256), поэтому companyId оттуда
 * можно использовать как идентификатор компании. Отзыв сессии и активность
 * пользователя проверяются отдельно, в getCurrentSession.
 */

import { createHash } from 'node:crypto';
import { jwtVerify } from 'jose';
import { cookies } from 'next/headers';

export const SESSION_COOKIE = 'tk_session';

export function secretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32 || /СМЕНИТЕ|CHANGE_ME|REPLACE_ME/i.test(secret)) {
    throw new Error(
      'SESSION_SECRET не задан или короче 32 символов. Смотрите .env.example',
    );
  }
  return new TextEncoder().encode(secret);
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface SessionClaims {
  userId: string;
  companyId: string;
  role: string;
  sid: string;
  /** Сырой токен для сверки с хешем в БД. */
  raw: string;
}

/**
 * Кэш проверенных токенов.
 *
 * Политики RLS требуют идентификатор компании для КАЖДОГО запроса к данным,
 * а их в одном HTTP-запросе бывает несколько. Проверять подпись заново на
 * каждый запрос к БД не нужно: токен тот же. Размер ограничен, чтобы кэш
 * не стал утечкой памяти.
 */
const VERIFIED = new Map<string, { claims: SessionClaims; expiresAtMs: number }>();
const VERIFIED_LIMIT = 500;

function remember(token: string, claims: SessionClaims, expiresAtMs: number): void {
  if (VERIFIED.size >= VERIFIED_LIMIT) {
    // Простое вытеснение самого старого: Map сохраняет порядок вставки.
    const oldest = VERIFIED.keys().next().value;
    if (oldest !== undefined) VERIFIED.delete(oldest);
  }
  VERIFIED.set(token, { claims, expiresAtMs });
}

/** Сбрасывает кэш проверенных токенов (нужно в тестах). */
export function clearVerifiedClaimsCache(): void {
  VERIFIED.clear();
}

/**
 * Проверенные данные сессии или null, если cookie нет, подпись неверна
 * либо вызов происходит вне HTTP-запроса.
 */
export async function readSessionClaims(): Promise<SessionClaims | null> {
  let token: string | undefined;
  try {
    const store = await cookies();
    token = store.get(SESSION_COOKIE)?.value;
  } catch {
    // Вне контекста запроса (фоновая задача, сид, тест) сессии нет.
    return null;
  }
  if (!token) return null;

  const cached = VERIFIED.get(token);
  if (cached && cached.expiresAtMs > Date.now()) return cached.claims;
  if (cached) VERIFIED.delete(token);

  try {
    const { payload } = await jwtVerify(token, secretKey());
    const claims: SessionClaims = {
      userId: typeof payload.userId === 'string' ? payload.userId : '',
      companyId: typeof payload.companyId === 'string' ? payload.companyId : '',
      role: typeof payload.role === 'string' ? payload.role : '',
      sid: typeof payload.sid === 'string' ? payload.sid : '',
      raw: typeof payload.raw === 'string' ? payload.raw : '',
    };
    if (!claims.userId || !claims.companyId || !claims.sid || !claims.raw) return null;
    // Кэш живёт не дольше самого токена и не дольше минуты.
    const tokenExpiryMs = typeof payload.exp === 'number' ? payload.exp * 1000 : 0;
    remember(token, claims, Math.min(Date.now() + 60_000, tokenExpiryMs || Date.now() + 60_000));
    return claims;
  } catch {
    return null;
  }
}
