import { describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { hashPassword, verifyPassword, validatePasswordStrength } from '../password';

describe('password migration', () => {
  it('uses Argon2id and retains verification of existing bcrypt users', async () => {
    const hash = await hashPassword('correct-password-123');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword('correct-password-123', hash)).toBe(true);
    expect(await verifyPassword('incorrect-password-123', hash)).toBe(false);
    expect(await verifyPassword('legacy-123', await bcrypt.hash('legacy-123', 4))).toBe(true);
  });
  it('bounds password length before hashing', () => expect(validatePasswordStrength('a1'.repeat(200))).not.toBeNull());
});
