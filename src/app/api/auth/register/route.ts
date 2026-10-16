import { readJson } from '@/lib/security/request';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { hashPassword, validatePasswordStrength } from '@/lib/auth/password';
import { createSession, sessionCookieOptions, SESSION_COOKIE } from '@/lib/auth/session';
import { evaluateMfaGate } from '@/lib/auth/mfa/policy';
import { writeAudit } from '@/lib/audit';
import { clientIp, handleApiError, jsonError, jsonOk } from '@/lib/http';
import { cookies } from 'next/headers';
import { consumeQuota } from '@/lib/security/quota';

const RegisterSchema = z.object({
  companyName: z.string().min(2, 'Укажите название компании').max(200),
  bin: z
    .string()
    .regex(/^\d{12}$/, 'БИН/ИИН состоит из 12 цифр')
    .optional()
    .or(z.literal('')),
  taxRegime: z
    .enum([
      'GENERAL_VAT',
      'GENERAL_NO_VAT',
      'SIMPLIFIED',
      'RETAIL_TAX',
      'INDIVIDUAL_ENTREPRENEUR',
    ])
    .default('GENERAL_VAT'),
  name: z.string().min(2, 'Укажите имя').max(120),
  email: z.email('Некорректный e-mail'),
  password: z.string().min(10, 'Пароль должен быть не короче 10 символов').max(256),
});

export async function POST(request: Request) {
  try {
    await consumeQuota('auth-global', 'registration', 40, 3600);
    const body = await readJson(request);
    const data = RegisterSchema.parse(body);

    const strengthError = validatePasswordStrength(data.password);
    if (strengthError) {
      return jsonError(strengthError, 422);
    }

    const email = data.email.trim().toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return jsonError('Пользователь с таким e-mail уже зарегистрирован', 409);
    }

    const isVatPayer = data.taxRegime === 'GENERAL_VAT'
      || data.taxRegime === 'INDIVIDUAL_ENTREPRENEUR';

    const user = await prisma.user.create({
      data: {
        email,
        name: data.name.trim(),
        passwordHash: await hashPassword(data.password),
        role: 'OWNER',
        company: {
          create: {
            name: data.companyName.trim(),
            bin: data.bin && data.bin.length > 0 ? data.bin : null,
            taxRegime: data.taxRegime,
            isVatPayer,
          },
        },
      },
      include: { company: { select: { requireMfaForAdmins: true } } },
    });

    const { token, expiresAt } = await createSession({
      userId: user.id,
      companyId: user.companyId,
      role: user.role,
      userAgent: request.headers.get('user-agent'),
      ipAddress: clientIp(request),
    });

    const store = await cookies();
    store.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));

    await writeAudit({
      companyId: user.companyId,
      userId: user.id,
      action: 'USER_REGISTER',
      entity: 'User',
      entityId: user.id,
      ipAddress: clientIp(request),
    });

    // Владелец компании по умолчанию обязан подключить второй фактор,
    // поэтому следующий шаг после регистрации — /mfa, а не дашборд.
    const gate = evaluateMfaGate({
      role: user.role,
      companyRequiresMfaForAdmins: user.company.requireMfaForAdmins,
      mfaEnabled: false,
      sessionMfaVerifiedAt: null,
    });

    return jsonOk(
      {
        userId: user.id,
        companyId: user.companyId,
        mfaGate: gate,
        next: gate === 'OK' ? '/dashboard' : '/mfa',
      },
      201,
    );
  } catch (error) {
    return handleApiError(error);
  }
}
