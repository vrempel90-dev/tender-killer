import { readJson } from '@/lib/security/request';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { verifyPassword, hashPassword } from '@/lib/auth/password';
import { consumeQuota } from '@/lib/security/quota';
import { createSession, sessionCookieOptions, SESSION_COOKIE } from '@/lib/auth/session';
import { evaluateMfaGate } from '@/lib/auth/mfa/policy';
import { writeAudit } from '@/lib/audit';
import { clientIp, handleApiError, jsonError, jsonOk } from '@/lib/http';

const LoginSchema = z.object({
  email: z.email('Некорректный e-mail'),
  password: z.string().min(1, 'Введите пароль').max(256),
});

export async function POST(request: Request) {
  try {
    await consumeQuota('auth-global', 'login', 500, 60);
    const body = await readJson(request);
    const data = LoginSchema.parse(body);
    const email = data.email.trim().toLowerCase();
    await consumeQuota('auth-account', email, 10, 900);

    const user = await prisma.user.findUnique({ where: { email } });

    // Одинаковый ответ для несуществующего пользователя и неверного пароля —
    // чтобы нельзя было перебором выяснить, какие e-mail зарегистрированы.
    const passwordOk = user
      ? await verifyPassword(data.password, user.passwordHash)
      : false;

    if (!user || !passwordOk || !user.isActive) {
      if (user) {
        await writeAudit({
          companyId: user.companyId,
          userId: user.id,
          action: 'USER_LOGIN_FAILED',
          ipAddress: clientIp(request),
        });
      }
      return jsonError('Неверный e-mail или пароль', 401);
    }

    const company = await prisma.company.findUnique({
      where: { id: user.companyId },
      select: { requireMfaForAdmins: true },
    });

    if (!user.passwordHash.startsWith('$argon2id$')) {
      await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(data.password) } });
    }

    const { token, expiresAt } = await createSession({
      userId: user.id,
      companyId: user.companyId,
      role: user.role,
      userAgent: request.headers.get('user-agent'),
      ipAddress: clientIp(request),
    });

    const store = await cookies();
    store.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    await writeAudit({
      companyId: user.companyId,
      userId: user.id,
      action: 'USER_LOGIN',
      ipAddress: clientIp(request),
    });

    // Пароль проверен, но сессия ещё не полная: пока второй фактор не
    // подключён и не подтверждён, guard не пропускает её к данным.
    const gate = evaluateMfaGate({
      role: user.role,
      companyRequiresMfaForAdmins: company?.requireMfaForAdmins ?? true,
      mfaEnabled: user.totpConfirmedAt !== null,
      sessionMfaVerifiedAt: null,
    });

    return jsonOk({
      userId: user.id,
      mfaGate: gate,
      next: gate === 'OK' ? '/dashboard' : '/mfa',
    });
  } catch (error) {
    return handleApiError(error);
  }
}
