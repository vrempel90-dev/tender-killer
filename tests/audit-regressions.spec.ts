import { test, expect, request as requests } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { generateTotp } from '../src/lib/auth/mfa/totp';
import { createEmptyFinanceInput } from '../src/lib/finance/defaults';

const dbURL = process.env.DATABASE_URL ?? '';
if (!dbURL || !['localhost', '127.0.0.1'].includes(new URL(dbURL).hostname)) throw new Error('Local isolated DB required');
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: dbURL }) });
const companies: string[] = [];
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
async function account(request: import('@playwright/test').APIRequestContext) {
  const email = `regression-${randomUUID()}@example.test`, password = `Synthetic-${randomUUID()}-1`;
  const response = await request.post('/api/auth/register', { data: { email, password, name: 'Synthetic auditor', companyName: 'Synthetic regression company' } });
  expect(response.status()).toBe(201);
  const data = (await response.json()).data;
  companies.push(data.companyId);
  return { ...data, email, password };
}
test.afterAll(async () => { await db.company.deleteMany({ where: { id: { in: companies } } }); await db.$disconnect(); });

test('concurrent TOTP and recovery-code requests authorize only one session each', async ({ request }) => {
  const own = await account(request);
  const start = await request.post('/api/auth/mfa/enroll'); expect(start.status()).toBe(200);
  const secret = new URL((await start.json()).data.otpauthUri).searchParams.get('secret')!;
  const confirm = await request.post('/api/auth/mfa/confirm', { data: { token: generateTotp({ secret }) } });
  expect(confirm.status()).toBe(200);
  const recovery = (await confirm.json()).data.recoveryCodes as string[];
  const clients = await Promise.all([0, 1].map(async () => {
    const api = await requests.newContext({ baseURL, extraHTTPHeaders: { Origin: new URL(baseURL).origin } });
    expect((await api.post('/api/auth/login', { data: { email: own.email, password: own.password } })).status()).toBe(200);
    return api;
  }));
  try {
    for (const token of [generateTotp({ secret, timestampMs: Date.now() + 30_000 }), recovery[0]]) {
      const results = await Promise.all(clients.map(api => api.post('/api/auth/mfa/verify', { data: { token } })));
      expect(results.map(result => result.status()).sort()).toEqual([200, 401]);
    }
    expect(await db.recoveryCode.count({ where: { userId: own.userId, usedAt: { not: null } } })).toBe(1);
  } finally { await Promise.all(clients.map(api => api.dispose())); }
});

test('failed and running analyses never become clean summaries or completed workflow steps', async ({ request, page, context }) => {
  const own = await account(request);
  const tender = await db.tender.create({ data: { companyId: own.companyId, title: 'Synthetic incomplete analyses' } });
  const doc = await db.document.create({ data: { companyId: own.companyId, tenderId: tender.id, originalName: 'synthetic.pdf', storagePath: 'synthetic/no-file.pdf', mimeType: 'application/pdf', sizeBytes: 1, sha256: 'synthetic', kind: 'CONTRACT_DRAFT' } });
  await context.addCookies((await request.storageState()).cookies);
  for (const status of ['FAILED', 'RUNNING']) {
    await db.complianceRun.create({ data: { tenderId: tender.id, status, error: status === 'FAILED' ? 'Synthetic AI unavailable' : null } });
    await db.contractAnalysis.create({ data: { tenderId: tender.id, documentId: doc.id, status, error: status === 'FAILED' ? 'Synthetic AI unavailable' : null } });
    await page.goto('/compliance');
    await expect(page.getByText(status === 'RUNNING' ? 'проверка выполняется' : 'проверка не завершена', { exact: true })).toBeVisible();
    await expect(page.getByText('замечаний нет', { exact: true })).toHaveCount(0);
    await page.goto('/contracts');
    await expect(page.getByText(status === 'RUNNING' ? 'анализ выполняется' : 'анализ не завершён', { exact: true })).toBeVisible();
    await page.goto(`/tenders/${tender.id}`);
    await expect(page.getByText('Проверка выполнена', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Анализ выполнен', { exact: true })).toHaveCount(0);
    await page.goto(`/tenders/${tender.id}/compliance`);
    await expect(page.getByText('Замечаний нет', { exact: true })).toHaveCount(0);
    await page.goto(`/tenders/${tender.id}/contract`);
    await expect(page.getByText('Риски не выявлены', { exact: true })).toHaveCount(0);
  }
  const watch = await db.tenderWatch.create({ data: { companyId: own.companyId, tenderId: tender.id } });
  await db.watchSnapshot.createMany({ data: [1, 2].map(revision => ({ watchId: watch.id, revision, sourceKind: 'MANUAL' as const })) });
  await page.goto('/guard');
  await expect(page.getByText(/Сравнение неполное/)).toBeVisible();
  await expect(page.getByText(/Условия не менялись:/)).toHaveCount(0);
  const item = await db.lineItem.create({ data: { tenderId: tender.id, name: 'Synthetic priced item', quantity: 1, origin: 'MANUAL', confirmedByUser: true } });
  const quote = await db.supplierQuote.create({ data: { companyId: own.companyId, tenderId: tender.id, supplierName: 'Synthetic unverified supplier', currency: 'KZT', verification: 'UNVERIFIED', items: { create: { name: 'Synthetic quote item', quantity: 1, unitPriceMinor: 10000, specMatch: 'MATCH', lineItemId: item.id } } }, include: { items: true } });
  await db.lineItem.update({ where: { id: item.id }, data: { selectedQuoteItemId: quote.items[0].id } });
  await page.goto('/sourcing');
  await expect(page.getByText('все цены подтверждены', { exact: true })).toHaveCount(0);
  await page.goto(`/tenders/${tender.id}/sourcing`);
  await expect(page.getByText('Все позиции обеспечены подтверждёнными ценами', { exact: false })).toHaveCount(0);
});

test('company tax overrides reach calculations through the restricted RLS runtime role', async ({ request }) => {
  await account(request);
  const rate = await db.taxRateConfig.findFirstOrThrow({ where: { key: 'VAT_STANDARD' }, orderBy: { effectiveFrom: 'desc' } });
  const updated = await request.patch('/api/settings/taxes', { data: { rateId: rate.id, ratePercent: 7 } });
  expect(updated.status()).toBe(200);
  const input = createEmptyFinanceInput({ regime: 'GENERAL_VAT', isVatPayer: true });
  input.tender.bidPriceMinor = 107_000;
  input.costs.items = [{ label: 'Synthetic', quantity: 1, unitCostMinor: 53_500, supplierChargesVat: true, vatMode: 'INCLUSIVE', verified: true }];
  input.schedule.contractDurationDays = 10; input.schedule.paymentDelayDays = 0;
  const calculated = await request.post('/api/finance/calculate', { data: { input, withScenarios: false } });
  expect(calculated.status()).toBe(200);
  const body = (await calculated.json()).data.result;
  expect(body.revenue.netMinor).toBe(100_000);
  expect(body.vat.outputMinor).toBe(7_000);
});

test('all existing module pages render and reload on desktop and mobile without uncaught errors', async ({ request, page, context }) => {
  test.setTimeout(120_000);
  await account(request); await context.addCookies((await request.storageState()).cookies);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ['/dashboard', '/tenders', '/tenders/new', '/radar', '/guard', '/finance', '/compliance', '/market', '/sourcing', '/contracts', '/reports', '/settings', '/settings/profile', '/settings/security', '/settings/taxes', '/settings/audit', '/settings/account']) {
      const response = await page.goto(path); expect(response?.status(), path).toBe(200);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), path).toBe(true);
    }
    expect((await page.reload())?.status()).toBe(200);
  }
  expect(errors).toEqual([]);
});
