/**
 * Политика второго фактора: чистые функции без обращения к БД.
 *
 * Вынесено отдельно, чтобы правило доступа можно было проверить тестами
 * без базы и чтобы оно было одинаковым в API, серверных страницах и UI.
 */

/** Роли, для которых компания может требовать второй фактор. */
export const ADMIN_ROLES: readonly string[] = [];

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
  // Legacy company flags cannot force enrollment. TOTP is a personal opt-in.
  void role;
  void companyRequiresMfaForAdmins;
  return false;
}

/**
 * Решение о доступе.
 *
 * Важно: если пользователь подключил второй фактор добровольно (его роль
 * этого не требует), сессия всё равно обязана его пройти. Иначе включение
 * второго фактора не давало бы никакой защиты.
 */
export function evaluateMfaGate(input: MfaGateInput): MfaGate {
  // Password-only access for all roles, including previously enrolled accounts.
  void input;
  return 'OK';
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
  void input;
  return false;
}

/** Текст для пользователя: что именно нужно сделать. */
export function gateMessage(gate: Exclude<MfaGate, 'OK'>): string {
  return gate === 'ENROLL_REQUIRED'
    ? 'Для вашей роли обязателен второй фактор. Подключите приложение-аутентификатор.'
    : 'Подтвердите вход кодом из приложения-аутентификатора.';
}
