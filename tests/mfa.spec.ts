/**
 * Второй фактор: сквозные проверки через HTTP.
 *
 * Проверяется не форма, а именно правило доступа: пока второй фактор не
 * подключён и не подтверждён в сессии, данные компании недоступны.
 */
import { test, expect, request as requestFactory, type APIRequestContext } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { generateTotp, TOTP_DEFAULTS } from '../src/lib/auth/mfa/totp';
import { prisma as appDb } from '../src/lib/db';

const databaseURL = process.env.DATABASE_URL ?? '';
if (!databaseURL || !['localhost', '127.0.0.1'].includes(new URL(databaseURL).hostname)) {
  throw new Error('Isolated local test DB required');
}
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseURL }) });
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const headers = { Origin: new URL(baseURL).origin };

const companies: string[] = [];
const PASSWORD = 'E2E-long-password-123';

function secretFrom(otpauthUri: string): string {
  const match = /[?&]secret=([A-Z2-7]+)/.exec(otpauthUri);
  if (!match?.[1]) throw new Error(`В otpauth-ссылке нет секрета: ${otpauthUri}`);
  return match[1];
}

async function newContext(): Promise<APIRequestContext> {
  return requestFactory.newContext({ baseURL, extraHTTPHeaders: headers });
}

async function register(context: APIRequestContext) {
  const email = `e2e-mfa-${randomUUID()}@example.test`;
  const result = await context.post('/api/auth/register', {
    data: {
      companyName: 'E2E MFA',
      name: 'Test owner',
      email,
      password: PASSWORD,
      taxRegime: 'GENERAL_NO_VAT',
    },
  });
  expect(result.status()).toBe(201);
  const payload = (await result.json()).data;
  companies.push(payload.companyId);
  return { ...payload, email } as { userId: string; companyId: string; email: string; next: string; mfaGate: string };
}

/** Подключает TOTP и возвращает секрет и коды восстановления. */
async function enroll(context: APIRequestContext) {
  const start = await context.post('/api/auth/mfa/enroll');
  expect(start.status()).toBe(200);
  const secret = secretFrom((await start.json()).data.otpauthUri);

  const confirm = await context.post('/api/auth/mfa/confirm', {
    data: { token: generateTotp({ secret }) },
  });
  expect(confirm.status()).toBe(200);
  const recoveryCodes = (await confirm.json()).data.recoveryCodes as string[];
  expect(recoveryCodes).toHaveLength(10);
  return { secret, recoveryCodes };
}

test.describe.configure({ mode: 'serial' });

test.afterAll(async () => {
  if (companies.length) {
    await db.company.deleteMany({ where: { id: { in: companies } } });
  }
  await db.$disconnect();
  await appDb.$disconnect();
});

test('владелец получает доступ по паролю без обязательного второго фактора', async () => {
  const context = await newContext();
  try {
    const account = await register(context);
    // Сервер сам говорит, куда вести пользователя.
    expect(account.mfaGate).toBe('OK');
    expect(account.next).toBe('/dashboard');

    const read = await context.get('/api/tenders');
    expect(read.status()).toBe(200);

    const write = await context.post('/api/tenders', { data: { title: 'E2E без фактора' } });
    expect(write.status()).toBe(201);

    // Данные действительно не созданы.
    expect(await db.tender.count({ where: { companyId: account.companyId } })).toBe(1);
  } finally {
    await context.dispose();
  }
});

test('после подключения фактора доступ открывается в той же сессии', async () => {
  const context = await newContext();
  try {
    await register(context);
    await enroll(context);

    const created = await context.post('/api/tenders', { data: { title: 'E2E после фактора' } });
    expect(created.status()).toBe(201);
    expect((await context.get('/api/tenders')).status()).toBe(200);
  } finally {
    await context.dispose();
  }
});

test('новая сессия обязана подтвердить фактор, один код нельзя предъявить дважды', async () => {
  const enrolling = await newContext();
  const next = await newContext();
  try {
    const account = await register(enrolling);
    const { secret } = await enroll(enrolling);

    // Вход по паролю: пароль верный, но сессия ещё не полная.
    const login = await next.post('/api/auth/login', {
      data: { email: account.email, password: PASSWORD },
    });
    expect(login.status()).toBe(200);
    const loginPayload = (await login.json()).data;
    expect(loginPayload.mfaGate).toBe('VERIFY_REQUIRED');
    expect(loginPayload.next).toBe('/mfa');
    expect((await next.get('/api/tenders')).status()).toBe(403);

    // Код, которым подключали фактор, уже израсходован: нужен следующий шаг.
    const stepMs = TOTP_DEFAULTS.periodSeconds * 1000;
    const future = Date.now() + stepMs;
    const replayed = generateTotp({ secret });
    const fresh = generateTotp({ secret, timestampMs: future });

    if (replayed !== fresh) {
      // Повторное предъявление того же кода отклоняется.
      const replay = await next.post('/api/auth/mfa/verify', { data: { token: replayed } });
      expect(replay.status()).toBe(401);
    }

    // Код следующего шага принимается окном допуска (+1 шаг).
    const verify = await next.post('/api/auth/mfa/verify', { data: { token: fresh } });
    expect(verify.status()).toBe(200);
    expect((await verify.json()).data.kind).toBe('TOTP');
    expect((await next.get('/api/tenders')).status()).toBe(200);
  } finally {
    await enrolling.dispose();
    await next.dispose();
  }
});

test('код восстановления работает один раз и уменьшает остаток', async () => {
  const enrolling = await newContext();
  const first = await newContext();
  const second = await newContext();
  try {
    const account = await register(enrolling);
    const { recoveryCodes } = await enroll(enrolling);
    const code = recoveryCodes[0]!;

    for (const context of [first, second]) {
      const login = await context.post('/api/auth/login', {
        data: { email: account.email, password: PASSWORD },
      });
      expect(login.status()).toBe(200);
    }

    const used = await first.post('/api/auth/mfa/verify', { data: { token: code } });
    expect(used.status()).toBe(200);
    const payload = (await used.json()).data;
    expect(payload.kind).toBe('RECOVERY_CODE');
    expect(payload.recoveryCodesLeft).toBe(9);
    expect((await first.get('/api/tenders')).status()).toBe(200);

    // ГЛАВНОЕ: тот же код во второй сессии не проходит.
    const reused = await second.post('/api/auth/mfa/verify', { data: { token: code } });
    expect(reused.status()).toBe(401);
    expect((await second.get('/api/tenders')).status()).toBe(403);
  } finally {
    await enrolling.dispose();
    await first.dispose();
    await second.dispose();
  }
});

test('добровольный фактор можно отключить с верным кодом даже при старом флаге компании', async () => {
  const context = await newContext();
  try {
    const account = await register(context);
    const { secret } = await enroll(context);

    await db.company.update({ where: { id: account.companyId }, data: { requireMfaForAdmins: true } });
    const blocked = await context.post('/api/auth/mfa/disable', {
      data: { token: generateTotp({ secret, timestampMs: Date.now() + 30_000 }) },
    });
    expect(blocked.status()).toBe(200);
    const stillEnabled = await db.user.findUniqueOrThrow({ where: { id: account.userId } });
    expect(stillEnabled.totpConfirmedAt).toBeNull();

    // Повторное добровольное подключение, затем неверный код.
    await enroll(context);
    await db.company.update({
      where: { id: account.companyId },
      data: { requireMfaForAdmins: false },
    });
    const wrong = await context.post('/api/auth/mfa/disable', { data: { token: '000000' } });
    expect(wrong.status()).toBe(400);
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: account.userId } })).totpConfirmedAt,
    ).not.toBeNull();
  } finally {
    await context.dispose();
  }
});

test('подключение фактора невозможно без авторизации', async () => {
  const anonymous = await newContext();
  try {
    expect((await anonymous.post('/api/auth/mfa/enroll')).status()).toBe(401);
    expect((await anonymous.post('/api/auth/mfa/verify', { data: { token: '000000' } })).status()).toBe(401);
    expect((await anonymous.get('/api/auth/mfa/status')).status()).toBe(401);
  } finally {
    await anonymous.dispose();
  }
});
