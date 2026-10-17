#!/usr/bin/env node
/**
 * Refuse regressions that would expose the local AI, database, or file scanner
 * or silently re-enable a paid model in the self-hosted distribution.
 *
 * Usage: docker compose config --format json | node scripts/check-self-host-compose.mjs
 * This reads the fully resolved Compose model from stdin; no Docker daemon needed.
 */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const config = JSON.parse(readFileSync(0, 'utf8'));
const services = config.services;
for (const name of ['app', 'db', 'migrate', 'db-roles', 'ollama', 'clamav']) {
  assert.ok(services?.[name], `Missing required service: ${name}`);
}
for (const name of ['db', 'ollama', 'clamav']) {
  assert.ok(!services[name].ports?.length, `${name} must have no published ports`);
}
for (const name of ['db-private', 'ai-private', 'scan-private']) {
  assert.equal(config.networks?.[name]?.internal, true, `Network ${name} must be internal`);
}
const networksOf = service => Object.keys(services[service].networks || {});
assert.ok(networksOf('db').some(n => n.endsWith('db-private')));
assert.ok(networksOf('ollama').some(n => n.endsWith('ai-private')));
assert.ok(networksOf('clamav').some(n => n.endsWith('scan-private')));
assert.ok(networksOf('clamav').some(n => n.endsWith('av-updates')),
  'ClamAV must have outbound access to update signatures');
for (const name of ['app', 'db', 'migrate', 'db-roles', 'ollama']) {
  assert.ok(!networksOf(name).some(n => n.endsWith('av-updates')),
    `${name} may not join the antivirus update network`);
}
for (const privateNetwork of ['db-private', 'ai-private', 'scan-private']) {
  assert.ok(networksOf('app').some(n => n.endsWith(privateNetwork)), `App must connect to ${privateNetwork}`);
}
const env = services.app.environment || {};
assert.equal(env.AI_PROVIDER, 'ollama', 'Self-host AI must be Ollama');
assert.equal(String(env.AI_EXTERNAL_TRANSFER_APPROVED), 'false', 'No external AI transfer allowed');
assert.ok(!env.ANTHROPIC_API_KEY, 'Do not inject any Anthropic key into self-hosted app');
assert.equal(env.OLLAMA_BASE_URL, 'http://ollama:11434');
assert.equal(env.DOCUMENT_SCAN_MODE, 'required');
assert.equal(env.CLAMAV_HOST, 'clamav');
assert.equal(services.app.depends_on?.clamav?.condition, 'service_healthy');
assert.equal(services.migrate.build?.target, 'migrator');
for (const [service, target] of [['ollama', '/root/.ollama'], ['clamav', '/var/lib/clamav'], ['app', '/app/storage']]) {
  assert.ok(services[service].volumes?.some(v => v.target === target && v.type === 'volume'),
    `Persistent volume missing: ${service} ${target}`);
}
const appPorts = services.app.ports || [];
assert.equal(appPorts.length, 1, 'App must only publish the local demo port');
assert.equal(appPorts[0].host_ip, '127.0.0.1', 'App may not be exposed directly to the Internet');
console.log('PASS: local AI, private networks, ClamAV, no paid fallback, persistent storage');
