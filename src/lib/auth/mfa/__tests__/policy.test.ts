import { describe, expect, it } from 'vitest';
import {
  evaluateMfaGate,
  gateMessage,
  isMfaRequiredForRole,
  needsStepUp,
  STEP_UP_TTL_MS,
} from '../policy';

describe('isMfaRequiredForRole', () => {
  it('требует второй фактор для OWNER и ADMIN', () => {
    expect(isMfaRequiredForRole('OWNER', true)).toBe(true);
    expect(isMfaRequiredForRole('ADMIN', true)).toBe(true);
  });

  it('не требует для аналитика и наблюдателя', () => {
    expect(isMfaRequiredForRole('ANALYST', true)).toBe(false);
    expect(isMfaRequiredForRole('VIEWER', true)).toBe(false);
  });

  it('уважает отключённую настройку компании', () => {
    expect(isMfaRequiredForRole('OWNER', false)).toBe(false);
  });

  it('не считает требованием неизвестную роль', () => {
    expect(isMfaRequiredForRole('SUPERUSER', true)).toBe(false);
  });
});

describe('evaluateMfaGate', () => {
  const base = {
    role: 'OWNER',
    companyRequiresMfaForAdmins: true,
    mfaEnabled: false,
    sessionMfaVerifiedAt: null,
  };

  it('требует подключения, если фактор обязателен и не подключён', () => {
    expect(evaluateMfaGate(base)).toBe('ENROLL_REQUIRED');
  });

  it('требует подтверждения в сессии, если фактор подключён', () => {
    expect(evaluateMfaGate({ ...base, mfaEnabled: true })).toBe('VERIFY_REQUIRED');
  });

  it('пропускает подтверждённую сессию', () => {
    expect(
      evaluateMfaGate({
        ...base,
        mfaEnabled: true,
        sessionMfaVerifiedAt: new Date(),
      }),
    ).toBe('OK');
  });

  it('ГЛАВНОЕ: добровольно подключённый фактор тоже обязателен для сессии', () => {
    // Роль не требует MFA, но пользователь его включил — сессия без
    // подтверждения доступа не получает.
    expect(
      evaluateMfaGate({
        role: 'ANALYST',
        companyRequiresMfaForAdmins: false,
        mfaEnabled: true,
        sessionMfaVerifiedAt: null,
      }),
    ).toBe('VERIFY_REQUIRED');
  });

  it('пропускает роль без требования и без подключённого фактора', () => {
    expect(
      evaluateMfaGate({
        role: 'VIEWER',
        companyRequiresMfaForAdmins: true,
        mfaEnabled: false,
        sessionMfaVerifiedAt: null,
      }),
    ).toBe('OK');
  });

  it('не выпускает администратора, если компания требует фактор, а он выключен', () => {
    expect(
      evaluateMfaGate({
        role: 'ADMIN',
        companyRequiresMfaForAdmins: true,
        mfaEnabled: false,
        sessionMfaVerifiedAt: new Date(),
      }),
    ).toBe('ENROLL_REQUIRED');
  });
});

describe('needsStepUp', () => {
  const now = new Date('2026-10-15T12:00:00Z');

  it('не требует step-up без подключённого фактора', () => {
    expect(
      needsStepUp({ mfaEnabled: false, sessionMfaSteppedUpAt: null, now }),
    ).toBe(false);
  });

  it('требует step-up, если подтверждения не было', () => {
    expect(
      needsStepUp({ mfaEnabled: true, sessionMfaSteppedUpAt: null, now }),
    ).toBe(true);
  });

  it('принимает свежее подтверждение', () => {
    const recent = new Date(now.getTime() - STEP_UP_TTL_MS + 1_000);
    expect(
      needsStepUp({ mfaEnabled: true, sessionMfaSteppedUpAt: recent, now }),
    ).toBe(false);
  });

  it('отклоняет просроченное подтверждение', () => {
    const stale = new Date(now.getTime() - STEP_UP_TTL_MS - 1_000);
    expect(
      needsStepUp({ mfaEnabled: true, sessionMfaSteppedUpAt: stale, now }),
    ).toBe(true);
  });

  it('граница ровно в TTL ещё действительна', () => {
    const edge = new Date(now.getTime() - STEP_UP_TTL_MS);
    expect(
      needsStepUp({ mfaEnabled: true, sessionMfaSteppedUpAt: edge, now }),
    ).toBe(false);
  });
});

describe('gateMessage', () => {
  it('различает подключение и подтверждение', () => {
    expect(gateMessage('ENROLL_REQUIRED')).toMatch(/Подключите/);
    expect(gateMessage('VERIFY_REQUIRED')).toMatch(/Подтвердите/);
  });
});
