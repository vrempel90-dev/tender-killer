import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { checkAiAvailability } from '../availability';

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubEnv('AI_PROVIDER', 'ollama');
  vi.stubEnv('OLLAMA_BASE_URL', 'http://127.0.0.1:11434');
  vi.stubEnv('OLLAMA_MODEL', 'qwen3:8b');
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  vi.stubEnv('AI_EXTERNAL_TRANSFER_APPROVED', 'false');
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetAllMocks(); });

it('reports the default local model without any Anthropic key or inference', async () => {
  delete process.env.AI_PROVIDER;
  fetchMock.mockResolvedValueOnce(Response.json({ models: [{ name: 'qwen3:8b', digest: 'fixture' }] }))
    .mockResolvedValueOnce(Response.json({ capabilities: ['completion'] }));
  expect(await checkAiAvailability()).toMatchObject({ state: 'available', title: 'Ollama доступна' });
  expect(fetchMock.mock.calls.map(c => new URL(c[0]).pathname)).toEqual(['/api/tags', '/api/show']);
  for (const [, options] of fetchMock.mock.calls) {
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.redirect).toBe('error');
  }
});
it('does not confuse a configured URL with a reachable server or leak errors', async () => {
  fetchMock.mockRejectedValue(new Error('private host and secret'));
  const result = await checkAiAvailability();
  expect(result.state).toBe('unavailable');
  expect(JSON.stringify(result)).not.toMatch(/private|secret|127\.0\.0\.1|ANTHROPIC/);
});
it('reports missing models as unavailable without downloading them', async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ models: [] }));
  expect((await checkAiAvailability()).state).toBe('unavailable');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it('rejects a remote model even when its name matches', async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ models: [{ name: 'qwen3:8b', digest: 'fixture' }] }))
    .mockResolvedValueOnce(Response.json({ remote_host: 'https://ollama.com' }));
  expect((await checkAiAvailability()).state).toBe('unavailable');
});
it('rejects untrusted endpoints without a network request', async () => {
  vi.stubEnv('OLLAMA_BASE_URL', 'https://external.example.com');
  expect((await checkAiAvailability()).state).toBe('not_configured');
  expect(fetchMock).not.toHaveBeenCalled();
});
it('never probes or charges an external provider from the dashboard', async () => {
  vi.stubEnv('AI_PROVIDER', 'anthropic');
  expect((await checkAiAvailability()).state).toBe('not_configured');
  vi.stubEnv('ANTHROPIC_API_KEY', 'synthetic-placeholder');
  vi.stubEnv('AI_EXTERNAL_TRANSFER_APPROVED', 'true');
  expect((await checkAiAvailability()).state).toBe('unverified');
  expect(fetchMock).not.toHaveBeenCalled();
});
it('coalesces concurrent probes and expires metadata after 15 seconds', async () => {
  vi.resetModules();
  const { getAiAvailability } = await import('../availability');
  const now = vi.spyOn(Date, 'now').mockReturnValue(100_000);
  fetchMock.mockResolvedValue(Response.json({ models: [] }));
  try {
    const first = getAiAvailability();
    expect(getAiAvailability()).toBe(first);
    await first;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    now.mockReturnValue(115_001);
    // A fresh response body is needed for the second probe.
    fetchMock.mockResolvedValueOnce(Response.json({ models: [] }));
    await getAiAvailability();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  } finally { now.mockRestore(); }
});
