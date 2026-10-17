import { describe, expect, it } from 'vitest';
import {
  evaluateMfaGate,
  gateMessage,
  isMfaRequiredForRole,
  needsStepUp,
  STEP_UP_TTL_MS,
} from '../policy';

describe('isMfaRequiredForRole', () => {
  it('не требует подключения для OWNER и ADMIN даже со старым флагом', () => {
    expect(isMfaRequiredForRole('OWNER', true)).toBe(false);
    expect(isMfaRequiredForRole('ADMIN', true)).toBe(false);
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

  it('пропускает владельца без добровольно подключённого фактора', () => {
    expect(evaluateMfaGate(base)).toBe('OK');
  });

  it('требует подтверждения в сессии, если фактор подключён', () => {
    expect(evaluateMfaGate({ ...base, mfaEnabled: true })).toBe('OK');
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
    ).toBe('OK');
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

  it('не блокирует администратора старым флагом компании', () => {
    expect(
      evaluateMfaGate({
        role: 'ADMIN',
        companyRequiresMfaForAdmins: true,
        mfaEnabled: false,
        sessionMfaVerifiedAt: new Date(),
      }),
    ).toBe('OK');
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
    ).toBe(false);
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
    ).toBe(false);
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
