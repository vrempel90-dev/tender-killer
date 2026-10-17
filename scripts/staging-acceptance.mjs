#!/usr/bin/env node
/* global fetch, URL, AbortSignal, Buffer, FormData, Blob */
// Real staging acceptance test. Synthetic users only. Must NEVER point at production.
import assert from 'node:assert/strict';
import { createHmac, randomUUID, createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const base = new URL(process.env.STAGING_BASE_URL ?? '');
assert.equal(base.protocol, 'https:', 'Staging must use HTTPS');
assert.equal(base.origin, 'https://tk-validation-web-staging.up.railway.app',
  'Refusing to run against production or an unapproved host');
const origin = base.origin;

function totp(secret) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let n = 0, bits = 0;
  const bytes = [];
  for (const ch of secret.toUpperCase().replace(/=+$/g, '')) {
    const i = chars.indexOf(ch);
    assert.ok(i >= 0, 'Invalid TOTP secret');
    n = (n << 5) | i; bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((n >>> bits) & 255); }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const at = digest[digest.length - 1] & 15;
  return ((digest.readUInt32BE(at) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}

function client() {
  let cookie = '';
  return {
    async call(path, { method = 'GET', json, form, timeout = 20_000 } = {}) {
      const headers = { Origin: origin };
      if (cookie) headers.Cookie = cookie;
      let body;
      if (json !== undefined) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(json);
      } else if (form !== undefined) body = form;
      const res = await fetch(new URL(path, origin), {
        method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(timeout),
      });
      for (const raw of res.headers.getSetCookie()) {
        const pair = raw.split(';', 1)[0];
        if (pair.startsWith('tk_session=')) cookie = pair;
      }
      const type = res.headers.get('content-type') || '';
      const bytes = await res.arrayBuffer();
      let data;
      if (type.includes('application/json')) {
        try { data = JSON.parse(Buffer.from(bytes).toString('utf8')); } catch { data = undefined; }
      }
      return { status: res.status, data, bytes: Buffer.from(bytes), text: Buffer.from(bytes).toString('utf8') };
    },
  };
}
function expectStatus(value, status, label) {
  assert.equal(value.status, status, label + ' HTTP ' + value.status + ' ' + value.text.slice(0, 240));
}
async function register(name) {
  const a = client();
  const response = await a.call('/api/auth/register', {
    method: 'POST', json: {
      companyName: 'CI isolated ' + name,
      email: 'tk-staging-' + randomUUID() + '@example.test',
      name: 'Synthetic QA User',
      password: randomBytes(24).toString('hex') + '-Aa1',
      taxRegime: 'GENERAL_NO_VAT',
    },
  });
  expectStatus(response, 201, 'register ' + name);
  assert.equal(response.data.data.mfaGate, 'OK', 'MFA enrollment must be voluntary');
  expectStatus(await a.call('/api/tenders'), 200, 'password-only access ' + name);
  const enrolled = await a.call('/api/auth/mfa/enroll', { method: 'POST', json: {} });
  expectStatus(enrolled, 200, 'mfa enroll ' + name);
  const url = new URL(enrolled.data.data.otpauthUri);
  const secret = url.searchParams.get('secret');
  assert.ok(secret);
  const verified = await a.call('/api/auth/mfa/confirm', {
    method: 'POST', json: { token: totp(secret) },
  });
  expectStatus(verified, 200, 'mfa confirm ' + name);
  return a;
}

const anonymous = client();
const health = await anonymous.call('/api/health');
expectStatus(health, 200, 'health / PostgreSQL');
assert.equal(health.data?.checks?.database, 'ok');
console.log('PASS staging database and health');

const login = await anonymous.call('/login');
expectStatus(login, 200, 'login page');
assert.match(login.text, /Забыли пароль\?/);
const forgot = await anonymous.call('/forgot-password');
expectStatus(forgot, 200, 'forgot-password page');
const unavailableMail = await anonymous.call('/api/auth/forgot-password', {
  method: 'POST', json: { email: 'nobody-' + randomUUID() + '@example.test' },
});
assert.ok([503, 429].includes(unavailableMail.status),
  'Unconfigured sender must fail safely (503), or return the same account-independent rate limit (429)');
console.log('PASS login, forgot-password, safe email failure');

const a = await register('A');
const b = await register('B');
console.log('PASS registration, MFA for two isolated companies');

const aiInfo = await a.call('/api/settings/ai');
expectStatus(aiInfo, 200, 'AI settings');
assert.equal(aiInfo.data?.data?.provider, 'ollama');
assert.equal(aiInfo.data?.data?.model, 'qwen3:4b');
const aiTest = await a.call('/api/settings/ai', { method: 'POST', json: {}, timeout: 330_000 });
expectStatus(aiTest, 200, 'real CPU Qwen3 structured generation');
assert.equal(aiTest.data?.data?.test, 'passed');
console.log('PASS real Ollama qwen3:4b response via Railway private DNS');

const created = await a.call('/api/tenders', {
  method: 'POST', json: { title: 'SYNTHETIC QA TENDER — NOT A REAL PROCUREMENT' },
});
expectStatus(created, 201, 'create tender');
const tenderId = created.data?.data?.id;
assert.ok(tenderId);
const aList = await a.call('/api/tenders');
expectStatus(aList, 200, 'list own tenders');
assert.ok(aList.data?.data?.some(t => t.id === tenderId));

const bList = await b.call('/api/tenders');
expectStatus(bList, 200, 'list other company tenders');
assert.ok(bList.data?.data?.every(t => t.id !== tenderId), 'tenant data leak');
const bRead = await b.call('/api/tenders/' + tenderId);
expectStatus(bRead, 404, 'tenant IDOR protection');
console.log('PASS tenders and tenant isolation');

const bytes = await readFile('src/lib/documents/__tests__/fixtures/spec.pdf');
const form = new FormData();
form.set('tenderId', tenderId);
form.set('kind', 'TECHNICAL_SPEC');
form.set('file', new Blob([bytes], { type: 'application/pdf' }), 'staging-spec.pdf');
const uploaded = await a.call('/api/documents/upload', {
  method: 'POST', form, timeout: 120_000,
});
expectStatus(uploaded, 201, 'PDF upload through real ClamAV and encrypted volume');
const documentId = uploaded.data?.data?.documentId;
assert.ok(documentId);
const saved = await a.call('/api/documents/' + documentId + '/download');
expectStatus(saved, 200, 'encrypted PDF round-trip');
assert.equal(createHash('sha256').update(saved.bytes).digest('hex'),
  createHash('sha256').update(bytes).digest('hex'));
console.log('PASS ClamAV, encrypted file storage and PDF download');

// Optional real model-on-PDF acceptance, not a mock. Disabled in quick smoke so
// a slow CPU model cannot hide core regression results.
if (process.env.STAGING_AI_DOCUMENT_TEST === 'true') {
  const analyzed = await a.call('/api/tenders/' + tenderId + '/requirements', {
    method: 'POST',
    json: { documentIds: [documentId] },
    timeout: 330_000,
  });
  expectStatus(analyzed, 200, 'AI requirements extraction from uploaded PDF');
  assert.ok(analyzed.data?.data, 'Expected structured, reviewable requirements');
  const requirements = await a.call('/api/tenders/' + tenderId + '/requirements');
  expectStatus(requirements, 200, 'Read AI requirements');
  assert.ok(Array.isArray(requirements.data?.data));
  console.log('PASS real PDF -> Ollama -> persisted requirements, with manual review');
}
console.log('STAGING ACCEPTANCE PASS; synthetic accounts only');
