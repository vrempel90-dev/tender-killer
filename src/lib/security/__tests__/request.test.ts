import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertTrustedMutation, readBoundedBody, readJson, readUploadForm } from '../request';

afterEach(() => vi.unstubAllEnvs());
const req = (origin: string, type = 'application/json') => new Request('http://localhost:3000/api/auth/login', {
  method: 'POST', headers: { origin, 'content-type': type }, body: '{}',
});
describe('request trust boundary', () => {
  it('requires HTTPS for a non-local production origin',()=>{
    vi.stubEnv('NODE_ENV','production');vi.stubEnv('APP_URL','http://example.test');
    expect(()=>assertTrustedMutation(req('http://example.test'))).toThrow(/HTTPS/);
  });
  it('rejects cross-site login and opaque origins', () => {
    vi.stubEnv('APP_URL', 'http://localhost:3000');
    expect(() => assertTrustedMutation(req('https://attacker.test', 'text/plain'))).toThrow(/Источник/);
    expect(() => assertTrustedMutation(req('null'))).toThrow(/Источник/);
    expect(() => assertTrustedMutation(req('http://localhost:3000', 'text/plain'))).toThrow(/JSON/);
    expect(() => assertTrustedMutation(req('http://localhost:3000'))).not.toThrow();
  });
  it('enforces bytes when Content-Length is absent', async () => {
    await expect(readBoundedBody(new Request('http://local', { method: 'POST', body: '12345' }), 4)).rejects.toMatchObject({ status: 413 });
  });
  it('rejects a lying small Content-Length', async () => {
    await expect(readBoundedBody(new Request('http://local', { method: 'POST', headers: { 'content-length': '1' }, body: '12345' }), 4)).rejects.toMatchObject({ status: 413 });
  });
  it('returns 400 for malformed JSON without leaking parser details', async () => {
    await expect(readJson(new Request('http://local', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }))).rejects.toMatchObject({ status: 400 });
  });
  it('caps ignored multipart fields as well as selected files', async () => {
    const form = new FormData(); form.set('file', new File(['x'], 'a.pdf')); form.set('ignored', 'x'.repeat(70_000));
    await expect(readUploadForm(new Request('http://local', { method: 'POST', body: form }), 10)).rejects.toMatchObject({ status: 413 });
  });
  it('accepts one bounded document', async () => {
    const form = new FormData(); form.set('file', new File(['%PDF-1.7'], 'a.pdf')); form.set('tenderId', 'own');
    const parsed = await readUploadForm(new Request('http://local', { method: 'POST', body: form }), 100);
    expect(parsed.get('tenderId')).toBe('own');
  });
});
