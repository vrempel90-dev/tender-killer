// Explicit local test server. In-memory only; never connects to an email provider.
import http from 'node:http';
import { URL } from 'node:url';
import { randomUUID } from 'node:crypto';
const port = Number(process.env.EMAIL_TEST_PORT ?? 8025);
const messages = [];
const failing = new Set();
const failures = new Map();
http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  const reply = (status, body) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(body)); };
  let data = '';
  for await (const bytes of request) {
    data += bytes;
    if (data.length > 32_768) { reply(413, {}); return; }
  }
  if (request.method === 'POST' && url.pathname === '/email') {
    let mail;
    try { mail = JSON.parse(data); } catch { reply(400, {}); return; }
    if (!mail.to?.every(to => to.endsWith('@example.test'))) { reply(400, {}); return; }
    if (failing.has(mail.to[0])) {
      failures.set(mail.to[0], (failures.get(mail.to[0]) ?? 0) + 1);
      reply(503, { error: 'test failure' }); return;
    }
    const id = randomUUID(); messages.push({ ...mail, id }); reply(200, { id }); return;
  }
  if (request.method === 'POST' && url.pathname === '/failure') {
    const { email, enabled } = JSON.parse(data);
    if (enabled) failing.add(email); else failing.delete(email);
    reply(200, {}); return;
  }
  if (request.method === 'GET' && url.pathname === '/messages') {
    reply(200, messages.filter(mail => mail.to.includes(url.searchParams.get('to')))); return;
  }
  if (url.pathname === '/failures') { reply(200, { count: failures.get(url.searchParams.get('to')) ?? 0 }); return; }
  if (url.pathname === '/health') { reply(200, { testOnly: true }); return; }
  reply(404, {});
}).listen(port, '127.0.0.1', () => console.log('Loopback-only email test sink ready'));
