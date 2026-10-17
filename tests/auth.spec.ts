import { test, expect, request as requestFactory } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { generateTotp } from '../src/lib/auth/mfa/totp';

const dbURL = process.env.DATABASE_URL ?? '';
if (!dbURL || !['localhost', '127.0.0.1'].includes(new URL(dbURL).hostname)) throw new Error('Isolated local DB required');
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: dbURL }) });
test.afterAll(() => db.$disconnect());

test('registration, first login, logout, second login, uniform 401 and mandatory MFA', async ({ request }) => {
  const email = `auth-${randomUUID()}@example.test`, password = `Synthetic-${randomUUID()}-123`;
  const wrongPassword = randomUUID();
  const registered = await request.post('/api/auth/register', { data: {
    companyName: 'Synthetic staging company', name: 'Synthetic owner', email: ` ${email.toUpperCase()} `,
    password, taxRegime: 'GENERAL_NO_VAT',
  } });
  expect(registered.status()).toBe(201);
  const account = (await registered.json()).data;
  try {
    expect(account).toMatchObject({ mfaGate: 'ENROLL_REQUIRED', next: '/mfa' });
    expect((await request.get('/api/tenders')).status()).toBe(403);
    expect((await request.post('/api/auth/logout')).status()).toBe(200);
    expect((await request.get('/api/tenders')).status()).toBe(401);
    const first = await request.post('/api/auth/login', { data: { email, password } });
    expect(first.status()).toBe(200);
    expect((await first.json()).data).toMatchObject({ mfaGate: 'ENROLL_REQUIRED', next: '/mfa' });
    expect((await request.get('/login', { maxRedirects: 0 })).headers().location).toBe('/mfa');
    const start = await request.post('/api/auth/mfa/enroll');
    expect(start.status()).toBe(200);
    const secret = new URL((await start.json()).data.otpauthUri).searchParams.get('secret')!;
    const confirm = await request.post('/api/auth/mfa/confirm', { data: { token: generateTotp({ secret }) } });
    expect(confirm.status()).toBe(200);
    const codes = (await confirm.json()).data.recoveryCodes;
    expect((await request.get('/api/tenders')).status()).toBe(200);
    const oldCookies = (await request.storageState()).cookies;
    await request.post('/api/auth/logout');
    const wrong = await request.post('/api/auth/login', { data: { email, password: wrongPassword } });
    const missing = await request.post('/api/auth/login', { data: { email: `missing-${randomUUID()}@example.test`, password } });
    expect(wrong.status()).toBe(401); expect(missing.status()).toBe(401);
    expect(await wrong.json()).toEqual(await missing.json());
    expect(wrong.headers()['set-cookie']).toBeUndefined();
    expect(missing.headers()['set-cookie']).toBeUndefined();
    const second = await request.post('/api/auth/login', { data: { email: email.toUpperCase(), password } });
    expect(second.status()).toBe(200);
    expect((await second.json()).data).toMatchObject({ mfaGate: 'VERIFY_REQUIRED', next: '/mfa' });
    expect((await request.get('/api/tenders')).status()).toBe(403);
    expect((await request.post('/api/auth/mfa/verify', { data: { token: codes[0] } })).status()).toBe(200);
    expect((await request.get('/api/tenders')).status()).toBe(200);
    // A revoked cookie cannot regain access after a fresh login.
    expect(await db.session.count({ where: { userId: account.userId, revokedAt: { not: null } } })).toBe(2);
    const stale = await requestFactory.newContext({ baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
      storageState: { cookies: oldCookies, origins: [] } });
    try { expect((await stale.get('/api/tenders')).status()).toBe(401); }
    finally { await stale.dispose(); }
  } finally { await db.company.delete({ where: { id: account.companyId } }); }
});

test('real shared SQL quotas preserve ten attempts and expose actual retry time for known and unknown accounts', async ({ request }) => {
  const email = `quota-${randomUUID()}@example.test`, password = `Synthetic-${randomUUID()}-123`;
  const reg = await request.post('/api/auth/register', { data: { companyName: 'Quota test', name: 'Test owner', email, password } });
  expect(reg.status()).toBe(201);
  const companyId = (await reg.json()).data.companyId;
  await request.post('/api/auth/logout');
  try {
    for (const address of [email, `absent-${randomUUID()}@example.test`]) {
      for (let i = 0; i < 10; i++) {
        expect((await request.post('/api/auth/login', { data: { email: address, password: 'Wrong-123' } })).status()).toBe(401);
      }
      const blocked = await request.post('/api/auth/login', { data: { email: address, password } });
      expect(blocked.status()).toBe(429);
      const seconds = Number(blocked.headers()['retry-after']);
      expect(seconds).toBeGreaterThan(0); expect(seconds).toBeLessThanOrEqual(900);
      expect(await blocked.json()).toMatchObject({ details: { retryAfterSeconds: seconds },
        error: `Слишком много попыток входа. Попробуйте через ${Math.ceil(seconds / 60)} минут` });
      expect(blocked.headers()['set-cookie']).toBeUndefined();
    }
  } finally { await db.company.delete({ where: { id: companyId } }); }
});

test('browser shows 401 and respects Retry-After until it expires', async ({ page }) => {
  // Browser-only fast clock: no production test switches, no server quota bypass.
  await page.clock.install();
  await page.route('**/api/auth/login', route => route.fulfill({ status: 401, contentType: 'application/json',
    body: JSON.stringify({ ok: false, error: 'Неверный e-mail или пароль' }) }));
  await page.goto('/login');
  await page.getByLabel('E-mail').fill('synthetic@example.test');
  await page.getByLabel('Пароль', { exact: true }).fill('Synthetic-123');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.locator('form').getByRole('alert')).toContainText('Неверный e-mail или пароль');
  await page.unroute('**/api/auth/login');
  await page.route('**/api/auth/login', route => route.fulfill({ status: 429, contentType: 'application/json',
    headers: { 'Retry-After': '61' }, body: JSON.stringify({ ok: false }) }));
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.locator('form').getByRole('alert')).toContainText('Попробуйте через 2 минут');
  await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeDisabled();
  await page.clock.fastForward(62_000);
  await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeEnabled();
  await expect(page.locator('form').getByRole('alert')).toHaveCount(0);
});
