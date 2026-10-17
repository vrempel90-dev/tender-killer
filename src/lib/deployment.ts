/** Server runtime configuration; never bake the staging flag into a public bundle. */
export function isStaging(env: Record<string, string | undefined> = process.env): boolean {
  if (env.RAILWAY_ENVIRONMENT_NAME === 'production') return false;
  return env.APP_ENV === 'staging' || env.RAILWAY_ENVIRONMENT_NAME === 'staging';
}
