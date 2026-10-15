/**
 * Сессии: подписанный JWT в httpOnly cookie + серверный реестр сессий.
 *
 * Реестр нужен, чтобы сессию можно было отозвать (выход со всех устройств,
 * блокировка пользователя). Проверка доступа всегда идёт через БД, а не только
 * по содержимому cookie.
 */

import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { prisma } from '../db';

export const SESSION_COOKIE = 'tk_session';
const SESSION_TTL_DAYS = 7;

export interface SessionPayload {
  userId: string;
  companyId: string;
  role: string;
  /** Идентификатор записи в таблице sessions. */
  sid: string;
}

function secretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      'SESSION_SECRET не задан или короче 32 символов. Смотрите .env.example',
    );
  }
  return new TextEncoder().encode(secret);
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Создаёт сессию в БД и возвращает подписанный токен для cookie. */
export async function createSession(params: {
  userId: string;
  companyId: string;
  role: string;
  userAgent?: string | null;
  ipAddress?: string | null;
}): Promise<{ token: string; expiresAt: Date }> {
  const raw = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);

  const record = await prisma.session.create({
    data: {
      userId: params.userId,
      tokenHash: hashToken(raw),
      userAgent: params.userAgent ?? null,
      ipAddress: params.ipAddress ?? null,
      expiresAt,
    },
  });

  const token = await new SignJWT({
    userId: params.userId,
    companyId: params.companyId,
    role: params.role,
    sid: record.id,
    // Сырой токен нужен для сверки с хешем в БД.
    raw,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(secretKey());

  return { token, expiresAt };
}

export interface VerifiedSession extends SessionPayload {
  email: string;
  name: string;
}

/**
 * Проверяет cookie: подпись JWT, наличие и актуальность записи в БД,
 * активность пользователя. Возвращает null, если сессия недействительна.
 */
export async function getCurrentSession(): Promise<VerifiedSession | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  let claims: Record<string, unknown>;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    claims = payload as Record<string, unknown>;
  } catch {
    return null;
  }

  const sid = typeof claims.sid === 'string' ? claims.sid : null;
  const raw = typeof claims.raw === 'string' ? claims.raw : null;
  if (!sid || !raw) return null;

  const session = await prisma.session.findUnique({
    where: { id: sid },
    include: { user: true },
  });

  if (
    !session ||
    session.revokedAt !== null ||
    session.expiresAt.getTime() < Date.now() ||
    session.tokenHash !== hashToken(raw) ||
    !session.user.isActive
  ) {
    return null;
  }

  return {
    userId: session.user.id,
    companyId: session.user.companyId,
    role: session.user.role,
    sid: session.id,
    email: session.user.email,
    name: session.user.name,
  };
}

/** Отзывает сессию в БД. */
export async function revokeSession(sid: string): Promise<void> {
  await prisma.session
    .update({ where: { id: sid }, data: { revokedAt: new Date() } })
    .catch(() => undefined);
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    expires: expiresAt,
  };
}
