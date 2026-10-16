import { test, expect, request as requests, type APIRequestContext } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createHash, randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { generateTotp } from '../src/lib/auth/mfa/totp';
import { hashPassword } from '../src/lib/auth/password';

const dbUrl = process.env.DATABASE_URL ?? '';
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const sink = process.env.EMAIL_TEST_URL ?? '';
if (!['127.0.0.1', 'localhost'].includes(new URL(dbUrl).hostname)
  || !sink.startsWith('http://127.0.0.1:')) throw new Error('Isolated local DB and email sink required');
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: dbUrl }) });
const companies: string[] = [];
const oldPassword = 'Original-password-123';
const newPassword = 'Replacement-password-456';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const headers = () => ({ Origin: new URL(baseURL).origin, 'X-Forwarded-For': '192.0.2.' + (10 + Math.floor(Math.random() * 200)) });
const sinkUrl = (path: string) => new URL(path, sink).toString();
async function register(ctx: APIRequestContext) {
  const email = randomUUID() + '@example.test';
  const created = await db.user.create({ data: { email, passwordHash: await hashPassword(oldPassword), name: 'Test owner',
    company: { create: { name: 'Password recovery test', taxRegime: 'GENERAL_NO_VAT' } } } });
  const user = { userId: created.id, companyId: created.companyId };
  const response = await ctx.post('/api/auth/login', { data: { email, password: oldPassword } });
  expect(response.status()).toBe(200);
  companies.push(user.companyId);
  return { ...user, email } as { userId: string; companyId: string; email: string };
}
async function resetToken(ctx: APIRequestContext, email: string) {
  const before = (await (await fetch(sinkUrl('/messages?to=' + encodeURIComponent(email)))).json()).length;
  const response = await ctx.post('/api/auth/forgot-password', { headers: headers(), data: { email } });
  expect(response.status()).toBe(200);
  let mail: { text: string } | undefined;
  await expect.poll(async () => {
    const list = await (await fetch(sinkUrl('/messages?to=' + encodeURIComponent(email)))).json();
    if (list.length > before) mail = list.at(-1);
    return list.length;
  }).toBeGreaterThan(before);
  const token = /token=([a-f0-9]{64})/.exec(mail!.text)?.[1];
  expect(token).toBeTruthy();
  await expect.poll(async () => Boolean((await db.passwordResetToken.findUnique({ where: { tokenHash: hash(token!) } }))?.sentAt)).toBe(true);
  return token!;
}
const complete = (ctx: APIRequestContext, token: string, password = newPassword) => ctx.post('/api/auth/reset-password', {
  headers: headers(), data: { token, password, confirmPassword: password },
});
test.describe.configure({ mode: 'serial' });
test.afterAll(async () => { await db.company.deleteMany({ where: { id: { in: companies } } }); await db.$disconnect(); });

test('uniform responses for existing/missing addresses; only hashes and 30-minute expiry in DB', async ({ request }) => {
  const user = await register(request);
  const a = await request.post('/api/auth/forgot-password', { headers: headers(), data: { email: user.email } });
  const b = await request.post('/api/auth/forgot-password', { headers: headers(), data: { email: randomUUID() + '@example.test' } });
  expect(a.status()).toBe(200); expect(await a.json()).toEqual(await b.json());
  const token = await resetToken(request, user.email);
  const row = await db.passwordResetToken.findUniqueOrThrow({ where: { tokenHash: hash(token) } });
  expect(JSON.stringify(row)).not.toContain(token);
  expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBeGreaterThan(29 * 60_000);
  expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBeLessThanOrEqual(30 * 60_000 + 1000);
});
test('one-time reset revokes all sessions, preserves MFA, rejects old password and requires MFA on new login', async ({ request }) => {
  const user = await register(request);
  const secret = 'JBSWY3DPEHPK3PXP';
  await db.user.update({ where: { id: user.userId }, data: { totpSecret: secret, totpConfirmedAt: new Date() } });
  const oldSession = (await request.storageState()).cookies;
  const token = await resetToken(request, user.email);
  expect((await complete(request, token)).status()).toBe(200);
  expect((await complete(request, token)).status()).toBe(400);
  expect(await db.session.count({ where: { userId: user.userId, revokedAt: null } })).toBe(0);
  expect(await db.user.findUnique({ where: { id: user.userId } })).toMatchObject({ totpSecret: secret, authVersion: 1 });
  const stale = await requests.newContext({ baseURL, extraHTTPHeaders: headers(), storageState: { cookies: oldSession, origins: [] } });
  expect((await stale.get('/api/auth/mfa/status')).status()).toBe(401); await stale.dispose();
  expect((await request.post('/api/auth/login', { data: { email: user.email, password: oldPassword } })).status()).toBe(401);
  const login = await request.post('/api/auth/login', { data: { email: user.email, password: newPassword } });
  expect(login.status()).toBe(200); expect((await login.json()).data.mfaGate).toBe('VERIFY_REQUIRED');
  expect((await request.post('/api/auth/mfa/verify', { data: { token: generateTotp({ secret }) } })).status()).toBe(200);
});
test('expired, disabled-account, unsent and malformed links cannot change password', async ({ request }) => {
  const user = await register(request), token = await resetToken(request, user.email);
  await db.passwordResetToken.update({ where: { tokenHash: hash(token) }, data: { expiresAt: new Date(Date.now() - 1) } });
  expect((await complete(request, token)).status()).toBe(400);
  await db.passwordResetToken.update({ where: { tokenHash: hash(token) }, data: { expiresAt: new Date(Date.now() + 60000), sentAt: null } });
  expect((await complete(request, token)).status()).toBe(400);
  await db.passwordResetToken.update({ where: { tokenHash: hash(token) }, data: { sentAt: new Date() } });
  await db.user.update({ where: { id: user.userId }, data: { isActive: false } });
  expect((await complete(request, token)).status()).toBe(400);
  expect((await complete(request, 'invalid')).status()).toBe(422);
  expect((await db.user.findUniqueOrThrow({ where: { id: user.userId } })).authVersion).toBe(0);
});
test('simultaneous use of one link succeeds exactly once', async ({ request }) => {
  const user = await register(request), token = await resetToken(request, user.email);
  const result = await Promise.all([complete(request, token), complete(request, token)]);
  expect(result.map(r => r.status()).sort()).toEqual([200, 400]);
});
test('a concurrent old-password session issued after reset is invalidated by authVersion', async ({ request }) => {
  const user = await register(request), token = await resetToken(request, user.email);
  expect((await complete(request, token)).status()).toBe(200);
  const raw = randomUUID(), expiresAt = new Date(Date.now() + 60000);
  const session = await db.session.create({ data: { userId: user.userId, tokenHash: hash(raw), expiresAt, authVersion: 0 } });
  const jwt = await new SignJWT({ userId: user.userId, companyId: user.companyId, role: 'OWNER', sid: session.id, raw })
    .setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1m').sign(new TextEncoder().encode(process.env.SESSION_SECRET));
  const ctx = await requests.newContext({ baseURL, extraHTTPHeaders: { ...headers(), Cookie: 'tk_session=' + jwt } });
  try { expect((await ctx.get('/api/auth/mfa/status')).status()).toBe(401); } finally { await ctx.dispose(); }
});
test('provider failure keeps previous delivered link valid and never changes password', async ({ request }) => {
  const user = await register(request), token = await resetToken(request, user.email);
  await fetch(sinkUrl('/failure'), { method: 'POST', body: JSON.stringify({ email: user.email, enabled: true }) });
  const failed = await request.post('/api/auth/forgot-password', { headers: headers(), data: { email: user.email } });
  expect(failed.status()).toBe(200);
  await expect.poll(async () => (await (await fetch(sinkUrl('/failures?to=' + encodeURIComponent(user.email)))).json()).count).toBe(1);
  // Wait until after() has attempted delivery and discarded the unsent token.
  await expect.poll(async () => await db.passwordResetToken.count({ where: { userId: user.userId, sentAt: null } })).toBe(0);
  expect((await db.user.findUniqueOrThrow({ where: { id: user.userId } })).authVersion).toBe(0);
  expect((await complete(request, token)).status()).toBe(200);
});
test('a successful resend invalidates older delivered links', async ({ request }) => {
  const user = await register(request), first = await resetToken(request, user.email), second = await resetToken(request, user.email);
  expect((await complete(request, first)).status()).toBe(400);
  expect((await complete(request, second)).status()).toBe(200);
});
test('account rate limit applies to missing accounts; IP limit applies across accounts', async ({ request }) => {
  const email = randomUUID() + '@example.test';
  for (let n = 0; n < 3; n++) expect((await request.post('/api/auth/forgot-password', { headers: headers(), data: { email } })).status()).toBe(200);
  expect((await request.post('/api/auth/forgot-password', { headers: headers(), data: { email } })).status()).toBe(429);
  for (let n = 0; n < 10; n++) expect((await request.post('/api/auth/forgot-password', { headers: { ...headers(), 'X-Forwarded-For': '198.51.100.222' }, data: { email: randomUUID() + '@example.test' } })).status()).toBe(200);
  expect((await request.post('/api/auth/forgot-password', { headers: { ...headers(), 'X-Forwarded-For': '198.51.100.222' }, data: { email: randomUUID() + '@example.test' } })).status()).toBe(429);
});
test('CSRF, invalid email, weak and mismatched passwords are rejected', async ({ request }) => {
  expect((await request.post('/api/auth/forgot-password', { headers: { Origin: 'https://evil.test' }, data: { email: 'x@example.test' } })).status()).toBe(403);
  expect((await request.post('/api/auth/forgot-password', { headers: headers(), data: { email: 'bad' } })).status()).toBe(422);
  const user = await register(request), token = await resetToken(request, user.email);
  expect((await complete(request, token, '1234567890')).status()).toBe(422);
  expect((await request.post('/api/auth/reset-password', { headers: headers(), data: { token, password: newPassword, confirmPassword: oldPassword } })).status()).toBe(422);
});
test('mobile UI: small login link, email form, scrubbed URL, no-referrer, no automatic login', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/login');
  await expect(page.getByRole('link', { name: 'Забыли пароль?' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('login-mobile.png'), fullPage: true });
  await page.getByRole('link', { name: 'Забыли пароль?' }).click();
  await expect(page.getByRole('heading', { name: 'Восстановление пароля' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('forgot-mobile.png'), fullPage: true });
  const ctx = await requests.newContext({ baseURL, extraHTTPHeaders: headers() });
  try {
    const user = await register(ctx), token = await resetToken(ctx, user.email);
    const response = await page.goto('/reset-password?token=' + token);
    expect(response?.headers()['referrer-policy']).toBe('no-referrer');
    expect(response?.headers()['cache-control']).toContain('no-store');
    await expect(page).toHaveURL(/\/reset-password$/);
    await page.screenshot({ path: testInfo.outputPath('reset-mobile.png'), fullPage: true });
    await page.getByLabel('Новый пароль', { exact: true }).fill(newPassword);
    await page.getByLabel('Подтвердите новый пароль').fill(newPassword);
    await page.getByRole('button', { name: 'Сохранить новый пароль' }).click();
    await expect(page.getByRole('status')).toContainText('Пароль успешно изменён');
    expect((await page.context().cookies()).some(c => c.name === 'tk_session')).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await ctx.dispose(); }
});
