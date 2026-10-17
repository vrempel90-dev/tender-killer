import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { isStaging } from '../deployment';
import { StagingNotice } from '../../components/layout/staging-notice';
import { afterEach, vi } from 'vitest';

afterEach(() => vi.unstubAllEnvs());

it('uses explicit server environment and never labels Railway production as staging', () => {
  expect(isStaging({ APP_ENV: 'staging' })).toBe(true);
  expect(isStaging({ RAILWAY_ENVIRONMENT_NAME: 'staging' })).toBe(true);
  for (const APP_ENV of [undefined, 'production', 'development', 'test']) expect(isStaging({ APP_ENV })).toBe(false);
  expect(isStaging({ APP_ENV: 'staging', RAILWAY_ENVIRONMENT_NAME: 'production' })).toBe(false);
});
it('renders the full explanation only in staging, including production builds', () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('APP_ENV', 'staging');
  vi.stubEnv('RAILWAY_ENVIRONMENT_NAME', 'staging');
  expect(renderToStaticMarkup(createElement(StagingNotice))).toContain('TENDER KILLER — TEST / STAGING');
  expect(renderToStaticMarkup(createElement(StagingNotice))).toContain('Для входа требуется тестовая учётная запись');
  vi.stubEnv('RAILWAY_ENVIRONMENT_NAME', 'production');
  expect(renderToStaticMarkup(createElement(StagingNotice))).toBe('');
});
