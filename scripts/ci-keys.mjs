// Disposable CI-only keys. Mask before GITHUB_ENV exposes them to later steps.
import { randomBytes } from 'node:crypto';
import { appendFileSync } from 'node:fs';
if (process.env.GITHUB_ACTIONS !== 'true' || !process.env.GITHUB_ENV) {
  throw new Error('This script runs only in GitHub Actions');
}
const keys = {
  SESSION_SECRET: randomBytes(48).toString('hex'),
  DOCUMENT_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  BACKUP_ENCRYPTION_PASSPHRASE: randomBytes(32).toString('hex'),
};
for (const [name, value] of Object.entries(keys)) {
  console.log('::add-mask::' + value);
  appendFileSync(process.env.GITHUB_ENV, name + '=' + value + '\n');
}
