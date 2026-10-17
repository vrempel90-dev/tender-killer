import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { consumeQuota } from '../quota';
import { RateLimitError } from '../request';

const state = vi.hoisted(() => ({ counts: new Map<string, number>(), offline: false }));
vi.mock('../../db', () => ({ prisma: {
  $queryRaw: vi.fn(async (_sql: TemplateStringsArray, key: string, amount: number) => {
    if (state.offline) throw new Error('Test database unavailable');
    const count = (state.counts.get(key) ?? 0) + amount;
    state.counts.set(key, count);
    return [{ count }];
  }),
  requestQuota: { deleteMany: vi.fn(async () => ({ count: 0 })) },
} }));

beforeEach(() => {
  vi.useFakeTimers();
  // A known quarter-hour boundary: preserve the actual 10 / 900 policy.
  vi.setSystemTime(new Date('2026-10-17T10:00:00.000Z'));
  state.counts.clear(); state.offline = false;
});
afterEach(() => vi.useRealTimers());

it('allows ten attempts, then reports remaining time without extending the window', async () => {
  for (let i = 0; i < 10; i++) await consumeQuota('auth-account', 'synthetic@example.test', 10, 900);
  await expect(consumeQuota('auth-account', 'synthetic@example.test', 10, 900))
    .rejects.toMatchObject({ status: 429, retryAfterSeconds: 900 });
  vi.advanceTimersByTime(61_001);
  await expect(consumeQuota('auth-account', 'synthetic@example.test', 10, 900))
    .rejects.toMatchObject({ retryAfterSeconds: 839 });
  await expect(consumeQuota('auth-account', 'other@example.test', 10, 900)).resolves.toBeUndefined();
  vi.setSystemTime(new Date('2026-10-17T10:14:59.999Z'));
  await expect(consumeQuota('auth-account', 'synthetic@example.test', 10, 900))
    .rejects.toMatchObject({ retryAfterSeconds: 1 });
  vi.advanceTimersByTime(1);
  await expect(consumeQuota('auth-account', 'synthetic@example.test', 10, 900)).resolves.toBeUndefined();
});

it('fails closed on database failure', async () => {
  state.offline = true;
  await expect(consumeQuota('auth-account', 'synthetic@example.test', 10, 900)).rejects.toThrow('Test database unavailable');
});

it('exposes retry metadata as a request error', () => {
  expect(new RateLimitError(77)).toMatchObject({ status: 429, retryAfterSeconds: 77 });
});
