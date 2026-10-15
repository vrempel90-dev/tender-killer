import { test, expect, request as requestFactory, type APIRequestContext } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { acquireParserLease } from '../src/lib/security/quota';
import { prisma as quotaDb } from '../src/lib/db';
import { createEmptyFinanceInput } from '../src/lib/finance/defaults';

const databaseURL = process.env.DATABASE_URL ?? '';
if (!databaseURL || !['localhost','127.0.0.1'].includes(new URL(databaseURL).hostname)) throw new Error('Isolated local test DB required');
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseURL }) });
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const headers = { Origin: new URL(baseURL).origin };
const companies: string[] = [];
let a: APIRequestContext, b: APIRequestContext;
let tenderA: string, tenderB: string, modelB: string, rateId: string, initialRate: number;
const input = createEmptyFinanceInput({ regime: 'GENERAL_NO_VAT', isVatPayer: false });
input.tender.bidPriceMinor = 100_000;
input.schedule.contractDurationDays = 30; input.schedule.deliveryDay = 20; input.schedule.paymentDelayDays = 10;
input.costs.items = [{ label: 'TEST fixture only', quantity: 1, unitCostMinor: 50_000, vatMode:'INCLUSIVE', supplierChargesVat:false, verified:false }];

async function register(context: APIRequestContext, label: string) {
  const result = await context.post('/api/auth/register', { data: { companyName: `E2E ${label}`, name: 'Test analyst',
    email: `e2e-${randomUUID()}@example.test`, password: 'E2E-long-password-123', taxRegime: 'GENERAL_NO_VAT' } });
  expect(result.status()).toBe(201); const payload = await result.json(); companies.push(payload.data.companyId);
  return payload.data;
}
test.describe.configure({ mode:'serial' });
test.beforeAll(async () => {
  a = await requestFactory.newContext({ baseURL, extraHTTPHeaders: headers });
  b = await requestFactory.newContext({ baseURL, extraHTTPHeaders: headers });
  await register(a, 'A'); await register(b, 'B');
  const ca = await a.post('/api/tenders', { data:{ title:'E2E tenant A' } });
  const cb = await b.post('/api/tenders', { data:{ title:'E2E tenant B' } });
  expect(ca.status()).toBe(201); expect(cb.status()).toBe(201);
  tenderA = (await ca.json()).data.id; tenderB = (await cb.json()).data.id;
  const model = await b.post(`/api/tenders/${tenderB}/finance`, { data:{ input } });
  expect(model.status()).toBe(200); modelB = (await model.json()).data.id;
  const rate = await db.taxRateConfig.findFirstOrThrow({ where:{ key:'CIT_STANDARD' } });
  rateId=rate.id; initialRate=Number(rate.ratePercent);
});
test.afterAll(async () => {
  if (companies.length) await db.company.deleteMany({ where:{ id:{ in:companies } } });
  await a?.dispose(); await b?.dispose(); await db.$disconnect();
  await quotaDb.$disconnect();
});
test('tenant A cannot read tender B or overwrite its model via own tender URL', async () => {
  expect((await a.get(`/api/tenders/${tenderB}`)).status()).toBe(404);
  const before = await db.financialModel.findUniqueOrThrow({ where:{ id:modelB } });
  expect((await a.post(`/api/tenders/${tenderA}/finance`, { data:{ modelId:modelB, name:'attack', input } })).status()).toBe(404);
  const after = await db.financialModel.findUniqueOrThrow({ where:{ id:modelB } });
  expect(after.inputs).toEqual(before.inputs); expect(after.name).toBe(before.name);
});
test('tax override stays in A; global policy and B calculation remain unchanged', async () => {
  expect((await a.patch('/api/settings/taxes',{ data:{ rateId, ratePercent:17 } })).status()).toBe(200);
  expect(Number((await db.taxRateConfig.findUniqueOrThrow({where:{id:rateId}})).ratePercent)).toBe(initialRate);
  expect(await db.companyTaxRate.count({where:{companyId:companies[1]}})).toBe(0);
  const result = await b.post('/api/finance/calculate',{data:{input,withScenarios:false}});
  expect(result.status()).toBe(200);
  const forged = structuredClone(input); forged.tax.incomeTaxRatePercent=0; forged.tax.configVersion='forged';
  const saved = await b.post(`/api/tenders/${tenderB}/finance`,{data:{input:forged}});
  expect(saved.status()).toBe(200);
  const row = await db.financialModel.findUniqueOrThrow({where:{id:(await saved.json()).data.id}});
  expect((row.inputs as unknown as typeof input).tax.incomeTaxRatePercent).toBe(initialRate);
  expect(row.taxConfigVersion).not.toBe('forged');
});
test('foreign Origin and login-CSRF media type are rejected before cookie mutation',async()=>{
  expect((await a.post('/api/auth/login',{headers:{Origin:'https://attacker.test'},data:{email:'nobody@example.test',password:'x'}})).status()).toBe(403);
  expect((await a.post('/api/auth/login',{headers:{'Content-Type':'text/plain'},data:'{"email":"nobody@example.test","password":"x"}'})).status()).toBe(415);
});
test('account attempts are limited, malformed JSON is rejected',async()=>{
  const email=`unknown-${randomUUID()}@example.test`;
  for(let i=0;i<10;i++) expect((await a.post('/api/auth/login',{data:{email,password:'bad'}})).status()).toBe(401);
  expect((await a.post('/api/auth/login',{data:{email,password:'bad'}})).status()).toBe(429);
  expect((await a.post('/api/tenders',{headers:{'content-type':'application/json'},data:Buffer.from('{')})).status()).toBe(400);
});
test('document metadata, bytes, deletion and re-extraction reject another tenant',async()=>{
  const bytes=await readFile('src/lib/documents/__tests__/fixtures/spec.pdf');
  const uploaded=await a.post('/api/documents/upload',{multipart:{tenderId:tenderA,
    file:{name:'TEST-isolation.pdf',mimeType:'application/pdf',buffer:bytes}}});
  expect(uploaded.status()).toBe(201); const id=(await uploaded.json()).data.documentId;
  try {
    expect((await b.get(`/api/documents/${id}`)).status()).toBe(404);
    expect((await b.get(`/api/documents/${id}/download`)).status()).toBe(404);
    expect((await b.post(`/api/documents/${id}/extract`)).status()).toBe(404);
    expect((await b.delete(`/api/documents/${id}`)).status()).toBe(404);
    expect((await a.get(`/api/documents/${id}/download`)).status()).toBe(200);
  } finally { await a.delete(`/api/documents/${id}`); }
});
test('VIEWER cannot write and logout revokes the server session',async()=>{
  const viewer=await register(a,'viewer');
  await db.user.update({where:{id:viewer.userId},data:{role:'VIEWER'}});
  expect((await a.post('/api/tenders',{data:{title:'forbidden'}})).status()).toBe(403);
  expect((await a.post('/api/auth/logout')).status()).toBe(200);
  expect((await a.get('/api/tenders')).status()).toBe(401);
});

test('parser lease is enforced across callers and released without leaving a lock',async()=>{
  const subject=`e2e-lease-${randomUUID()}`;
  const release=await acquireParserLease(subject);
  try { await expect(acquireParserLease(subject)).rejects.toMatchObject({status:429}); }
  finally { await release(); }
  const next=await acquireParserLease(subject); await next();
});
