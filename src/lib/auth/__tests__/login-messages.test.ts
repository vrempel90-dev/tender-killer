import { expect, it } from 'vitest';
import { loginRetryMessage, loginRetrySeconds } from '../login-messages';

it('rounds the displayed cooldown up to minutes', () => {
  expect(loginRetryMessage(839)).toBe('Слишком много попыток входа. Попробуйте через 14 минут');
  expect(loginRetryMessage(1)).toContain('через 1 минут');
});
it('reads delta seconds or HTTP-date, with bounded metadata fallback', () => {
  expect(loginRetrySeconds('77', 900)).toBe(77);
  expect(loginRetrySeconds('Sat, 17 Oct 2026 10:00:45 GMT', null, Date.parse('2026-10-17T10:00:00Z'))).toBe(45);
  expect(loginRetrySeconds(null, 61)).toBe(61);
  for (const bad of ['0', '-1', 'invalid', '999999999999']) expect(loginRetrySeconds(bad, null)).toBeNull();
});
