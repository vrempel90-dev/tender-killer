/** Real HTTP + real Ollama. Explicit opt-in; never pulls a model. */
import { test, expect, request as requests, type APIRequestContext } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { generateTotp } from '../src/lib/auth/mfa/totp';
import { extractDocument } from '../src/lib/documents/extract';

test('local model: real source → authenticated analysis → RLS checkpoints → reviewable result', async ({ page }) => {
  test.skip(process.env.AI_LIVE_TEST !== 'true', 'Set AI_LIVE_TEST=true and E2E_PUBLIC_SPEC_PATH. Real model required.');
  test.setTimeout(360_000);
  if (!process.env.E2E_PUBLIC_SPEC_PATH) throw new Error('A real public source PDF is required');
  const url = process.env.DATABASE_URL ?? '';
  if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Local isolated database required');
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';
  const headers = { Origin: new URL(baseURL).origin };
  const a = page.request, b = await requests.newContext({ baseURL, extraHTTPHeaders: headers });
  const companies: string[] = [];
  async function register(context: APIRequestContext) {
    const res = await context.post('/api/auth/register', { data: { companyName: 'AI live test only', name: 'Test owner',
      email: `${randomUUID()}@example.test`, password: 'Local-AI-live-test-12345', taxRegime: 'GENERAL_NO_VAT' } });
    expect(res.status()).toBe(201);
    const result = (await res.json()).data; companies.push(result.companyId);
    const enrollment = await context.post('/api/auth/mfa/enroll'); expect(enrollment.status()).toBe(200);
    const secret = /[?&]secret=([A-Z2-7]+)/.exec((await enrollment.json()).data.otpauthUri)?.[1];
    if (!secret) throw new Error('Missing TOTP secret');
    expect((await context.post('/api/auth/mfa/confirm', { data: { token: generateTotp({ secret }) } })).status()).toBe(200);
    return result;
  }
  try {
    const ownerA = await register(a); const ownerB = await register(b);
    const config = await a.get('/api/settings/ai'); expect(config.status()).toBe(200);
    expect((await config.json()).data).toMatchObject({ provider: 'ollama', model: 'qwen3:8b' });
    expect(await config.text()).not.toMatch(/11434|OLLAMA_BASE_URL|ANTHROPIC_API_KEY/);
    const connection = await a.post('/api/settings/ai', { data: {}, timeout: 180_000 });
    expect(connection.status(), await connection.text()).toBe(200);
    expect((await connection.json()).data.test).toBe('passed');
    expect((await a.post('/api/settings/ai', { data: { provider: 'anthropic', url: 'http://example.com' } })).status()).toBe(422);
    const tender = await db.tender.create({ data: { companyId: ownerA.companyId, title: 'TEST — real public tender source' } });
    const bytes = await readFile(process.env.E2E_PUBLIC_SPEC_PATH);
    const extracted = await extractDocument({ buffer: bytes, mimeType: 'application/pdf', originalName: 'public-source.pdf' });
    expect(extracted.status).toBe('SUCCEEDED');
    const document = await db.document.create({ data: {
      companyId: ownerA.companyId, tenderId: tender.id, originalName: 'public-source.pdf', mimeType: 'application/pdf',
      storagePath: `test/${randomUUID()}.pdf`, sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
      extraction: { create: { status: 'SUCCEEDED', text: extracted.text, pageCount: extracted.pageCount, charCount: extracted.charCount, engine: extracted.engine } },
    } });
    expect((await b.post(`/api/tenders/${tender.id}/requirements`, { data: { documentIds: [document.id] } })).status()).toBe(404);
    const result = await a.post(`/api/tenders/${tender.id}/requirements`, { data: { documentIds: [document.id] }, timeout: 240_000 });
    expect(result.status(), await result.text()).toBe(200);
    const body = (await result.json()).data;
    expect(body.model).toBe('qwen3:8b'); expect(body.extracted).toBeGreaterThan(0);
    expect(body.limitations.join(' ')).toContain('ручной проверки');
    const saved = await db.requirement.findMany({ where: { tenderId: tender.id } });
    expect(saved.every(r => !r.confirmedByUser)).toBe(true);
    const positions = await a.post(`/api/tenders/${tender.id}/line-items`, { data: { documentIds: [document.id] }, timeout: 180_000 });
    expect(positions.status(), await positions.text()).toBe(200);
    expect((await positions.json()).data.extracted).toBeGreaterThan(0);
    // Explicitly unconfirmed test requirements: verification must still surface
    // uncertainty. No user or production requirement is auto-confirmed.
    const compliance = await a.post(`/api/tenders/${tender.id}/compliance`, {
      data: { supplierDocumentIds: [document.id], onlyConfirmedRequirements: false }, timeout: 180_000 });
    expect(compliance.status(), await compliance.text()).toBe(200);
    expect((await compliance.json()).data.findings).toBeGreaterThan(0);
    // These are payment/delivery clauses in a real technical annex, not a full legal audit.
    const contract = await a.post(`/api/tenders/${tender.id}/contract`, { data: { documentId: document.id }, timeout: 180_000 });
    expect(contract.status(), await contract.text()).toBe(200);
    const job = await db.aiAnalysisJob.findFirstOrThrow({ where: { companyId: ownerA.companyId }, include: { chunks: true } });
    expect(job.status).toBe('SUCCEEDED'); expect(job.completedChunks).toBe(job.totalChunks); expect(job.chunks.length).toBeGreaterThan(1);
    expect((await b.get(`/api/settings/ai/jobs?id=${job.id}`)).status()).toBe(404);
    expect((await a.get(`/api/settings/ai/jobs?id=${job.id}`)).status()).toBe(200);
    const userB = await db.user.findFirstOrThrow({ where: { companyId: ownerB.companyId } });
    await db.user.update({ where: { id: userB.id }, data: { role: 'VIEWER' } });
    expect((await b.get('/api/settings/ai')).status()).toBe(403);
    expect((await b.post('/api/settings/ai', { data: {} })).status()).toBe(403);
    await page.goto('/settings'); await expect(page.getByRole('heading', { name: 'AI-модель', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Проверить подключение', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Проверить подключение', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Тестовый запрос выполнен' })).toBeVisible({ timeout: 180_000 });
    await page.screenshot({ path: '../ai-settings-verified.png', fullPage: true });
  } finally {
    await db.company.deleteMany({ where: { id: { in: companies } } });
    await b.dispose(); await db.$disconnect();
  }
});
