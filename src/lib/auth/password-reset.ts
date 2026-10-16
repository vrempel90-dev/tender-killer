import { dbTransaction, prisma } from '../db';
import { RequestError } from '../security/request';
import { hashPassword, validatePasswordStrength } from './password';
import { createResetSecret, hashResetSecret, RESET_TTL_MS, resetLink } from './password-reset-policy';
import { passwordResetEmail } from '../email/password-reset-template';
import { sendResetEmail } from '../email/transport';

const invalid = () => new RequestError('Ссылка недействительна или устарела. Запросите новую.', 400);

/** After the uniform response: delivery latency cannot enumerate accounts. */
export async function issuePasswordReset(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true, isActive: true, authVersion: true } });
  if (!user?.isActive) return;
  const { token, tokenHash } = createResetSecret();
  const record = await prisma.passwordResetToken.create({ data: {
    userId: user.id, tokenHash, authVersion: user.authVersion, expiresAt: new Date(Date.now() + RESET_TTL_MS),
  } });
  try {
    await sendResetEmail({ to: user.email, id: record.id, ...passwordResetEmail(resetLink(token)) });
    await dbTransaction(async tx => {
      const users = await tx.$queryRaw<Array<{ authVersion: number; isActive: boolean }>>`
        SELECT "authVersion", "isActive" FROM users WHERE id = ${user.id} FOR UPDATE`;
      if (!users[0]?.isActive || users[0].authVersion !== user.authVersion) return;
      const now = new Date();
      // An unsuccessful resend never invalidates the last delivered link.
      await tx.passwordResetToken.updateMany({ where: { userId: user.id, sentAt: { not: null }, usedAt: null }, data: { usedAt: now } });
      await tx.passwordResetToken.update({ where: { id: record.id }, data: { sentAt: now } });
    });
  } catch {
    await prisma.passwordResetToken.deleteMany({ where: { id: record.id, sentAt: null } });
    console.error(JSON.stringify({ event: 'password_reset_delivery_failed' }));
  }
}

export async function completePasswordReset(token: string, password: string): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(token)) throw invalid();
  const strength = validatePasswordStrength(password);
  if (strength) throw new RequestError(strength, 422);
  const tokenHash = hashResetSecret(token);
  const candidate = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
  if (!candidate || !candidate.sentAt || candidate.usedAt || candidate.expiresAt.getTime() <= Date.now()) throw invalid();
  const passwordHash = await hashPassword(password);
  await dbTransaction(async tx => {
    // All resets for one user serialize here, including different tokens.
    const users = await tx.$queryRaw<Array<{ authVersion: number; isActive: boolean }>>`
      SELECT "authVersion", "isActive" FROM users WHERE id = ${candidate.userId} FOR UPDATE`;
    if (!users[0]?.isActive || users[0].authVersion !== candidate.authVersion) throw invalid();
    const now = new Date();
    const claimed = await tx.passwordResetToken.updateMany({
      where: { id: candidate.id, usedAt: null, sentAt: { not: null }, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) throw invalid();
    await tx.user.update({ where: { id: candidate.userId }, data: { passwordHash, authVersion: { increment: 1 } } });
    await tx.session.updateMany({ where: { userId: candidate.userId, revokedAt: null }, data: { revokedAt: now } });
    await tx.passwordResetToken.updateMany({ where: { userId: candidate.userId, usedAt: null }, data: { usedAt: now } });
    // MFA secrets, recovery codes, roles and company data are preserved.
  });
}
