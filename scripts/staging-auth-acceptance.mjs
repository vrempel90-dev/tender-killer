#!/usr/bin/env node
/* global fetch, URL, AbortSignal, Buffer */
// Synthetic accounts only; no DB connection, quota reset, password reset or production requests.
import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const origin = 'https://tk-validation-web-staging.up.railway.app';
const wrongPassword = randomBytes(24).toString('hex');
assert.equal(process.env.STAGING_BASE_URL, origin, 'Only the explicitly approved staging origin is allowed');
function client() {
  let cookie = '';
  return async (path, json) => {
    const res = await fetch(origin + path, { method: json === undefined ? 'GET' : 'POST',
      headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}),
        ...(json === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: json === undefined ? undefined : JSON.stringify(json), redirect: 'manual', signal: AbortSignal.timeout(30_000) });
    for (const value of res.headers.getSetCookie()) if (value.startsWith('tk_session=')) cookie = value.split(';', 1)[0];
    const text = await res.text();
    let data;
    if (res.headers.get('content-type')?.includes('application/json')) data = JSON.parse(text);
    return { status: res.status, headers: res.headers, data, text };
  };
}
function status(res, expected) { assert.equal(res.status, expected, 'Unexpected HTTP status'); }
function totp(secret, now) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let n = 0, bits = 0;
  const bytes = [];
  for (const ch of secret) {
    n = (n << 5) | alphabet.indexOf(ch); bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((n >>> bits) & 255); }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
  const digest = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const at = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(at) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}
async function enroll(call) {
  const start = await call('/api/auth/mfa/enroll', {}); status(start, 200);
  const secret = new URL(start.data.data.otpauthUri).searchParams.get('secret');
  assert.ok(secret);
  // The test runner's clock may differ from Railway's. Use server time only
  // to generate this synthetic account's code; never alter MFA/server clocks.
  const serverTime = Date.parse(start.headers.get('date') ?? '');
  assert.ok(Number.isFinite(serverTime), 'Server Date is required for the TOTP test');
  const confirm = await call('/api/auth/mfa/confirm', { token: totp(secret, serverTime) }); status(confirm, 200);
  return confirm.data.data.recoveryCodes;
}
async function account(label) {
  const call = client(), email = 'tk-auth-' + randomUUID() + '@example.test';
  const password = randomBytes(24).toString('hex') + '-Aa1';
  const created = await call('/api/auth/register', { companyName: 'SYNTHETIC AUTH QA ' + label,
    name: 'Synthetic QA owner', taxRegime: 'GENERAL_NO_VAT', email, password });
  status(created, 201);
  assert.equal(created.data.data.mfaGate, 'ENROLL_REQUIRED');
  status(await call('/api/tenders'), 403);
  return { call, email, password, companyId: created.data.data.companyId };
}

const anonymous = client();
const page = await anonymous('/login'); status(page, 200);
assert.ok(page.text.includes('TENDER KILLER — TEST / STAGING'));
assert.ok(page.text.includes('Для входа требуется тестовая учётная запись'));
console.log('PASS runtime staging banner and separate-account explanation');

const a = await account('A');
status(await a.call('/api/auth/logout', {}), 200);
status(await a.call('/api/tenders'), 401);
let loggedIn = await a.call('/api/auth/login', { email: a.email, password: a.password }); status(loggedIn, 200);
assert.equal(loggedIn.data.data.mfaGate, 'ENROLL_REQUIRED');
assert.equal(loggedIn.data.data.next, '/mfa');
const codesA = await enroll(a.call);
status(await a.call('/api/tenders'), 200);
status(await a.call('/api/auth/logout', {}), 200);
const wrong = await a.call('/api/auth/login', { email: a.email, password: wrongPassword });
const absent = await anonymous('/api/auth/login', { email: randomUUID() + '@example.test', password: wrongPassword });
status(wrong, 401); status(absent, 401); assert.deepEqual(wrong.data, absent.data);
assert.equal(wrong.headers.get('set-cookie'), null); assert.equal(absent.headers.get('set-cookie'), null);
loggedIn = await a.call('/api/auth/login', { email: a.email.toUpperCase(), password: a.password }); status(loggedIn, 200);
assert.equal(loggedIn.data.data.mfaGate, 'VERIFY_REQUIRED');
status(await a.call('/api/tenders'), 403);
status(await a.call('/api/auth/mfa/verify', { token: codesA[0] }), 200);
status(await a.call('/api/tenders'), 200);
console.log('PASS registration, first and repeat login, logout, uniform 401, required MFA');

const b = await account('B');
assert.notEqual(a.companyId, b.companyId);
const codesB = await enroll(b.call);
const tender = await a.call('/api/tenders', { title: 'SYNTHETIC AUTH QA — NO REAL DATA' }); status(tender, 201);
const tenderId = tender.data.data.id;
status(await b.call('/api/tenders/' + tenderId), 404);
const own = await a.call('/api/tenders'); status(own, 200);
assert.ok(own.data.data.some(t => t.id === tenderId));
const other = await b.call('/api/tenders'); status(other, 200);
assert.ok(other.data.data.every(t => t.id !== tenderId));
console.log('PASS isolated users, companies and tender access');

// No real mail is sent; this environment has no sender/key. Both accounts see the same response.
const mailKnown = await anonymous('/api/auth/forgot-password', { email: a.email });
const mailAbsent = await anonymous('/api/auth/forgot-password', { email: randomUUID() + '@example.test' });
status(mailKnown, 503); status(mailAbsent, 503); assert.deepEqual(mailKnown.data, mailAbsent.data);
console.log('PASS unconfigured email: uniform 503, no claimed delivery');

await a.call('/api/auth/logout', {});
let blocked;
for (let i = 0; i < 11; i++) {
  const res = await a.call('/api/auth/login', { email: a.email, password: wrongPassword });
  if (res.status === 429) { blocked = res; break; }
  status(res, 401);
}
assert.ok(blocked, 'Existing ten-attempt quota must block');
const retry = Number(blocked.headers.get('retry-after'));
assert.ok(retry > 0 && retry <= 900);
assert.equal(blocked.data.details.retryAfterSeconds, retry);
assert.equal(blocked.data.error, `Слишком много попыток входа. Попробуйте через ${Math.ceil(retry / 60)} минут`);
status(await a.call('/api/auth/login', { email: a.email, password: a.password }), 429);
// A blocked account never locks out another company.
await b.call('/api/auth/logout', {});
status(await b.call('/api/auth/login', { email: b.email, password: b.password }), 200);
status(await b.call('/api/auth/mfa/verify', { token: codesB[0] }), 200);
console.log('PASS ten-attempt quota, accurate Retry-After, independent second account');

const deadline = Date.now() + (retry + 2) * 1000;
while (Date.now() < deadline) {
  const remaining = Math.ceil((deadline - Date.now()) / 1000);
  console.log('WAIT real server quota expiry; ' + remaining + ' seconds remain');
  await delay(Math.min(30_000, deadline - Date.now()));
}
const recovered = await a.call('/api/auth/login', { email: a.email, password: a.password }); status(recovered, 200);
assert.equal(recovered.data.data.mfaGate, 'VERIFY_REQUIRED');
status(await a.call('/api/tenders'), 403);
status(await a.call('/api/auth/mfa/verify', { token: codesA[1] }), 200);
status(await a.call('/api/tenders'), 200);
await a.call('/api/auth/logout', {}); await b.call('/api/auth/logout', {});
console.log('PASS real quota expiry, correct-password login and MFA after expiry');
console.log('STAGING AUTH ACCEPTANCE PASS; synthetic accounts retained; no production requests');
