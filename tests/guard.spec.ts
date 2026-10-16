/**
 * TENDER GUARD: сквозные проверки через HTTP.
 *
 * Проверяется то, что обещано: GUARD не узнаёт об изменениях сам, но
 * честно фиксирует редакции, находит различия, различает их значимость и
 * переоценивает расчёт — либо прямо говорит, что переоценка невозможна.
 */
import { test, expect, request as requestFactory, type APIRequestContext } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { generateTotp } from '../src/lib/auth/mfa/totp';
import { createEmptyFinanceInput } from '../src/lib/finance/defaults';
import { prisma as appDb } from '../src/lib/db';

const databaseURL = process.env.DATABASE_URL ?? '';
if (!databaseURL || !['localhost', '127.0.0.1'].includes(new URL(databaseURL).hostname)) {
  throw new Error('Isolated local test DB required');
}
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseURL }) });
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const headers = { Origin: new URL(baseURL).origin };
const companies: string[] = [];

async function register(context: APIRequestContext, label: string) {
  const result = await context.post('/api/auth/register', {
    data: {
      companyName: `E2E GUARD ${label}`,
      name: 'Test analyst',
      email: `e2e-guard-${randomUUID()}@example.test`,
      password: 'E2E-long-password-123',
      taxRegime: 'GENERAL_NO_VAT',
    },
  });
  expect(result.status()).toBe(201);
  const payload = (await result.json()).data;
  companies.push(payload.companyId);

  const start = await context.post('/api/auth/mfa/enroll');
  const secret = /[?&]secret=([A-Z2-7]+)/.exec((await start.json()).data.otpauthUri)?.[1];
  if (!secret) throw new Error('В otpauth-ссылке нет секрета');
  expect(
    (await context.post('/api/auth/mfa/confirm', { data: { token: generateTotp({ secret }) } }))
      .status(),
  ).toBe(200);
  return payload as { companyId: string; userId: string };
}

function inDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

/** Схема тендера принимает дату без времени (YYYY-MM-DD). */
function dayInDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

let a: APIRequestContext;
let b: APIRequestContext;
let companyA = '';
let tenderId = '';
let watchId = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  a = await requestFactory.newContext({ baseURL, extraHTTPHeaders: headers });
  b = await requestFactory.newContext({ baseURL, extraHTTPHeaders: headers });
  companyA = (await register(a, 'A')).companyId;
  await register(b, 'B');

  const created = await a.post('/api/tenders', {
    data: {
      title: 'E2E GUARD — поставка оборудования',
      startPrice: 10_000_000,
      submissionDeadline: dayInDays(30),
      deliveryDeadline: dayInDays(120),
    },
  });
  expect(created.status()).toBe(201);
  tenderId = (await created.json()).data.id;
});

test.afterAll(async () => {
  if (companies.length) await db.company.deleteMany({ where: { id: { in: companies } } });
  await a?.dispose();
  await b?.dispose();
  await db.$disconnect();
  await appDb.$disconnect();
});

test('постановка на контроль создаёт точку отсчёта и честно сообщает об ограничении', async () => {
  const response = await a.post('/api/guard/watches', {
    data: { tenderId, note: 'Контроль сроков и цены' },
  });
  expect(response.status()).toBe(201);
  const payload = (await response.json()).data;
  watchId = payload.watchId;
  expect(payload.revision).toBe(1);
  // К тендеру не приложено техзадание — об этом сказано прямо.
  expect(payload.specCaptured).toBe(false);
  expect(payload.limitation).toMatch(/не приложено техническое задание/);

  // Повторная постановка на контроль отклоняется.
  expect((await a.post('/api/guard/watches', { data: { tenderId } })).status()).toBe(409);
});

test('редакция без изменений — отдельный результат, а не «не проверяли»', async () => {
  const response = await a.post(`/api/guard/watches/${watchId}/snapshots`, { data: {} });
  expect(response.status()).toBe(201);
  const payload = (await response.json()).data;
  expect(payload.revision).toBe(2);
  expect(payload.changes).toEqual([]);
  expect(payload.risk).toBeNull();
});

test('ГЛАВНОЕ: без сохранённого расчёта переоценка объявляется невозможной', async () => {
  const response = await a.post(`/api/guard/watches/${watchId}/snapshots`, {
    data: { startPrice: 8_000_000, note: 'Новая редакция объявления' },
  });
  expect(response.status()).toBe(201);
  const payload = (await response.json()).data;
  const kinds = (payload.changes as Array<{ kind: string; severity: string }>);
  expect(kinds.map((change) => change.kind)).toContain('START_PRICE_CHANGED');
  expect(kinds[0]?.severity).toBe('CRITICAL');
  expect(payload.risk.verdict).toBe('NOT_POSSIBLE');
  expect((payload.risk.notes as string[]).join(' ')).toMatch(/расчёт по этому тендеру ещё не сохранён/);
});

test('после сохранения расчёта переоценка считает последствия', async () => {
  const input = createEmptyFinanceInput({
    regime: 'GENERAL_NO_VAT',
    isVatPayer: false,
    startPriceMinor: 800_000_000,
  });
  input.tender.bidPriceMinor = 750_000_000;
  input.costs.items = [
    {
      label: 'E2E fixture — поставка',
      quantity: 1,
      unitCostMinor: 500_000_000,
      vatMode: 'INCLUSIVE',
      supplierChargesVat: false,
      verified: false,
    },
  ];
  input.schedule.contractDurationDays = 90;
  input.schedule.deliveryDay = 60;
  input.schedule.paymentDelayDays = 15;

  const saved = await a.post(`/api/tenders/${tenderId}/finance`, { data: { input } });
  expect(saved.status()).toBe(200);

  // Снижение начальной цены ниже прежнего предложения.
  const response = await a.post(`/api/guard/watches/${watchId}/snapshots`, {
    data: { startPrice: 7_000_000, deliveryDeadline: inDays(60) },
  });
  expect(response.status()).toBe(201);
  const payload = (await response.json()).data;
  const risk = payload.risk as {
    verdict: string;
    applied: string[];
    before: { netMinor: number };
    after: { netMinor: number };
    bidExceedsNewStartPrice: boolean;
    notes: string[];
  };

  expect(risk.applied.join(' ')).toMatch(/начальная цена/);
  expect(risk.bidExceedsNewStartPrice).toBe(true);
  expect(risk.notes.join(' ')).toMatch(/подать её нельзя/);
  // Прибыль пересчитана, а не оценена на глаз.
  expect(risk.after.netMinor).toBeLessThan(risk.before.netMinor);
  expect(['PROFIT_CHANGED', 'NOW_LOSS']).toContain(risk.verdict);

  // Сокращение срока поставки зафиксировано отдельным изменением.
  const kinds = (payload.changes as Array<{ kind: string; requiresRecalc: boolean }>);
  const delivery = kinds.find((change) => change.kind === 'DELIVERY_DEADLINE_MOVED');
  expect(delivery?.requiresRecalc).toBe(true);
});

test('изменения попадают в уведомления и отмечаются просмотренными', async () => {
  const list = await a.get('/api/guard/changes');
  expect(list.status()).toBe(200);
  const payload = (await list.json()).data;
  expect(payload.pending).toBeGreaterThan(0);
  expect(payload.critical).toBeGreaterThan(0);

  const first = payload.items[0] as { id: string };
  expect((await a.post(`/api/guard/changes/${first.id}/ack`)).status()).toBe(200);

  const after = await a.get('/api/guard/changes');
  const afterPayload = (await after.json()).data;
  expect(afterPayload.pending).toBe(payload.pending - 1);

  // Повторная отметка не ошибка и ничего не меняет.
  const again = await a.post(`/api/guard/changes/${first.id}/ack`);
  expect(again.status()).toBe(200);
  expect((await again.json()).data.alreadyAcknowledged).toBe(true);
});

test('история редакций и изменений сохраняется', async () => {
  const response = await a.get(`/api/guard/watches/${watchId}`);
  expect(response.status()).toBe(200);
  const payload = (await response.json()).data;
  expect(payload.snapshots.length).toBeGreaterThanOrEqual(4);
  expect(payload.changes.length).toBeGreaterThanOrEqual(2);
  // Каждое изменение привязано к редакциям, между которыми оно найдено.
  for (const change of payload.changes) {
    expect(change.toSnapshot.revision).toBeGreaterThan(0);
  }
});

test('ГЛАВНОЕ: наблюдение другой компании недоступно', async () => {
  expect((await b.get(`/api/guard/watches/${watchId}`)).status()).toBe(404);
  expect(
    (await b.post(`/api/guard/watches/${watchId}/snapshots`, { data: {} })).status(),
  ).toBe(404);

  const change = await db.watchChange.findFirstOrThrow({
    where: { watch: { companyId: companyA } },
  });
  expect((await b.post(`/api/guard/changes/${change.id}/ack`)).status()).toBe(404);
  expect((await b.get('/api/guard/watches')).status()).toBe(200);
  expect((await (await b.get('/api/guard/watches')).json()).data).toEqual([]);
});

test('снятие с контроля сохраняет историю и запрещает новые редакции', async () => {
  const stopped = await a.delete(`/api/guard/watches/${watchId}`);
  expect(stopped.status()).toBe(200);
  expect((await stopped.json()).data.historyKept).toBe(true);

  const blocked = await a.post(`/api/guard/watches/${watchId}/snapshots`, { data: {} });
  expect(blocked.status()).toBe(409);

  // История на месте.
  const history = await a.get(`/api/guard/watches/${watchId}`);
  expect((await history.json()).data.snapshots.length).toBeGreaterThanOrEqual(4);
});

test('посторонние поля в редакции не принимаются', async () => {
  const response = await a.post(`/api/guard/watches/${watchId}/snapshots`, {
    data: { startPrice: 1000, somethingElse: true },
  });
  expect(response.status()).toBe(422);
});
