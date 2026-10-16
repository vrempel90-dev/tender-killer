import { test, expect } from '@playwright/test';
import { acquireAiLease } from '../src/lib/security/quota';
import { prisma } from '../src/lib/db';
import { randomUUID } from 'node:crypto';

test.afterAll(async () => prisma.$disconnect());
test('AI admission limits parallel requests across companies and releases a failed caller', async () => {
  const url = process.env.DATABASE_URL ?? '';
  if (!url || !['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) throw new Error('Isolated local DB required');
  const options = { parallel: 1, timeoutMs: 1000, queueTimeoutMs: 0 };
  const release = await acquireAiLease(`company-a-${randomUUID()}`, options);
  try { await expect(acquireAiLease(`company-b-${randomUUID()}`, options)).rejects.toMatchObject({ status: 429 }); }
  finally { await release(); }
  const other = await acquireAiLease(`company-b-${randomUUID()}`, options);
  await other();
  await expect(acquireAiLease('cancelled', { ...options, signal: AbortSignal.abort() })).rejects.toMatchObject({ status: 409 });
});
