import { describe, expect, it } from 'vitest';
import { evaluateMfaGate, gateMessage, isMfaRequiredForRole, needsStepUp } from '../policy';

describe('password-only authentication policy', () => {
  it.each(['OWNER', 'ADMIN', 'ANALYST', 'VIEWER'])('does not mandate MFA for %s', (role) => {
    expect(isMfaRequiredForRole(role, true)).toBe(false);
    expect(isMfaRequiredForRole(role, false)).toBe(false);
  });

  it.each([false, true])('allows login regardless of existing TOTP enrollment (%s)', (mfaEnabled) => {
    expect(evaluateMfaGate({
      role: 'OWNER', companyRequiresMfaForAdmins: true,
      mfaEnabled, sessionMfaVerifiedAt: null,
    })).toBe('OK');
  });

  it('does not require MFA step-up for password-authenticated sessions', () => {
    expect(needsStepUp({ mfaEnabled: true, sessionMfaSteppedUpAt: null })).toBe(false);
  });

  it('keeps legacy gate messages for backwards compatibility', () => {
    expect(gateMessage('ENROLL_REQUIRED')).toMatch(/Подключите/);
    expect(gateMessage('VERIFY_REQUIRED')).toMatch(/Подтвердите/);
  });
});
