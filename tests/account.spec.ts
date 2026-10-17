import { test, expect, request as requests, type APIRequestContext } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID, createHash } from 'node:crypto';
import { hashPassword } from '../src/lib/auth/password';

const dbURL = process.env.DATABASE_URL ?? '';
if (!dbURL || !['localhost', '127.0.0.1'].includes(new URL(dbURL).hostname)) throw new Error('Dedicated local DB required');
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: dbURL }) });
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const companies: string[] = [];
async function account(api: APIRequestContext) {
  const email = `account-${randomUUID()}@example.test`, password = `Synthetic-${randomUUID()}-1`;
  const response = await api.post('/api/auth/register', { data: { email, password, name: 'Synthetic owner', companyName: 'Synthetic account QA' } });
  expect(response.status()).toBe(201);
  const data = (await response.json()).data;
  companies.push(data.companyId);
  expect(data).toMatchObject({ mfaGate: 'OK', next: '/dashboard' });
  return { ...data, email, password } as { userId: string; companyId: string; email: string; password: string };
}
async function secondLogin(email: string, password: string) {
  const api = await requests.newContext({ baseURL, extraHTTPHeaders: { Origin: new URL(baseURL).origin } });
  expect((await api.post('/api/auth/login', { data: { email, password } })).status()).toBe(200);
  return api;
}
test.afterAll(async () => { await db.company.deleteMany({ where: { id: { in: companies } } }); await db.$disconnect(); });

test('every role can sign in without TOTP, including legacy mandatory company flags', async ({ request }) => {
  const own = await account(request);
  await db.company.update({ where: { id: own.companyId }, data: { requireMfaForAdmins: true } });
  for (const role of ['OWNER', 'ADMIN', 'ANALYST', 'VIEWER'] as const) {
    await db.user.update({ where: { id: own.userId }, data: { role } });
    const api = await secondLogin(own.email, own.password);
    try {
      expect((await api.get('/api/tenders')).status()).toBe(200);
      expect((await api.get('/mfa', { maxRedirects: 0 })).headers().location).toBe('/dashboard');
      if (role === 'VIEWER') expect((await api.post('/api/tenders', { data: { title: 'Forbidden' } })).status()).toBe(403);
    } finally { await api.dispose(); }
  }
});

test('own deletion requires password, rejects caller IDs, removes credentials and preserves both companies', async ({ request }) => {
  const own = await account(request);
  const otherApi = await requests.newContext({ baseURL, extraHTTPHeaders: { Origin: new URL(baseURL).origin } });
  const other = await account(otherApi);
  const otherBefore = await db.user.findUniqueOrThrow({ where: { id: other.userId } });
  const oldSession = await secondLogin(own.email, own.password);
  const tender = await request.post('/api/tenders', { data: { title: 'Shared company tender' } });
  expect(tender.status()).toBe(201);
  const tenderId = (await tender.json()).data.id;
  const watch = await db.tenderWatch.create({ data: { companyId: own.companyId, tenderId, watchedById: own.userId } });
  const snapshot = await db.watchSnapshot.create({ data: { watchId: watch.id, revision: 1, sourceKind: 'MANUAL', capturedById: own.userId } });
  await db.watchChange.create({ data: { watchId: watch.id, toSnapshotId: snapshot.id, kind: 'OTHER', severity: 'MINOR', summary: 'Synthetic', detail: {}, acknowledgedById: own.userId } });
  const model = await db.financialModel.create({ data: { tenderId, inputs: {}, result: { netProfitMinor: 12345 }, provenance: { bid: { value: 100000, source: `user:${own.userId}`, status: 'USER_CONFIRMED' } } } });
  await db.document.create({ data: { companyId: own.companyId, tenderId, uploadedById: own.userId,
    originalName: 'synthetic.pdf', storagePath: 'synthetic/retained.pdf', mimeType: 'application/pdf', sizeBytes: 1, sha256: 'synthetic' } });
  await db.passwordResetToken.create({ data: { userId: own.userId, tokenHash: createHash('sha256').update(randomUUID()).digest('hex'), authVersion: 0, expiresAt: new Date(Date.now() + 60_000), sentAt: new Date() } });
  try {
    expect((await request.delete('/api/auth/account', { data: { password: randomUUID(), confirmation: 'УДАЛИТЬ' } })).status()).toBe(401);
    expect((await request.delete('/api/auth/account', { data: { password: own.password, confirmation: 'УДАЛИТЬ', userId: other.userId } })).status()).toBe(422);
    expect(await db.user.count({ where: { id: own.userId } })).toBe(1);
    expect((await request.delete('/api/auth/account', { data: { password: own.password, confirmation: 'УДАЛИТЬ' } })).status()).toBe(200);
    expect(await db.user.count({ where: { id: own.userId } })).toBe(0);
    expect(await db.session.count({ where: { userId: own.userId } })).toBe(0);
    expect(await db.passwordResetToken.count({ where: { userId: own.userId } })).toBe(0);
    expect(await db.recoveryCode.count({ where: { userId: own.userId } })).toBe(0);
    expect((await oldSession.get('/api/tenders')).status()).toBe(401);
    expect(await db.company.count({ where: { id: own.companyId } })).toBe(1);
    expect(await db.tender.count({ where: { id: tenderId } })).toBe(1);
    expect((await db.document.findFirstOrThrow({ where: { tenderId } })).uploadedById).toBeNull();
    expect((await db.tenderWatch.findUniqueOrThrow({ where: { id: watch.id } })).watchedById).toBeNull();
    expect((await db.watchSnapshot.findUniqueOrThrow({ where: { id: snapshot.id } })).capturedById).toBeNull();
    expect((await db.watchChange.findFirstOrThrow({ where: { watchId: watch.id } })).acknowledgedById).toBeNull();
    expect(await db.financialModel.findUniqueOrThrow({ where: { id: model.id } })).toMatchObject({ result: { netProfitMinor: 12345 }, provenance: { bid: { value: 100000, source: 'user:deleted', status: 'USER_CONFIRMED' } } });
    expect(await db.auditLog.count({ where: { userId: own.userId } })).toBe(0);
    expect(await db.user.findUniqueOrThrow({ where: { id: other.userId } })).toEqual(otherBefore);
    expect((await otherApi.get('/api/tenders')).status()).toBe(200);
  } finally { await oldSession.dispose(); await otherApi.dispose(); }
});

test('last active owner cannot strand colleagues; another owner permits own deletion without changing colleague', async ({ request }) => {
  const own = await account(request);
  const colleague = await db.user.create({ data: { email: `colleague-${randomUUID()}@example.test`, name: 'Synthetic colleague', passwordHash: await hashPassword(own.password), companyId: own.companyId, role: 'ANALYST' } });
  expect((await request.delete('/api/auth/account', { data: { password: own.password, confirmation: 'УДАЛИТЬ' } })).status()).toBe(409);
  await db.user.update({ where: { id: colleague.id }, data: { role: 'OWNER' } });
  const before = await db.user.findUniqueOrThrow({ where: { id: colleague.id } });
  expect((await request.delete('/api/auth/account', { data: { password: own.password, confirmation: 'УДАЛИТЬ' } })).status()).toBe(200);
  expect(await db.user.findUniqueOrThrow({ where: { id: colleague.id } })).toEqual(before);
});

test('logout on all devices invalidates every active session; password remains usable', async ({ request }) => {
  const own = await account(request);
  const other = await secondLogin(own.email, own.password);
  try {
    expect((await request.post('/api/auth/sessions/revoke', { data: { password: randomUUID() } })).status()).toBe(401);
    expect((await request.post('/api/auth/sessions/revoke', { data: { password: own.password } })).status()).toBe(200);
    expect((await request.get('/api/tenders')).status()).toBe(401);
    expect((await other.get('/api/tenders')).status()).toBe(401);
    expect((await db.user.findUniqueOrThrow({ where: { id: own.userId } })).authVersion).toBe(1);
    expect((await request.post('/api/auth/login', { data: { email: own.email, password: own.password } })).status()).toBe(200);
    expect((await request.get('/api/tenders')).status()).toBe(200);
  } finally { await other.dispose(); }
});

test('account UI deletes only the signed-in synthetic account and shows confirmation', async ({ request, page, context }) => {
  const own = await account(request);
  await context.addCookies((await request.storageState()).cookies);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/settings/account');
  await page.getByLabel('Текущий пароль').fill(own.password);
  await page.getByLabel('Для подтверждения введите УДАЛИТЬ').fill('УДАЛИТЬ');
  await page.getByRole('button', { name: 'Удалить мой аккаунт', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Аккаунт удалён');
  expect(await db.user.count({ where: { id: own.userId } })).toBe(0);
});
