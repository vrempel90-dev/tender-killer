import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../src/lib/auth/password';

test.skip(process.env.E2E_UNCONFIGURED_EMAIL !== 'true', 'Requires the separate unconfigured-mail server');
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' }) });
const headers = { Origin: process.env.E2E_BASE_URL ?? 'http://localhost:3000' };

test('missing verified sender returns uniform 503, creates no tokens and never claims delivery in UI', async ({ page, request }) => {
  const user = await db.user.create({ data: { email: randomUUID() + '@example.test', name: 'Isolated test',
    passwordHash: await hashPassword('Synthetic-only-Password-123'),
    company: { create: { name: 'Unconfigured mail test', taxRegime: 'GENERAL_NO_VAT' } } } });
  try {
    const known = await request.post('/api/auth/forgot-password', { headers, data: { email: user.email } });
    const missing = await request.post('/api/auth/forgot-password', { headers, data: { email: randomUUID() + '@example.test' } });
    expect(known.status()).toBe(503);
    expect(missing.status()).toBe(503);
    expect(await known.json()).toEqual(await missing.json());
    expect(await db.passwordResetToken.count({ where: { userId: user.id } })).toBe(0);
    await page.goto('/login');
    await page.getByRole('link', { name: 'Забыли пароль?' }).click();
    await expect(page.getByRole('heading', { name: 'Восстановление пароля' })).toBeVisible();
    await page.getByLabel('Электронная почта').fill(randomUUID() + '@example.test');
    await page.getByRole('button', { name: 'Отправить ссылку' }).click();
    await expect(page.locator('form').getByRole('alert')).toContainText('Восстановление пароля временно недоступно');
    await expect(page.getByRole('status')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Отправить ссылку' })).toBeEnabled();
  } finally { await db.company.delete({ where: { id: user.companyId } }); await db.$disconnect(); }
});
