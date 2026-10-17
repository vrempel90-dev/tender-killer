// Shared text and Retry-After parsing only; safe in client components.
export function loginRetryMessage(seconds: number): string {
  return `Слишком много попыток входа. Попробуйте через ${Math.max(1, Math.ceil(seconds / 60))} минут`;
}

export function loginRetrySeconds(header: string | null, detail: unknown, now = Date.now()): number | null {
  const seconds = header && /^\d+$/.test(header) ? Number(header)
    : header ? Math.ceil((Date.parse(header) - now) / 1000) : detail;
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 && seconds <= 86_400
    ? Math.ceil(seconds) : null;
}
