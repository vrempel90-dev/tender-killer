import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createEmptyFinanceInput } from '../src/lib/finance/defaults';

test('public original document → selected FX quote → saved calculation → PDF → reopen', async ({ page }) => {
  test.skip(!process.env.E2E_PUBLIC_SPEC_PATH, 'Set an actual public tender PDF path; no mock substituted');
  const url=process.env.DATABASE_URL ?? '';
  if(!url || !['localhost','127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Local isolated DB required');
  const db=new PrismaClient({adapter:new PrismaPg({connectionString:url})});
  const api=page.request;
  const email=`workflow-${randomUUID()}@example.test`, password='Workflow-test-password-123';
  let companyId='';
  try {
    const registration=await api.post('/api/auth/register',{data:{companyName:'E2E test only',name:'Test analyst',email,password,taxRegime:'GENERAL_NO_VAT'}});
    expect(registration.status()).toBe(201); companyId=(await registration.json()).data.companyId;
    const created=await api.post('/api/tenders',{data:{title:'TEST ONLY — публичная техническая спецификация Самрук-Казына',sourceUrl:'https://zakup.sk.kz/eprocfilestorage/open-api/files/download/9ee72e59-db9c-4d2d-a4b1-fa02388399d7-2020-mdb'}});
    expect(created.status()).toBe(201); const id=(await created.json()).data.id;
    const original=await readFile(process.env.E2E_PUBLIC_SPEC_PATH!);
    const uploaded=await api.post('/api/documents/upload',{multipart:{tenderId:id,kind:'TECHNICAL_SPEC',file:{name:'public-original.pdf',mimeType:'application/pdf',buffer:original}}});
    expect(uploaded.status()).toBe(201); const document=(await uploaded.json()).data;
    expect(document.extraction.status).toBe('SUCCEEDED'); expect(document.extraction.charCount).toBeGreaterThan(100);
    const download=await api.get(`/api/documents/${document.documentId}/download`);
    expect(createHash('sha256').update(await download.body()).digest('hex')).toBe(createHash('sha256').update(original).digest('hex'));
    const bad=await api.post('/api/documents/upload',{multipart:{tenderId:id,file:{name:'bad.pdf',mimeType:'application/pdf',buffer:Buffer.from('wrong bytes')}}});
    expect(bad.status()).toBe(415);
    const item=await api.post(`/api/tenders/${id}/line-items`,{data:{name:'TEST ITEM — not a real supplier purchase',quantity:2}});
    expect(item.status()).toBe(201); const lineId=(await item.json()).data.id;
    const quoteBytes=await readFile('src/lib/documents/__tests__/fixtures/quote.xlsx');
    const quoteDoc=await api.post('/api/documents/upload',{multipart:{tenderId:id,kind:'SUPPLIER_QUOTE',file:{name:'TEST-fixture-quote.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:quoteBytes}}});
    expect(quoteDoc.status()).toBe(201);
    const quote=await api.post(`/api/tenders/${id}/quotes`,{data:{supplierName:'TEST FIXTURE ONLY',documentId:(await quoteDoc.json()).data.documentId,currency:'USD',fxRate:500,pricesIncludeVat:false,items:[{name:'TEST ITEM',quantity:2,unitPrice:100,lineItemId:lineId,specMatch:'MATCH'}]}});
    expect(quote.status()).toBe(201);
    const quotes=(await (await api.get(`/api/tenders/${id}/quotes`)).json()).data;
    expect((await api.patch(`/api/tenders/${id}/line-items`,{data:{lineItemId:lineId,selectedQuoteItemId:quotes[0].items[0].id}})).status()).toBe(200);
    await page.goto(`/tenders/${id}/finance`);
    // Browser initial model must contain KZT 50,000 per unit, not USD 100 as KZT.
    await expect(page.locator('input[value="50000"]')).toHaveCount(1);
    const input=createEmptyFinanceInput({regime:'GENERAL_NO_VAT',isVatPayer:false,startPriceMinor:20_000_000});
    input.tender.bidPriceMinor=15_000_000;
    input.costs.items=[{label:'TEST FIXTURE ONLY',quantity:2,unitCostMinor:5_000_000,vatMode:'EXCLUSIVE',supplierChargesVat:false,verified:false}];
    input.schedule.contractDurationDays=30; input.schedule.deliveryDay=20; input.schedule.paymentDelayDays=10;
    const saved=await api.post(`/api/tenders/${id}/finance`,{data:{input}});
    expect(saved.status()).toBe(200); const modelId=(await saved.json()).data.id;
    const model=await db.financialModel.findUniqueOrThrow({where:{id:modelId}});
    expect(model.provenance).not.toBeNull();
    const pdf=await api.get(`/api/tenders/${id}/report?format=pdf`);
    expect(pdf.status()).toBe(200); expect((await pdf.body()).subarray(0,5).toString()).toBe('%PDF-');
    expect((await api.post(`/api/tenders/${id}/report`)).status()).toBe(201);
    // No provider key is injected for tests; an unavailable analysis must remain unavailable.
    expect((await api.post(`/api/tenders/${id}/requirements`,{data:{documentIds:[document.documentId]}})).status()).toBe(503);
    expect((await api.post('/api/auth/logout')).status()).toBe(200);
    expect((await api.post('/api/auth/login',{data:{email,password}})).status()).toBe(200);
    await page.goto(`/tenders/${id}/finance`);
    await page.getByRole('tab',{name:'Результат',exact:true}).click();
    await expect(page.getByText('Расчётная чистая прибыль',{exact:true}).first()).toBeVisible();
    await page.setViewportSize({width:390,height:844});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    expect((await api.get(`/api/tenders/${id}/finance`)).status()).toBe(200);
  } finally {
    if(companyId) {
      const docs=await db.document.findMany({where:{companyId},select:{storagePath:true}});
      await db.company.deleteMany({where:{id:companyId}});
      const root=path.resolve(process.env.STORAGE_DIR ?? './storage');
      for(const doc of docs) { const target=path.resolve(root,doc.storagePath); expect(target.startsWith(root+path.sep)).toBe(true); await rm(target,{force:true}); }
    }
    await db.$disconnect();
  }
});
