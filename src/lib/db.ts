import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

/**
 * Единственный экземпляр Prisma Client.
 * В dev-режиме Next.js перезагружает модули — кэшируем клиент в globalThis,
 * иначе исчерпаем пул соединений.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL не задан — смотрите .env.example');
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === 'development'
        ? ['warn', 'error']
        : ['error'],
  });
}

let moduleClient: PrismaClient | undefined;
/** Build-time imports do not need DB credentials. A real operation still fails closed. */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = moduleClient ?? globalForPrisma.prisma ?? createClient();
    moduleClient = client;
    if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = client;
    const value = Reflect.get(client, property, client);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});
