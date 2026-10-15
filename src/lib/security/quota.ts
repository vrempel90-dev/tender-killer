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
