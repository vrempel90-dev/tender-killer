/**
 * TENDER RADAR: сквозные проверки через HTTP.
 *
 * Главное, что здесь проверяется, — обещание «никаких вымышленных
 * закупок»: у новой компании объявлений нет, появиться они могут только
 * импортом, и каждое несёт источник и дату актуальности.
 */
import { test, expect, request as requestFactory, type APIRequestContext } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { generateTotp } from '../src/lib/auth/mfa/totp';
import { prisma as appDb } from '../src/lib/db';

const databaseURL = process.env.DATABASE_URL ?? '';
if (!databaseURL || !['localhost', '127.0.0.1'].includes(new URL(databaseURL).hostname)) {
  throw new Error('Isolated local test DB required');
}
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseURL }) });
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const headers = { Origin: new URL(baseURL).origin };
const companies: string[] = [];

/** Регистрация компании и прохождение второго фактора. */
async function register(context: APIRequestContext, label: string) {
  const result = await context.post('/api/auth/register', {
    data: {
      companyName: `E2E RADAR ${label}`,
      name: 'Test analyst',
      email: `e2e-radar-${randomUUID()}@example.test`,
      password: 'E2E-long-password-123',
      taxRegime: 'GENERAL_NO_VAT',
    },
  });
  expect(result.status()).toBe(201);
  const payload = (await result.json()).data;
  companies.push(payload.companyId);

  const start = await context.post('/api/auth/mfa/enroll');
  expect(start.status()).toBe(200);
  const secret = /[?&]secret=([A-Z2-7]+)/.exec((await start.json()).data.otpauthUri)?.[1];
  if (!secret) throw new Error('В otpauth-ссылке нет секрета');
  expect(
    (await context.post('/api/auth/mfa/confirm', { data: { token: generateTotp({ secret }) } }))
      .status(),
  ).toBe(200);
  return payload as { companyId: string; userId: string };
}

const HEADER_ROW = 'Номер объявления;Наименование закупки;Заказчик;БИН заказчика;Плановая сумма;Способ закупки;Регион;Окончание приёма заявок;Срок поставки;Ссылка';

function csv(rows: string[]): Buffer {
  return Buffer.from([HEADER_ROW, ...rows].join('\n'), 'utf8');
}

function dateString(offsetDays: number): string {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`;
}

async function importFile(
  context: APIRequestContext,
  body: Buffer,
  overrides: Record<string, string> = {},
) {
  const multipart: Record<string, string | { name: string; mimeType: string; buffer: Buffer }> = {
    sourceName: 'goszakup.gov.kz — экспорт объявлений',
    actualAt: new Date().toISOString(),
    file: { name: 'announcements.csv', mimeType: 'text/csv', buffer: body },
    ...overrides,
  };
  return context.post('/api/radar/imports', { multipart });
}

async function search(context: APIRequestContext, filters: Record<string, unknown> = {}) {
  const response = await context.post('/api/radar/opportunities/search', {
    data: { filters },
  });
  return { status: response.status(), body: (await response.json()).data };
}

let a: APIRequestContext;
let b: APIRequestContext;
let companyA = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  a = await requestFactory.newContext({ baseURL, extraHTTPHeaders: headers });
  b = await requestFactory.newContext({ baseURL, extraHTTPHeaders: headers });
  const registered = await register(a, 'A');
  companyA = registered.companyId;
  await register(b, 'B');
});

test.afterAll(async () => {
  if (companies.length) await db.company.deleteMany({ where: { id: { in: companies } } });
  await a?.dispose();
  await b?.dispose();
  await db.$disconnect();
  await appDb.$disconnect();
});

test('ГЛАВНОЕ: у новой компании нет ни одного объявления', async () => {
  const result = await search(a);
  expect(result.status).toBe(200);
  expect(result.body.items).toEqual([]);
  expect(result.body.total).toBe(0);
  // И в БД тоже: демонстрационных данных не создаётся.
  expect(await db.procurementOpportunity.count({ where: { companyId: companyA } })).toBe(0);
});

test('импорт без источника и без даты актуальности отклоняется', async () => {
  const body = csv([`1-1;Поставка кабеля;ГУ Тест;123456789012;1 000 000;конкурс;Алматы;${dateString(20)};${dateString(60)};`]);
  expect((await importFile(a, body, { sourceName: '' })).status()).toBe(422);
  expect((await importFile(a, body, { actualAt: '' })).status()).toBe(422);
  // Дата актуальности в будущем — опечатка, а не «свежие данные».
  const future = new Date(Date.now() + 10 * 86_400_000).toISOString();
  expect((await importFile(a, body, { actualAt: future })).status()).toBe(422);
  expect(await db.procurementOpportunity.count({ where: { companyId: companyA } })).toBe(0);
});

test('импорт создаёт объявления с источником и датой актуальности', async () => {
  const body = csv([
    `100-1;Поставка кабеля силового;ГУ «Управление образования»;123456789012;5 400 000,00;открытый конкурс;г. Алматы;${dateString(20)};${dateString(60)};https://portal.example.kz/a/100`,
    `100-2;Поставка канцелярских товаров;ГУ «Акимат»;210987654321;300 000;запрос ценовых предложений;Астана;${dateString(15)};${dateString(50)};`,
    `100-3;Ремонт кровли;ГУ «Школа №1»;321098765432;8 000 000;открытый конкурс;г. Алматы;${dateString(-5)};${dateString(30)};`,
  ]);
  const response = await importFile(a, body);
  expect(response.status()).toBe(201);
  const payload = (await response.json()).data;
  expect(payload.imported).toBe(3);

  const result = await search(a, {});
  expect(result.body.items.length).toBeGreaterThanOrEqual(3);
  for (const item of result.body.items) {
    // Источник и актуальность идут с каждой записью.
    expect(item.source.name).toBe('goszakup.gov.kz — экспорт объявлений');
    expect(item.source.fileName).toBe('announcements.csv');
    expect(item.source.actualAt).toBeTruthy();
  }
});

test('разбор не угадывает значения и сохраняет исходную строку', async () => {
  const row = await db.procurementOpportunity.findFirstOrThrow({
    where: { companyId: companyA, externalId: '100-1' },
  });
  expect(row.priceMinor).toBe(540_000_000n);
  expect(row.customerBin).toBe('123456789012');
  expect(row.procurementType).toBe('OPEN_TENDER');
  expect(row.sourceUrl).toBe('https://portal.example.kz/a/100');
  // Исходная строка сохранена целиком — любое значение проверяемо.
  expect((row.raw as Record<string, string>)['Наименование закупки'])
    .toBe('Поставка кабеля силового');
});

test('отбор по сроку исключает закупки с закрытым приёмом', async () => {
  const open = await search(a, { onlyOpen: true });
  const titles = open.body.items.map((item: { title: string }) => item.title);
  expect(titles).not.toContain('Ремонт кровли');

  const all = await search(a, {});
  expect(all.body.items.map((item: { title: string }) => item.title)).toContain('Ремонт кровли');
});

test('профиль влияет на оценку и перечисляет препятствия', async () => {
  const profile = await a.put('/api/radar/profile', {
    data: {
      keywords: ['кабель'],
      excludedKeywords: ['канцелярские товары'],
      regions: ['Алматы'],
      procurementTypes: ['OPEN_TENDER'],
      minPrice: 1_000_000,
      maxPrice: 50_000_000,
      minDeliveryDays: null,
      excludedCustomerBins: [],
      preferredCustomerBins: [],
      minDaysToDeadline: 3,
      notes: null,
    },
  });
  expect(profile.status()).toBe(200);

  const result = await search(a, { onlyOpen: true, sort: 'score' });
  const items = result.body.items as Array<{
    title: string;
    match: { score: number; suitable: boolean; reasons: unknown[]; blockers: Array<{ code: string }> };
  }>;

  const cable = items.find((item) => item.title.includes('кабеля'));
  expect(cable?.match.suitable).toBe(true);
  expect(cable?.match.score).toBeGreaterThanOrEqual(70);
  // Оценка всегда объяснена.
  expect(cable?.match.reasons.length).toBeGreaterThan(0);

  const stationery = items.find((item) => item.title.includes('канцелярских'));
  expect(stationery?.match.suitable).toBe(false);
  expect(stationery?.match.blockers.map((blocker) => blocker.code))
    .toContain('EXCLUDED_KEYWORD');

  // Фильтр «только без препятствий» их убирает.
  const suitable = await search(a, { onlyOpen: true, onlySuitable: true });
  expect(
    (suitable.body.items as Array<{ title: string }>).some((item) =>
      item.title.includes('канцелярских')),
  ).toBe(false);
});

test('ГЛАВНОЕ: объявления другой компании недоступны', async () => {
  const result = await search(b);
  expect(result.body.items).toEqual([]);

  const foreign = await db.procurementOpportunity.findFirstOrThrow({
    where: { companyId: companyA },
  });
  // Ни чтения, ни передачи в расчёт по прямой ссылке.
  expect((await b.post(`/api/radar/opportunities/${foreign.id}/to-tender`)).status()).toBe(404);
  expect((await b.delete(`/api/radar/imports?importId=${foreign.importId}`)).status()).toBe(404);
  expect(await db.procurementOpportunity.findUnique({ where: { id: foreign.id } })).not.toBeNull();
});

test('передача в финансовый модуль сохраняет происхождение', async () => {
  const row = await db.procurementOpportunity.findFirstOrThrow({
    where: { companyId: companyA, externalId: '100-1' },
  });
  const response = await a.post(`/api/radar/opportunities/${row.id}/to-tender`);
  expect(response.status()).toBe(201);
  const { tenderId, priceKnown } = (await response.json()).data;
  expect(priceKnown).toBe(true);

  const tender = await db.tender.findUniqueOrThrow({ where: { id: tenderId } });
  expect(tender.companyId).toBe(companyA);
  expect(tender.title).toBe('Поставка кабеля силового');
  expect(tender.startPriceMinor).toBe(540_000_000n);
  expect(tender.externalNumber).toBe('100-1');
  // В тендере видно, из какого источника он возник.
  expect(tender.notes).toContain('goszakup.gov.kz');
  expect(tender.notes).toContain('Данные актуальны на');

  // Повторная передача запрещена.
  expect((await a.post(`/api/radar/opportunities/${row.id}/to-tender`)).status()).toBe(409);
});

test('импорт нельзя удалить, если из него уже создан тендер', async () => {
  const row = await db.procurementOpportunity.findFirstOrThrow({
    where: { companyId: companyA, externalId: '100-1' },
  });
  const blocked = await a.delete(`/api/radar/imports?importId=${row.importId}`);
  expect(blocked.status()).toBe(409);
  expect(await db.procurementImport.findUnique({ where: { id: row.importId } })).not.toBeNull();
});

test('сохранённый поиск применяется и удаляется', async () => {
  const created = await a.post('/api/radar/searches', {
    data: { name: 'Кабель, Алматы', filters: { query: 'кабель', onlyOpen: true } },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()).data;

  const list = await a.get('/api/radar/searches');
  expect(list.status()).toBe(200);
  const searches = (await list.json()).data as Array<{
    id: string;
    name: string;
    filters: Record<string, unknown>;
    description: string;
  }>;
  const saved = searches.find((item) => item.id === id);
  expect(saved?.filters).toEqual({ query: 'кабель', onlyOpen: true });
  expect(saved?.description).toContain('«кабель»');

  const applied = await search(a, saved!.filters);
  expect(
    (applied.body.items as Array<{ title: string }>).every((item) =>
      item.title.toLowerCase().includes('кабел')),
  ).toBe(true);

  expect((await a.delete(`/api/radar/searches/${id}`)).status()).toBe(200);
  expect((await a.delete(`/api/radar/searches/${id}`)).status()).toBe(404);
});

test('набор фильтров с посторонним полем не сохраняется', async () => {
  const response = await a.post('/api/radar/searches', {
    data: { name: 'Плохой набор', filters: { query: 'кабель', dropTable: true } },
  });
  expect(response.status()).toBe(422);
});
