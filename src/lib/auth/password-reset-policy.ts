import { randomBytes, createHash } from 'node:crypto';
import { z } from 'zod';
import { RequestError } from '../security/request';

export const RESET_TTL_MS = 30 * 60_000;
export { RESET_MESSAGE } from './password-reset-messages';
export const ResetEmailSchema = z.object({ email: z.string().trim().toLowerCase().max(254).pipe(z.email('Некорректный e-mail')) });
export const ResetPasswordSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/, 'Ссылка недействительна или устарела'),
  password: z.string().min(10).max(256),
  confirmPassword: z.string().min(1).max(256),
}).refine(v => v.password === v.confirmPassword, { path: ['confirmPassword'], message: 'Пароли не совпадают' });

export function createResetSecret() {
  const token = randomBytes(32).toString('hex');
  return { token, tokenHash: hashResetSecret(token) };
}
export function hashResetSecret(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
export function resetAppUrl(): URL {
  try {
    const url = new URL(process.env.APP_URL ?? '');
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/'
      || (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) throw new Error();
    return url;
  } catch { throw new RequestError('Восстановление пароля временно недоступно. Обратитесь к администратору.', 503); }
}
export function resetLink(token: string): string {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid reset secret');
  const url = new URL('/reset-password', resetAppUrl());
  url.searchParams.set('token', token);
  return url.toString();
}
