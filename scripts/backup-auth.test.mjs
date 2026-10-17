import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { authenticateBackup } from './backup-auth.mjs';
test('salted slow MAC survives relocation and rejects wrong passwords, ciphertext changes and legacy sidecars', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tk-backup-auth-'));
  const passphrase = randomBytes(32).toString('hex');
  let file = path.join(dir, 'backup.enc');
  try {
    await writeFile(file, randomBytes(1024));
    await authenticateBackup('create', file, passphrase);
    const first = await readFile(file + '.hmac', 'utf8');
    assert.match(first, /^tk-backup-mac-v2:/);
    await authenticateBackup('verify', file, passphrase);
    await authenticateBackup('create', file, passphrase);
    assert.notEqual(await readFile(file + '.hmac', 'utf8'), first);
    const moved = path.join(dir, 'moved.enc');
    await rename(file, moved); await rename(file + '.hmac', moved + '.hmac'); file = moved;
    await authenticateBackup('verify', file, passphrase);
    await assert.rejects(authenticateBackup('verify', file, randomBytes(32).toString('hex')));
    await writeFile(file, 'tampered');
    await assert.rejects(authenticateBackup('verify', file, passphrase));
    await writeFile(file + '.hmac', 'SHA2-256(backup.enc)=legacy');
    await assert.rejects(authenticateBackup('verify', file, passphrase), /Legacy/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
