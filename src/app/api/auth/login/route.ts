import { cookies } from 'next/headers';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { verifyPassword } from '@/lib/auth/password';
import { createSession, sessionCookieOptions, SESSION_COOKIE } from '@/lib/auth/session';
import { writeAudit } from '@/lib/audit';
import { clientIp, handleApiError, jsonError, jsonOk } from '@/lib/http';

const LoginSchema = z.object({
  email: z.email('Некорректный e-mail'),
  password: z.string().min(1, 'Введите пароль'),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const data = LoginSchema.parse(body);
    const email = data.email.trim().toLowerCase();

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

    return jsonOk({ userId: user.id });
  } catch (error) {
    return handleApiError(error);
  }
}
