/**
 * Серверные проверки доступа.
 *
 * Правило: любой запрос к данным фильтруется по companyId из сессии.
 * Идентификатор компании НИКОГДА не приходит от клиента.
 */

import { getCurrentSession, type VerifiedSession } from './session';

export type Role = 'OWNER' | 'ADMIN' | 'ANALYST' | 'VIEWER';

const ROLE_RANK: Record<Role, number> = {
  VIEWER: 1,
  ANALYST: 2,
  ADMIN: 3,
  OWNER: 4,
};

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

/** Требует авторизованного пользователя. */
export async function requireSession(): Promise<VerifiedSession> {
  const session = await getCurrentSession();
  if (!session) {
    throw new AuthError('Требуется авторизация', 401);
  }
  return session;
}

/** Требует роль не ниже указанной. */
export async function requireRole(minRole: Role): Promise<VerifiedSession> {
  const session = await requireSession();
  const rank = ROLE_RANK[session.role as Role] ?? 0;
  if (rank < ROLE_RANK[minRole]) {
    throw new AuthError(
      `Недостаточно прав. Требуется роль не ниже «${minRole}»`,
      403,
    );
  }
  return session;
}

/** Право на изменение данных (аналитик и выше). */
export async function requireWriteAccess(): Promise<VerifiedSession> {
  return requireRole('ANALYST');
}

export function canWrite(role: string): boolean {
  return (ROLE_RANK[role as Role] ?? 0) >= ROLE_RANK.ANALYST;
}

export function canManageUsers(role: string): boolean {
  return (ROLE_RANK[role as Role] ?? 0) >= ROLE_RANK.ADMIN;
}

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: 'Владелец',
  ADMIN: 'Администратор',
  ANALYST: 'Аналитик',
  VIEWER: 'Наблюдатель',
};
