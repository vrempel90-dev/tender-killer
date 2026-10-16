/**
 * Серверные проверки доступа.
 *
 * Правило: любой запрос к данным фильтруется по companyId из сессии.
 * Идентификатор компании НИКОГДА не приходит от клиента.
 */

import { consumeQuota } from '../security/quota';
import { evaluateMfaGate, gateMessage, needsStepUp, type MfaGate } from './mfa/policy';
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

/**
 * Ошибка непройденного второго фактора.
 *
 * Отделена от AuthError, чтобы клиент мог отличить «не хватает прав»
 * от «нужно пройти второй фактор» и увести пользователя на /mfa.
 */
export class MfaError extends AuthError {
  constructor(readonly gate: Exclude<MfaGate, 'OK'>) {
    super(gateMessage(gate), 403);
    this.name = 'MfaError';
  }
}

/**
 * Сессия без проверки второго фактора.
 *
 * Применяется ТОЛЬКО там, где второй фактор ещё не может быть пройден:
 * подключение фактора, его подтверждение и выход. Для всего остального
 * используйте requireSession.
 */
export async function requirePartialSession(): Promise<VerifiedSession> {
  const session = await getCurrentSession();
  if (!session) {
    throw new AuthError('Требуется авторизация', 401);
  }
  return session;
}

/** Состояние второго фактора для текущей сессии. */
export function sessionMfaGate(session: VerifiedSession): MfaGate {
  return evaluateMfaGate({
    role: session.role,
    companyRequiresMfaForAdmins: session.companyRequiresMfaForAdmins,
    mfaEnabled: session.mfaEnabled,
    sessionMfaVerifiedAt: session.mfaVerifiedAt,
  });
}

/**
 * Требует авторизованного пользователя, прошедшего второй фактор там,
 * где он подключён или обязателен.
 */
export async function requireSession(): Promise<VerifiedSession> {
  const session = await requirePartialSession();
  const gate = sessionMfaGate(session);
  if (gate !== 'OK') {
    throw new MfaError(gate);
  }
  return session;
}

/**
 * Требует свежего подтверждения вторым фактором перед чувствительной
 * операцией (смена настроек компании, управление пользователями,
 * отключение самого фактора).
 */
export async function requireStepUp(): Promise<VerifiedSession> {
  const session = await requireSession();
  if (
    needsStepUp({
      mfaEnabled: session.mfaEnabled,
      sessionMfaSteppedUpAt: session.mfaSteppedUpAt,
    })
  ) {
    throw new AuthError(
      'Подтвердите действие кодом из приложения-аутентификатора',
      403,
    );
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

/**
 * Общий предел изменяющих запросов одной компании: 300 в минуту.
 *
 * Отдельные операции имеют свои, более строгие пределы (загрузка файлов,
 * AI-анализ, подбор). Этот — страховка от того, что новый обработчик
 * добавят без собственного лимита: он применяется ко всем изменениям,
 * потому что проходит через проверку права на запись.
 */
const WRITE_LIMIT_PER_MINUTE = 300;

/** Право на изменение данных (аналитик и выше). */
export async function requireWriteAccess(): Promise<VerifiedSession> {
  const session = await requireRole('ANALYST');
  await consumeQuota('api-write', session.companyId, WRITE_LIMIT_PER_MINUTE, 60);
  return session;
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
