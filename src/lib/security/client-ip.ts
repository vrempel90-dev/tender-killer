import { isIP } from 'node:net';

/** Trust only the ingress contract chosen by the operator, never client XFF. */
export function trustedClientIp(request: Request): string | null {
  let localTest = false;
  try {
    localTest = process.env.APP_ENV === 'test'
      && ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(process.env.APP_URL ?? '').hostname);
  } catch { /* no trusted origin */ }
  const railway = Boolean(process.env.RAILWAY_PROJECT_ID);
  const value = railway || process.env.AUTH_TRUSTED_IP_HEADER === 'x-real-ip'
    ? request.headers.get('x-real-ip')
    : localTest ? request.headers.get('x-forwarded-for')?.split(',')[0] : null;
  const ip = value?.trim() ?? '';
  return isIP(ip) ? ip : null;
}
