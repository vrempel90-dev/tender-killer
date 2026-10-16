import { createHash } from 'node:crypto';
import { prisma } from '../db';
import { RequestError } from './request';

let nextCleanup = 0;
/** Atomic across all replicas. Failure is closed; no process-local fallback. */
export async function consumeQuota(scope: string, subject: string, limit: number, windowSeconds: number, amount = 1): Promise<void> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000_000_000
    || !Number.isSafeInteger(amount) || amount < 1) throw new RequestError('Лимит не настроен', 503);
  const now = Date.now();
  const bucket = Math.floor(now / (windowSeconds * 1000));
  const key = createHash('sha256').update(`${scope}:${subject}:${bucket}`).digest('hex');
  const expiresAt = new Date((bucket + 1) * windowSeconds * 1000);
  const rows = await prisma.$queryRaw<Array<{ count: number }>>`
    INSERT INTO request_quotas (key, count, "expiresAt") VALUES (${key}, ${Math.min(amount, limit + 1)}, ${expiresAt})
    ON CONFLICT (key) DO UPDATE SET count = LEAST(request_quotas.count + ${amount}, ${limit + 1})
    RETURNING count`;
  if ((rows[0]?.count ?? limit + 1) > limit) throw new RequestError('Лимит запросов исчерпан. Повторите позднее.', 429);
  if (now > nextCleanup) {
    nextCleanup = now + 3_600_000;
    await prisma.requestQuota.deleteMany({ where: { expiresAt: { lt: new Date(now) } } });
  }
}

async function claimLease(subject: string, ttlMs = 120_000): Promise<(() => Promise<void>) | null> {
  const key = createHash('sha256').update(`lease:${subject}`).digest('hex');
  const now = new Date(), expiresAt = new Date(now.getTime() + ttlMs);
  const rows = await prisma.$queryRaw<Array<{ key: string }>>`
    INSERT INTO request_quotas (key, count, "expiresAt") VALUES (${key}, 1, ${expiresAt})
    ON CONFLICT (key) DO UPDATE SET "expiresAt" = EXCLUDED."expiresAt"
    WHERE request_quotas."expiresAt" < ${now} RETURNING key`;
  if (!rows.length) return null;
  return async () => { await prisma.requestQuota.deleteMany({ where: { key, expiresAt } }); };
}

/** Shared, bounded AI admission queue. Never relies on a process-local semaphore. */
export async function acquireAiLease(companyId: string, options: {
  parallel: number; timeoutMs: number; queueTimeoutMs: number; signal?: AbortSignal;
}): Promise<() => Promise<void>> {
  const deadline = Date.now() + options.queueTimeoutMs;
  do {
    if (options.signal?.aborted) throw new RequestError('AI-запрос отменён', 409);
    const company = await claimLease(`ai-company:${companyId}`, options.timeoutMs + 10_000);
    if (company) {
      try {
        for (let slot = 0; slot < options.parallel; slot++) {
          const platform = await claimLease(`ai-platform:${slot}`, options.timeoutMs + 10_000);
          if (platform) return async () => { try { await platform(); } finally { await company(); } };
        }
      } catch (error) { await company(); throw error; }
      await company();
    }
    if (Date.now() >= deadline) break;
    const { setTimeout } = await import('node:timers/promises');
    try { await setTimeout(Math.min(250, deadline - Date.now()), undefined, { signal: options.signal }); }
    catch { throw new RequestError('AI-запрос отменён', 409); }
  } while (Date.now() <= deadline);
  throw new RequestError('Очередь AI занята. Промежуточные результаты сохранены; повторите позднее.', 429);
}

/** One upload/parser per company, four across the shared platform, across replicas. */
export async function acquireParserLease(companyId: string): Promise<() => Promise<void>> {
  const company = await claimLease(`parser-company:${companyId}`);
  if (!company) throw new RequestError('Обработка документа компании уже выполняется', 429);
  try {
    for (let slot = 0; slot < 4; slot++) {
      const platform = await claimLease(`parser-platform:${slot}`);
      if (platform) return async () => { await platform(); await company(); };
    }
    throw new RequestError('Сервис обработки занят. Повторите позднее.', 429);
  } catch (error) { await company(); throw error; }
}
