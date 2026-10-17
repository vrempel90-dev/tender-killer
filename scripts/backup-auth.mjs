// Versioned encrypt-then-MAC sidecar. Passphrase stays in the environment.
import { createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

async function digest(file, passphrase, salt) {
  const key = pbkdf2Sync(passphrase, salt, 600_000, 32, 'sha512');
  try {
    const mac = createHmac('sha256', key);
    for await (const chunk of createReadStream(file)) mac.update(chunk);
    return mac.digest();
  } finally { key.fill(0); }
}
export async function authenticateBackup(mode, file, passphrase) {
  if (!passphrase || passphrase.length < 20) throw new Error('Backup passphrase must contain at least 20 characters');
  if (mode === 'create') {
    const salt = randomBytes(32);
    const mac = await digest(file, passphrase, salt);
    await writeFile(file + '.hmac', `tk-backup-mac-v2:${salt.toString('hex')}:${mac.toString('hex')}\n`, { mode: 0o600 });
  } else if (mode === 'verify') {
    const sidecar = await readFile(file + '.hmac', 'utf8');
    const match = /^tk-backup-mac-v2:([a-f0-9]{64}):([a-f0-9]{64})\n?$/.exec(sidecar);
    if (!match) throw new Error('Unsupported backup MAC. Legacy backups require an isolated legacy restore and re-encryption.');
    const mac = await digest(file, passphrase, Buffer.from(match[1], 'hex'));
    if (!timingSafeEqual(mac, Buffer.from(match[2], 'hex'))) throw new Error('Backup authentication failed');
  } else throw new Error('Expected create or verify');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await authenticateBackup(process.argv[2], process.argv[3], process.env.BACKUP_ENCRYPTION_PASSPHRASE); }
  catch { process.stderr.write('Backup authentication failed or format unsupported\n'); process.exitCode = 1; }
}
