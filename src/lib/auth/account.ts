import { Prisma } from '@prisma/client';
import { dbTransaction, prisma } from '../db';
import { AuthError } from './guard';
import { verifyPassword } from './password';
import type { VerifiedSession } from './session';

/** Reauthentication is bound to the live user, never a caller-supplied ID. */
export async function reauthenticate(session: VerifiedSession, password: string) {
  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user?.isActive || !(await verifyPassword(password, user.passwordHash))) {
    throw new AuthError('Неверный пароль', 401);
  }
  return user;
}

export async function revokeAllSessions(session: VerifiedSession, password: string) {
  const user = await reauthenticate(session, password);
  await dbTransaction(async tx => {
    const changed = await tx.user.updateMany({
      where: { id: user.id, passwordHash: user.passwordHash, authVersion: user.authVersion, isActive: true },
      data: { authVersion: { increment: 1 } },
    });
    if (changed.count !== 1) throw new AuthError('Войдите заново и повторите действие', 401);
    await tx.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.passwordResetToken.deleteMany({ where: { userId: user.id } });
  });
}

export async function deleteOwnAccount(session: VerifiedSession, password: string) {
  const user = await reauthenticate(session, password);
  await dbTransaction(async tx => {
    // Serialize owner departures for this company, then resets/session revocation.
    await tx.$queryRaw`SELECT id FROM companies WHERE id = ${session.companyId} FOR UPDATE`;
    const live = await tx.$queryRaw<Array<{ passwordHash: string; authVersion: number; role: string }>>`
      SELECT "passwordHash", "authVersion", role FROM users
      WHERE id = ${user.id} AND "companyId" = ${session.companyId} AND "isActive" = true FOR UPDATE`;
    if (!live[0] || live[0].passwordHash !== user.passwordHash || live[0].authVersion !== user.authVersion) {
      throw new AuthError('Войдите заново и повторите действие', 401);
    }
    if (live[0].role === 'OWNER') {
      const others = await tx.user.findMany({ where: { companyId: session.companyId, id: { not: user.id }, isActive: true }, select: { role: true } });
      if (others.length && !others.some(other => other.role === 'OWNER')) {
        throw new AuthError('Сначала передайте владение компанией другому участнику через администратора. Удаление последнего владельца оставит коллег без управления.', 409);
      }
    }
    const active = await tx.session.findFirst({ where: { id: session.sid, userId: user.id, authVersion: user.authVersion, revokedAt: null, expiresAt: { gt: new Date() } } });
    if (!active) throw new AuthError('Войдите заново и повторите действие', 401);

    // Company records belong to the company. Remove attribution only.
    await tx.document.updateMany({ where: { companyId: session.companyId, uploadedById: user.id }, data: { uploadedById: null } });
    await tx.procurementImport.updateMany({ where: { companyId: session.companyId, importedById: user.id }, data: { importedById: null } });
    await tx.savedSearch.updateMany({ where: { companyId: session.companyId, createdById: user.id }, data: { createdById: null } });
    await tx.aiAnalysisJob.updateMany({ where: { companyId: session.companyId, userId: user.id }, data: { userId: 'deleted' } });
    await tx.companyTaxRate.updateMany({ where: { companyId: session.companyId, confirmedBy: user.id }, data: { confirmedBy: 'deleted' } });
    await tx.tenderWatch.updateMany({ where: { companyId: session.companyId, watchedById: user.id }, data: { watchedById: null } });
    await tx.watchSnapshot.updateMany({ where: { watch: { companyId: session.companyId }, capturedById: user.id }, data: { capturedById: null } });
    await tx.watchChange.updateMany({ where: { watch: { companyId: session.companyId }, acknowledgedById: user.id }, data: { acknowledgedById: null } });
    // Finance writes lock the model row too. Read provenance only after taking
    // that lock so a colleague's concurrent calculation cannot be overwritten.
    const models = await tx.$queryRaw<Array<{ id: string; provenance: Prisma.JsonValue }>>`
      SELECT f.id, f.provenance FROM financial_models f JOIN tenders t ON t.id=f."tenderId"
      WHERE t."companyId"=${session.companyId} FOR UPDATE OF f`;
    for (const model of models) {
      if (!model.provenance || typeof model.provenance !== 'object' || Array.isArray(model.provenance)) continue;
      const evidence = model.provenance as Record<string, Prisma.JsonValue>;
      let changed = false;
      for (const [field, value] of Object.entries(evidence)) {
        if (value && typeof value === 'object' && !Array.isArray(value) && value.source === `user:${user.id}`) {
          evidence[field] = { ...value, source: 'user:deleted' }; changed = true;
        }
      }
      if (changed) await tx.financialModel.update({ where: { id: model.id }, data: { provenance: evidence as Prisma.InputJsonObject } });
    }
    await tx.auditLog.updateMany({ where: { companyId: session.companyId, OR: [{ userId: user.id }, { entity: 'User', entityId: user.id }] }, data: {
      userId: null, entityId: null, ipAddress: null, metadata: Prisma.DbNull,
    } });
    // Cascades remove sessions, reset tokens and recovery codes; company is retained.
    await tx.user.delete({ where: { id: user.id } });
    await tx.auditLog.create({ data: { companyId: session.companyId, action: 'USER_ACCOUNT_DELETED' } });
  });
}
