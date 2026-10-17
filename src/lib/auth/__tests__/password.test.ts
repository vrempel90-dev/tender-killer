import { describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { hashPassword, verifyPassword, verifyLoginPassword, validatePasswordStrength } from '../password';

describe('password migration', () => {
  it('uses Argon2id and retains verification of existing bcrypt users', async () => {
    const hash = await hashPassword('correct-password-123');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword('correct-password-123', hash)).toBe(true);
    expect(await verifyPassword('incorrect-password-123', hash)).toBe(false);
    expect(await verifyPassword('legacy-123', await bcrypt.hash('legacy-123', 4))).toBe(true);
  });
  it('bounds password length before hashing', () => expect(validatePasswordStrength('a1'.repeat(200))).not.toBeNull());
  it('verifies known credentials and always rejects missing accounts through the hashing path', async () => {
    const hash = await hashPassword('Synthetic-Password-123');
    expect(await verifyLoginPassword('Synthetic-Password-123', hash)).toBe(true);
    expect(await verifyLoginPassword('wrong', hash)).toBe(false);
    expect(await verifyLoginPassword('Synthetic-Password-123', null)).toBe(false);
    expect(await verifyLoginPassword('wrong', null)).toBe(false);
  });
});
