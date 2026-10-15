import { AsyncLocalStorage } from 'node:async_hooks';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { readSessionClaims } from './auth/session-claims';

/**
 * Доступ к БД и привязка запроса к компании.
 *
 * В БД включён Row Level Security: политики сравнивают companyId строки с
 * переменной сессии app.company_id (миграция
 * 20261015190000_rls_tenant_isolation). Если переменная не установлена,
 * роль приложения не видит ни одной строки — отказ закрытый.
 *
 * Здесь эта переменная устанавливается для каждого запроса к таблицам
 * компании. Идентификатор берётся из подписанного cookie сессии и никогда
 * от клиента напрямую: подделать его без SESSION_SECRET нельзя.
 *
 * Почему из cookie, а не из контекста выполнения: AsyncLocalStorage.enterWith
 * действует только в текущем асинхронном контексте, и установка внутри
 * awaited-функции (проверки доступа) не доживает до кода вызывающего. Это
 * давало бы запросы без переменной — то есть пустые выборки под ролью
 * приложения. Cookie же доступно в любом месте обработки запроса.
 */

/**
 * Модели, строки которых принадлежат компании и защищены политиками RLS.
 * Список должен совпадать с миграцией: несовпадение означает либо
 * незащищённую таблицу, либо запрос, который молча не найдёт данных.
 */
export const TENANT_MODELS: ReadonlySet<string> = new Set([
  'Tender',
  'Document',
  'DocumentExtraction',
  'Requirement',
  'ComplianceRun',
  'ComplianceFinding',
  'LineItem',
  'SupplierQuote',
  'SupplierQuoteItem',
  'FinancialModel',
  'CompanyTaxRate',
  'HistoricalTender',
  'Report',
  'ContractAnalysis',
  'ContractRisk',
]);

interface TenantContext {
  companyId: string;
}

/** 'UNSCOPED' — осознанный выход за пределы одной компании (миграции, обслуживание). */
type Store = TenantContext | 'UNSCOPED';

const tenantStore = new AsyncLocalStorage<Store>();

/**
 * Выполняет функцию без привязки к компании: обслуживание, импорт
 * справочников, тесты. В обработчиках запросов использовать нельзя.
 */
export function runUnscoped<T>(fn: () => T): T {
  return tenantStore.run('UNSCOPED', fn);
}

/**
 * Явно задаёт компанию для фоновой работы вне HTTP-запроса.
 * В обработчиках запросов не нужно: там компания берётся из cookie.
 */
export function runWithTenant<T>(companyId: string, fn: () => T): T {
  if (!companyId) throw new Error('Пустой companyId не может быть контекстом');
  return tenantStore.run({ companyId }, fn);
}

/**
 * Компания текущей операции: явно заданный контекст, иначе компания из
 * подписанного cookie сессии. null — если ни того, ни другого нет.
 */
export async function currentTenant(): Promise<string | null> {
  const store = tenantStore.getStore();
  if (store === 'UNSCOPED') return null;
  if (store) return store.companyId;
  const claims = await readSessionClaims();
  return claims?.companyId ?? null;
}

interface Clients {
  /** Без расширения: для транзакций и обслуживания. */
  base: PrismaClient;
  /** С привязкой каждой операции к компании. */
  scoped: PrismaClient;
}

const globalForPrisma = globalThis as unknown as {
  prismaClients: Clients | undefined;
};

function createClients(): Clients {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL не задан — смотрите .env.example');
  }
  const adapter = new PrismaPg({ connectionString });
  const base = new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

  const extended = base.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, args, query }) {
          if (!TENANT_MODELS.has(model)) return query(args);

          if (tenantStore.getStore() === 'UNSCOPED') return query(args);

          const companyId = await currentTenant();
          if (!companyId) {
            // Молча вернуть пустой результат хуже, чем упасть: так ошибка
            // видна сразу, а не выглядит как «данных нет».
            throw new Error(
              `Запрос к ${model} вне контекста компании. Доступ к данным `
              + 'возможен только в обработке запроса с действующей сессией '
              + 'либо явно через runWithTenant / runUnscoped.',
            );
          }

          // set_config и сам запрос должны попасть в одну транзакцию:
          // только так они гарантированно идут по одному соединению.
          const [, result] = await base.$transaction([
            base.$executeRaw`SELECT set_config('app.company_id', ${companyId}, true)`,
            query(args) as Prisma.PrismaPromise<unknown>,
          ]);
          return result;
        },
      },
    },
  });

  // Расширенный клиент отличается по типу, но по набору операций совместим.
  return { base, scoped: extended as unknown as PrismaClient };
}

let moduleClients: Clients | undefined;

function clients(): Clients {
  const existing = moduleClients ?? globalForPrisma.prismaClients ?? createClients();
  moduleClients = existing;
  // В dev-режиме Next.js перезагружает модули — иначе исчерпаем пул соединений.
  if (process.env.NODE_ENV !== 'production') globalForPrisma.prismaClients = existing;
  return existing;
}

/** Build-time imports do not need DB credentials. A real operation still fails closed. */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = clients().scoped;
    const value = Reflect.get(client, property, client);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

/**
 * Транзакция из нескольких операций.
 *
 * Отдельная функция нужна потому, что расширение выше оборачивает каждую
 * операцию в собственную транзакцию: вложение дало бы ошибку. Здесь
 * переменная компании устанавливается один раз на всю транзакцию, а
 * операции выполняются на транзакционном клиенте без расширения.
 */
export async function dbTransaction<T>(
  run: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const companyId = await currentTenant();
  // Базовый клиент: на транзакционном клиенте расширение не применяется,
  // поэтому вложенных транзакций не возникает.
  return clients().base.$transaction(async (tx) => {
    if (companyId) {
      await tx.$executeRaw`SELECT set_config('app.company_id', ${companyId}, true)`;
    }
    return run(tx);
  });
}
