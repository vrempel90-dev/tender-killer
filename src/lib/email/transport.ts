import { z } from 'zod';
import { RequestError } from '../security/request';
import { resetAppUrl } from '../auth/password-reset-policy';

type Email = { to: string; subject: string; html: string; text: string; id: string };
type MailConfig = { provider: 'resend' | 'test'; from: string; url: string; apiKey?: string };
const unavailable = () => new RequestError('Восстановление пароля временно недоступно. Повторите позднее.', 503);

export function resetMailConfig(): MailConfig {
  const app = resetAppUrl();
  if (process.env.EMAIL_PROVIDER === 'test') {
    // Test sink cannot send over the Internet, even in a production build.
    const sink = new URL(process.env.EMAIL_TEST_URL ?? 'http://127.0.0.1:8025/email');
    if (process.env.APP_ENV !== 'test' || !['localhost', '127.0.0.1', '[::1]'].includes(app.hostname)
      || sink.hostname !== '127.0.0.1' || sink.protocol !== 'http:' || sink.username || sink.password
      || sink.pathname !== '/email' || sink.search || sink.hash) throw unavailable();
    return { provider: 'test', from: 'TENDER KILLER <test@example.invalid>', url: sink.toString() };
  }
  const from = process.env.EMAIL_FROM ?? '';
  const address = from.match(/<([^<>]+)>$/)?.[1] ?? from;
  if (process.env.EMAIL_PROVIDER !== 'resend' || process.env.EMAIL_DOMAIN_VERIFIED !== 'true'
    || !z.email().safeParse(address).success || /[\r\n]/.test(from)
    || !process.env.RESEND_API_KEY) throw unavailable();
  return { provider: 'resend', from, url: 'https://api.resend.com/emails', apiKey: process.env.RESEND_API_KEY };
}

export async function sendResetEmail(mail: Email): Promise<void> {
  const config = resetMailConfig();
  // No tracking pixels, raw provider errors, automatic retries or logged links.
  const response = await fetch(config.url, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8_000),
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'password-reset/' + mail.id,
      ...(config.apiKey ? { Authorization: 'Bearer ' + config.apiKey } : {}) },
    body: JSON.stringify({ from: config.from, to: [mail.to], subject: mail.subject, html: mail.html, text: mail.text }),
  });
  if (!response.ok) { await response.body?.cancel(); throw unavailable(); }
  const reader = response.body?.getReader();
  if (!reader) throw unavailable();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) { await reader.cancel(); throw unavailable(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw unavailable(); }
  if (!z.object({ id: z.string().min(1).max(256) }).safeParse(value).success) throw unavailable();
}
