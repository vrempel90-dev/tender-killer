import { afterEach, describe, expect, it, vi } from 'vitest';
import { createResetSecret, hashResetSecret, resetLink, ResetEmailSchema, ResetPasswordSchema, RESET_TTL_MS } from '../password-reset-policy';
import { passwordResetEmail } from '../../email/password-reset-template';
import { resetMailConfig, sendResetEmail } from '../../email/transport';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe('password recovery policy', () => {
  it('creates independent 256-bit secrets and stores a distinct SHA-256 hash', () => {
    const a = createResetSecret(), b = createResetSecret();
    expect(a.token).toMatch(/^[a-f0-9]{64}$/);
    expect(a.tokenHash).toBe(hashResetSecret(a.token));
    expect(a.tokenHash).not.toBe(a.token); expect(a.token).not.toBe(b.token);
    expect(RESET_TTL_MS).toBe(30 * 60_000);
  });
  it('normalizes email before validation and account quota', () => {
    expect(ResetEmailSchema.parse({ email: ' Owner@Example.kz ' }).email).toBe('owner@example.kz');
    expect(ResetEmailSchema.safeParse({ email: 'broken' }).success).toBe(false);
  });
  it('requires confirmation and a bounded token/password', () => {
    const valid = { token: 'a'.repeat(64), password: 'Strong-reset-123', confirmPassword: 'Strong-reset-123' };
    expect(ResetPasswordSchema.safeParse(valid).success).toBe(true);
    for (const data of [{ ...valid, token: 'bad' }, { ...valid, confirmPassword: 'different' }, { ...valid, password: 'x'.repeat(257) }]) {
      expect(ResetPasswordSchema.safeParse(data).success).toBe(false);
    }
  });
  it('builds the link only from the configured origin', () => {
    vi.stubEnv('APP_URL', 'https://tender.example.kz');
    expect(new URL(resetLink('a'.repeat(64))).origin).toBe('https://tender.example.kz');
  });
  it.each(['', 'http://public.example.kz', 'https://user:pass@example.kz', 'https://example.kz/x', 'https://example.kz/?next=evil'])('rejects unsafe APP_URL %s', url => {
    vi.stubEnv('APP_URL', url); expect(() => resetLink('a'.repeat(64))).toThrow();
  });
  it('produces Russian HTML and plain text without tracking or third-party assets', () => {
    const mail = passwordResetEmail('https://example.kz/reset-password?token=a&x="<test>');
    expect(mail.subject).toBe('TENDER KILLER — восстановление пароля');
    expect(mail.text).toContain('30 минут'); expect(mail.html).toContain('&amp;x=&quot;&lt;test&gt;');
    expect(mail.html).not.toMatch(/<script|<img|<link|<iframe/i);
  });
});
describe('email transport boundaries', () => {
  it('fails closed before domain verification, for every recipient', () => {
    vi.stubEnv('APP_URL', 'https://example.kz'); vi.stubEnv('EMAIL_PROVIDER', 'resend');
    vi.stubEnv('EMAIL_FROM', 'security@example.kz'); vi.stubEnv('RESEND_API_KEY', 'test-only-unused');
    vi.stubEnv('EMAIL_DOMAIN_VERIFIED', 'false');
    expect(() => resetMailConfig()).toThrow();
  });
  it.each(['https://public.example.kz', 'http://127.0.0.1.evil/email', 'http://127.0.0.1:8025/other'])('never permits test mail to escape loopback %s', sink => {
    vi.stubEnv('APP_URL', 'http://127.0.0.1:3108'); vi.stubEnv('APP_ENV', 'test');
    vi.stubEnv('EMAIL_PROVIDER', 'test'); vi.stubEnv('EMAIL_TEST_URL', sink);
    expect(() => resetMailConfig()).toThrow();
  });
  it('disallows a test transport on a public app origin', () => {
    vi.stubEnv('APP_URL', 'https://example.kz'); vi.stubEnv('APP_ENV', 'test');
    vi.stubEnv('EMAIL_PROVIDER', 'test');
    expect(() => resetMailConfig()).toThrow();
  });
  it('sends HTML and text to the fixed API with idempotency and no redirect', async () => {
    vi.stubEnv('APP_URL', 'https://example.kz'); vi.stubEnv('EMAIL_PROVIDER', 'resend');
    vi.stubEnv('EMAIL_FROM', 'TENDER KILLER <security@example.kz>');
    vi.stubEnv('RESEND_API_KEY', 'test-only-unused'); vi.stubEnv('EMAIL_DOMAIN_VERIFIED', 'true');
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ id: 'accepted' })); vi.stubGlobal('fetch', fetch);
    await sendResetEmail({ to: 'owner@example.test', id: 'one', ...passwordResetEmail('https://example.kz/reset-password?token=test') });
    expect(fetch.mock.calls[0]![0]).toBe('https://api.resend.com/emails');
    expect(fetch.mock.calls[0]![1]).toMatchObject({ redirect: 'error', headers: { 'Idempotency-Key': 'password-reset/one' } });
    expect(JSON.parse(String(fetch.mock.calls[0]![1]!.body))).toMatchObject({ to: ['owner@example.test'], text: expect.any(String), html: expect.any(String) });
  });
  it.each([503, 429, 401])('does not expose provider payload on HTTP %s', async status => {
    vi.stubEnv('APP_URL', 'http://127.0.0.1:3108'); vi.stubEnv('APP_ENV', 'test'); vi.stubEnv('EMAIL_PROVIDER', 'test');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private-provider-secret', { status })));
    const error = await sendResetEmail({ to: 'test@example.test', id: 'x', subject: 'x', text: 'x', html: 'x' }).catch(e => e);
    expect(error.message).not.toContain('private-provider-secret'); expect(error.status).toBe(503);
  });
  it('requires acceptance ID and bounds chunked provider output', async () => {
    vi.stubEnv('APP_URL', 'http://127.0.0.1:3108'); vi.stubEnv('APP_ENV', 'test'); vi.stubEnv('EMAIL_PROVIDER', 'test');
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({})).mockResolvedValueOnce(new Response('x'.repeat(8193)));
    vi.stubGlobal('fetch', fetch);
    const mail = { to: 'test@example.test', id: 'x', subject: 'x', text: 'x', html: 'x' };
    await expect(sendResetEmail(mail)).rejects.toThrow(); await expect(sendResetEmail(mail)).rejects.toThrow();
  });
});
