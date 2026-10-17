#!/usr/bin/env node
/* global fetch, URL, AbortSignal */
// Exact authorized validation origin; all accounts are created by this run.
// No database access, production calls, quota changes or real-account deletion.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
const origin = 'https://tk-validation-web-staging.up.railway.app';
assert.equal(process.env.STAGING_BASE_URL, origin, 'Only the approved validation origin is allowed');
function client() {
  let cookie = '';
  return async (path, data, method = data === undefined ? 'GET' : 'POST') => {
    const response = await fetch(new URL(path, origin), { method, headers: {
      Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
    }, body: data === undefined ? undefined : JSON.stringify(data), redirect: 'manual', signal: AbortSignal.timeout(60_000) });
    for (const value of response.headers.getSetCookie()) if (value.startsWith('tk_session=')) cookie = value.split(';', 1)[0];
    const text = await response.text();
    const body = response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : null;
    return { status: response.status, headers: response.headers, body, text };
  };
}
const status = (response, expected) => assert.equal(response.status, expected, `Unexpected HTTP status: expected ${expected}`);
async function account() {
  const call = client(), email = `tk-auth-${randomUUID()}@example.test`, password = randomBytes(24).toString('hex') + '-Aa1';
  const created = await call('/api/auth/register', { companyName: 'SYNTHETIC AUTH QA', name: 'Synthetic owner', email, password, taxRegime: 'GENERAL_NO_VAT' });
  status(created, 201); assert.equal(created.body.data.mfaGate, 'OK'); assert.equal(created.body.data.next, '/dashboard');
  status(await call('/api/tenders'), 200);
  assert.equal((await call('/mfa')).headers.get('location'), '/dashboard');
  return { call, email, password, companyId: created.body.data.companyId };
}
const anonymous = client();
const login = await anonymous('/login'); status(login, 200);
assert.ok(login.text.includes('TENDER KILLER — TEST / STAGING'));
assert.ok(login.text.includes('Забыли пароль?'));
const a = await account(), b = await account();
assert.notEqual(a.companyId, b.companyId);
console.log('PASS password-only registration and /mfa redirects in two isolated companies');
status(await a.call('/api/auth/register', { companyName: 'Synthetic duplicate', name: 'Synthetic owner', email: a.email, password: a.password }), 409);
status(await a.call('/api/auth/logout', {}), 200); status(await a.call('/api/tenders'), 401);
const wrong = await a.call('/api/auth/login', { email: a.email, password: randomBytes(24).toString('hex') });
const missing = await anonymous('/api/auth/login', { email: `missing-${randomUUID()}@example.test`, password: randomBytes(24).toString('hex') });
status(wrong, 401); status(missing, 401); assert.deepEqual(wrong.body, missing.body);
status(await a.call('/api/auth/login', { email: a.email.toUpperCase(), password: a.password }), 200);
status(await a.call('/api/tenders'), 200);
console.log('PASS duplicate email, normalized login, uniform bad-password response and logout');
const tender = await a.call('/api/tenders', { title: 'SYNTHETIC AUTH QA — NO REAL PROCUREMENT' }); status(tender, 201);
const id = tender.body.data.id;
status(await b.call(`/api/tenders/${id}`), 404);
assert.ok((await b.call('/api/tenders')).body.data.every(row => row.id !== id));
console.log('PASS tenant isolation');
const mailA = await anonymous('/api/auth/forgot-password', { email: a.email });
const mailB = await anonymous('/api/auth/forgot-password', { email: `absent-${randomUUID()}@example.test` });
status(mailA, 503); status(mailB, 503); assert.deepEqual(mailA.body, mailB.body);
console.log('PASS unconfigured sender: uniform 503, no token or claimed email delivery');
const otherDevice = client();
status(await otherDevice('/api/auth/login', { email: a.email, password: a.password }), 200);
status(await a.call('/api/auth/sessions/revoke', { password: a.password }), 200);
status(await otherDevice('/api/tenders'), 401); status(await a.call('/api/tenders'), 401);
status(await a.call('/api/auth/login', { email: a.email, password: a.password }), 200);
console.log('PASS logout on all devices and successful password login afterward');
status(await a.call('/api/auth/account', { password: randomBytes(24).toString('hex'), confirmation: 'УДАЛИТЬ' }, 'DELETE'), 401);
status(await a.call('/api/tenders'), 200);
status(await a.call('/api/auth/account', { password: a.password, confirmation: 'УДАЛИТЬ' }, 'DELETE'), 200);
status(await a.call('/api/tenders'), 401);
status(await a.call('/api/auth/login', { email: a.email, password: a.password }), 401);
status(await b.call('/api/tenders'), 200);
status(await b.call('/api/auth/account', { password: b.password, confirmation: 'УДАЛИТЬ' }, 'DELETE'), 200);
console.log('PASS password-confirmed own-account deletion, invalidated login/sessions and surviving second tenant');
console.log('STAGING AUTH ACCEPTANCE PASS; only this run synthetic accounts deleted; company test records retained');
