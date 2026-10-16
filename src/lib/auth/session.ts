/**
 * Сессии: подписанный JWT в httpOnly cookie + серверный реестр сессий.
 *
 * Реестр нужен, чтобы сессию можно было отозвать (выход со всех устройств,
 * блокировка пользователя). Проверка доступа всегда идёт через БД, а не только
 * по содержимому cookie.
 */

import { randomBytes } from 'node:crypto';
import { SignJWT } from 'jose';
import { prisma } from '../db';
import {
  hashToken,
  readSessionClaims,
  secretKey,
  SESSION_COOKIE,
} from './session-claims';

export { SESSION_COOKIE, hashToken };
const SESSION_TTL_DAYS = 7;

export interface SessionPayload {
  userId: string;
  companyId: string;
  role: string;
  /** Идентификатор записи в таблице sessions. */
  sid: string;
}

/** Создаёт сессию в БД и возвращает подписанный токен для cookie. */
export async function createSession(params: {
  userId: string;
  companyId: string;
  role: string;
  userAgent?: string | null;
  ipAddress?: string | null;
}): Promise<{ token: string; expiresAt: Date }> {
  const signingKey = secretKey();
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
    .sign(signingKey);

  return { token, expiresAt };
}

export interface VerifiedSession extends SessionPayload {
  email: string;
  name: string;
  /** У пользователя подключён и подтверждён второй фактор. */
  mfaEnabled: boolean;
  /** Компания требует второй фактор для OWNER и ADMIN. */
  companyRequiresMfaForAdmins: boolean;
  /** Когда второй фактор был подтверждён в этой сессии. */
  mfaVerifiedAt: Date | null;
  /** Когда в этой сессии было последнее подтверждение перед операцией. */
  mfaSteppedUpAt: Date | null;
}

/**
 * Проверяет cookie: подпись JWT, наличие и актуальность записи в БД,
 * активность пользователя. Возвращает null, если сессия недействительна.
 */
export async function getCurrentSession(): Promise<VerifiedSession | null> {
  const claims = await readSessionClaims();
  if (!claims) return null;
  const { sid, raw } = claims;

  const session = await prisma.session.findUnique({
    where: { id: sid },
    include: { user: { include: { company: { select: { requireMfaForAdmins: true } } } } },
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
    mfaEnabled: session.user.totpConfirmedAt !== null,
    companyRequiresMfaForAdmins: session.user.company.requireMfaForAdmins,
    mfaVerifiedAt: session.mfaVerifiedAt,
    mfaSteppedUpAt: session.mfaSteppedUpAt,
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
