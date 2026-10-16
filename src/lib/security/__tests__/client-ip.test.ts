import { afterEach, expect, it, vi } from 'vitest';
import { trustedClientIp } from '../client-ip';
afterEach(() => vi.unstubAllEnvs());
it('ignores arbitrary proxy headers without a trusted ingress contract', () => {
  vi.stubEnv('RAILWAY_PROJECT_ID', ''); vi.stubEnv('APP_ENV', 'production'); vi.stubEnv('AUTH_TRUSTED_IP_HEADER', '');
  expect(trustedClientIp(new Request('https://example.test', { headers: { 'x-forwarded-for': '192.0.2.1', 'x-real-ip': '192.0.2.2' } }))).toBeNull();
});
it('uses the Railway edge X-Real-IP and ignores conflicting XFF', () => {
  vi.stubEnv('RAILWAY_PROJECT_ID', 'test-project');
  const headers = { 'x-real-ip': '2001:db8::1', 'x-forwarded-for': '192.0.2.1' };
  expect(trustedClientIp(new Request('https://example.test', { headers }))).toBe('2001:db8::1');
  expect(trustedClientIp(new Request('https://example.test', { headers: { 'x-real-ip': 'malformed' } }))).toBeNull();
});
it('allows the synthetic XFF test fixture only on an explicit local test app', () => {
  vi.stubEnv('RAILWAY_PROJECT_ID', ''); vi.stubEnv('AUTH_TRUSTED_IP_HEADER', '');
  vi.stubEnv('APP_ENV', 'test'); vi.stubEnv('APP_URL', 'http://127.0.0.1:3108');
  const request = new Request('http://127.0.0.1:3108', { headers: { 'x-forwarded-for': '192.0.2.1' } });
  expect(trustedClientIp(request)).toBe('192.0.2.1');
  vi.stubEnv('APP_URL', 'https://public.example.test'); expect(trustedClientIp(request)).toBeNull();
});
