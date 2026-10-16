/**
 * Политика второго фактора: чистые функции без обращения к БД.
 *
 * Вынесено отдельно, чтобы правило доступа можно было проверить тестами
 * без базы и чтобы оно было одинаковым в API, серверных страницах и UI.
 */

/** Роли, для которых компания может требовать второй фактор. */
export const ADMIN_ROLES: readonly string[] = ['OWNER', 'ADMIN'];

/**
 * Срок действия повторного подтверждения (step-up) перед чувствительной
 * операцией. 15 минут: хватает на серию действий, но оставленная без
 * присмотра сессия не остаётся привилегированной надолго.
 */
export const STEP_UP_TTL_MS = 15 * 60_000;

export type MfaGate =
  /** Доступ разрешён. */
  | 'OK'
  /** Второй фактор обязателен, но не подключён: нужно подключение. */
  | 'ENROLL_REQUIRED'
  /** Второй фактор подключён, но в этой сессии не подтверждён. */
  | 'VERIFY_REQUIRED';

export interface MfaGateInput {
  role: string;
  /** Настройка компании: требовать второй фактор для OWNER и ADMIN. */
  companyRequiresMfaForAdmins: boolean;
  /** У пользователя есть подтверждённый второй фактор. */
  mfaEnabled: boolean;
  /** Когда второй фактор был подтверждён в текущей сессии. */
  sessionMfaVerifiedAt: Date | null;
}

export function isMfaRequiredForRole(
  role: string,
  companyRequiresMfaForAdmins: boolean,
): boolean {
  return companyRequiresMfaForAdmins && ADMIN_ROLES.includes(role);
}

/**
 * Решение о доступе.
 *
 * Важно: если пользователь подключил второй фактор добровольно (его роль
 * этого не требует), сессия всё равно обязана его пройти. Иначе включение
 * второго фактора не давало бы никакой защиты.
 */
export function evaluateMfaGate(input: MfaGateInput): MfaGate {
  if (input.mfaEnabled) {
    return input.sessionMfaVerifiedAt === null ? 'VERIFY_REQUIRED' : 'OK';
  }
  return isMfaRequiredForRole(input.role, input.companyRequiresMfaForAdmins)
    ? 'ENROLL_REQUIRED'
    : 'OK';
}

/**
 * Нужно ли повторное подтверждение перед чувствительной операцией.
 *
 * Если второй фактор не подключён, step-up невозможен и не требуется:
 * доступ в этом случае регулируется только ролью и политикой компании.
 */
export function needsStepUp(input: {
  mfaEnabled: boolean;
  sessionMfaSteppedUpAt: Date | null;
  now?: Date;
  ttlMs?: number;
}): boolean {
  if (!input.mfaEnabled) return false;
  if (input.sessionMfaSteppedUpAt === null) return true;
  const ttl = input.ttlMs ?? STEP_UP_TTL_MS;
  const now = (input.now ?? new Date()).getTime();
  return now - input.sessionMfaSteppedUpAt.getTime() > ttl;
}

/** Текст для пользователя: что именно нужно сделать. */
export function gateMessage(gate: Exclude<MfaGate, 'OK'>): string {
  return gate === 'ENROLL_REQUIRED'
    ? 'Для вашей роли обязателен второй фактор. Подключите приложение-аутентификатор.'
    : 'Подтвердите вход кодом из приложения-аутентификатора.';
}
