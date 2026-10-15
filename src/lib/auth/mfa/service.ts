/**
 * Второй фактор: подключение, проверка и политика доступа.
 *
 * Политика: если компания требует MFA для администраторов, роли OWNER и
 * ADMIN не получают доступ к защищённым операциям, пока второй фактор не
 * подключён и не подтверждён в текущей сессии.
 */

import { dbTransaction, prisma } from '../../db';
import { isMfaRequiredForRole } from './policy';
import { generateRecoveryCodes, matchRecoveryCode } from './recovery';
import {
  buildOtpAuthUri,
  formatSecretForDisplay,
  generateTotpSecret,
  verifyTotp,
} from './totp';

export const MFA_ISSUER = 'TENDER KILLER';

export interface MfaStatus {
  /** Второй фактор подключён и подтверждён. */
  enabled: boolean;
  /** Второй фактор обязателен для этого пользователя. */
  required: boolean;
  /** Подключение начато, но не подтверждено кодом. */
  pendingConfirmation: boolean;
  /** Сколько неиспользованных кодов восстановления осталось. */
  recoveryCodesLeft: number;
  confirmedAt: Date | null;
}

export async function getMfaStatus(userId: string): Promise<MfaStatus> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      totpSecret: true,
      totpConfirmedAt: true,
      company: { select: { requireMfaForAdmins: true } },
      recoveryCodes: { where: { usedAt: null }, select: { id: true } },
    },
  });
  if (!user) {
    throw new Error('Пользователь не найден');
  }

  return {
    enabled: user.totpConfirmedAt !== null,
    required: isMfaRequiredForRole(user.role, user.company.requireMfaForAdmins),
    pendingConfirmation:
      user.totpSecret !== null && user.totpConfirmedAt === null,
    recoveryCodesLeft: user.recoveryCodes.length,
    confirmedAt: user.totpConfirmedAt,
  };
}

export interface EnrollmentStart {
  secret: string;
  secretForDisplay: string;
  otpauthUri: string;
}

/**
 * Начало подключения: создаёт секрет, но НЕ включает второй фактор.
 * Включение происходит только после подтверждения кодом из приложения —
 * иначе пользователь заблокирует себе доступ, неверно отсканировав QR.
 */
export async function startMfaEnrollment(params: {
  userId: string;
  accountName: string;
}): Promise<EnrollmentStart> {
  const existing = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { totpConfirmedAt: true },
  });
  if (existing?.totpConfirmedAt) {
    throw new Error(
      'Второй фактор уже подключён. Сначала отключите текущий, затем подключите новый.',
    );
  }

  const secret = generateTotpSecret();
  await prisma.user.update({
    where: { id: params.userId },
    data: { totpSecret: secret, totpConfirmedAt: null, totpLastCounter: null },
  });

  return {
    secret,
    secretForDisplay: formatSecretForDisplay(secret),
    otpauthUri: buildOtpAuthUri({
      secret,
      accountName: params.accountName,
      issuer: MFA_ISSUER,
    }),
  };
}

export interface EnrollmentConfirmation {
  confirmed: boolean;
  /** Коды восстановления показываются ОДИН раз. */
  recoveryCodes: string[];
  error?: string;
}

/**
 * Подтверждение подключения кодом из приложения.
 * При успехе выдаются коды восстановления, прежние аннулируются.
 */
export async function confirmMfaEnrollment(params: {
  userId: string;
  token: string;
  now?: Date;
}): Promise<EnrollmentConfirmation> {
  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { totpSecret: true, totpConfirmedAt: true },
  });

  if (!user?.totpSecret) {
    return {
      confirmed: false,
      recoveryCodes: [],
      error: 'Подключение не начато: сначала получите ключ для приложения.',
    };
  }
  if (user.totpConfirmedAt) {
    return {
      confirmed: false,
      recoveryCodes: [],
      error: 'Второй фактор уже подтверждён.',
    };
  }

  const timestampMs = (params.now ?? new Date()).getTime();
  const result = verifyTotp({
    secret: user.totpSecret,
    token: params.token,
    timestampMs,
  });
  if (!result.valid) {
    return {
      confirmed: false,
      recoveryCodes: [],
      error:
        'Код не подошёл. Проверьте, что время на устройстве синхронизировано, '
        + 'и введите текущий код из приложения.',
    };
  }

  const { plain, hashes } = await generateRecoveryCodes();

  await dbTransaction(async (tx) => {
    // Старые коды аннулируются: набор всегда соответствует текущему фактору.
    await tx.recoveryCode.deleteMany({ where: { userId: params.userId } });
    await tx.recoveryCode.createMany({
      data: hashes.map((codeHash) => ({ userId: params.userId, codeHash })),
    });
    await tx.user.update({
      where: { id: params.userId },
      data: {
        totpConfirmedAt: new Date(timestampMs),
        totpLastCounter: result.counter === null ? null : BigInt(result.counter),
      },
    });
  });

  return { confirmed: true, recoveryCodes: plain };
}

export type MfaVerificationKind = 'TOTP' | 'RECOVERY_CODE';

export interface MfaVerification {
  valid: boolean;
  kind: MfaVerificationKind | null;
  /** Сколько кодов восстановления осталось после проверки. */
  recoveryCodesLeft: number | null;
  error?: string;
}

/**
 * Проверка второго фактора: сначала код приложения, затем код восстановления.
 *
 * Использованный шаг TOTP и применённый код восстановления фиксируются,
 * чтобы их нельзя было предъявить повторно.
 */
export async function verifyMfa(params: {
  userId: string;
  token: string;
  now?: Date;
}): Promise<MfaVerification> {
  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    select: {
      totpSecret: true,
      totpConfirmedAt: true,
      totpLastCounter: true,
      recoveryCodes: {
        select: { id: true, codeHash: true, usedAt: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!user?.totpSecret || !user.totpConfirmedAt) {
    return {
      valid: false,
      kind: null,
      recoveryCodesLeft: null,
      error: 'Второй фактор не подключён.',
    };
  }

  const timestampMs = (params.now ?? new Date()).getTime();

  const totp = verifyTotp({
    secret: user.totpSecret,
    token: params.token,
    timestampMs,
    lastUsedCounter:
      user.totpLastCounter === null ? null : Number(user.totpLastCounter),
  });

  if (totp.valid && totp.counter !== null) {
    await prisma.user.update({
      where: { id: params.userId },
      data: { totpLastCounter: BigInt(totp.counter) },
    });
    return {
      valid: true,
      kind: 'TOTP',
      recoveryCodesLeft: user.recoveryCodes.filter((c) => c.usedAt === null).length,
    };
  }

  const match = await matchRecoveryCode({
    input: params.token,
    hashes: user.recoveryCodes.map((c) => ({ hash: c.codeHash, usedAt: c.usedAt })),
  });

  if (match.matched && match.index !== null) {
    const used = user.recoveryCodes[match.index]!;
    await prisma.recoveryCode.update({
      where: { id: used.id },
      data: { usedAt: new Date(timestampMs) },
    });
    const left = user.recoveryCodes.filter(
      (c) => c.usedAt === null && c.id !== used.id,
    ).length;
    return { valid: true, kind: 'RECOVERY_CODE', recoveryCodesLeft: left };
  }

  return {
    valid: false,
    kind: null,
    recoveryCodesLeft: user.recoveryCodes.filter((c) => c.usedAt === null).length,
    error: 'Код не подошёл.',
  };
}

/** Отмечает сессию как прошедшую второй фактор. */
export async function markSessionMfaVerified(sid: string, now = new Date()): Promise<void> {
  await prisma.session.update({
    where: { id: sid },
    data: { mfaVerifiedAt: now, mfaSteppedUpAt: now },
  });
}

/** Отмечает повторное подтверждение перед чувствительной операцией. */
export async function markSessionSteppedUp(sid: string, now = new Date()): Promise<void> {
  await prisma.session.update({
    where: { id: sid },
    data: { mfaSteppedUpAt: now },
  });
}

/**
 * Отключение второго фактора. Требует подтверждения действующим кодом:
 * иначе перехваченная сессия позволила бы снять защиту.
 */
export async function disableMfa(params: {
  userId: string;
  token: string;
  now?: Date;
}): Promise<{ disabled: boolean; error?: string }> {
  const verification = await verifyMfa(params);
  if (!verification.valid) {
    return {
      disabled: false,
      error: verification.error ?? 'Код не подошёл.',
    };
  }

  await dbTransaction(async (tx) => {
    await tx.recoveryCode.deleteMany({ where: { userId: params.userId } });
    await tx.user.update({
      where: { id: params.userId },
      data: { totpSecret: null, totpConfirmedAt: null, totpLastCounter: null },
    });
    // Все сессии теряют признак пройденного второго фактора.
    await tx.session.updateMany({
      where: { userId: params.userId },
      data: { mfaVerifiedAt: null, mfaSteppedUpAt: null },
    });
  });

  return { disabled: true };
}

/** Перевыпуск кодов восстановления взамен израсходованных. */
export async function regenerateRecoveryCodes(params: {
  userId: string;
  token: string;
  now?: Date;
}): Promise<{ codes: string[]; error?: string }> {
  const verification = await verifyMfa(params);
  if (!verification.valid) {
    return { codes: [], error: verification.error ?? 'Код не подошёл.' };
  }

  const { plain, hashes } = await generateRecoveryCodes();
  await dbTransaction(async (tx) => {
    await tx.recoveryCode.deleteMany({ where: { userId: params.userId } });
    await tx.recoveryCode.createMany({
      data: hashes.map((codeHash) => ({ userId: params.userId, codeHash })),
    });
  });
  return { codes: plain };
}
