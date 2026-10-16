/** Real daemon smoke only; no protocol stub. Run in CI or isolated local setup. */
import { readFile } from 'node:fs/promises';
import { scanDocument } from '../src/lib/documents/scanner';
async function main() {
if (process.env.CLAMAV_HOST !== '127.0.0.1' || process.env.DOCUMENT_SCAN_MODE !== 'required') {
  throw new Error('A real local ClamAV with required scanning must be configured');
}
const pdf = await readFile('src/lib/documents/__tests__/fixtures/spec.pdf');
if (await scanDocument(pdf) !== 'CLEAN') throw new Error('Real ClamAV did not confirm CLEAN PDF');
// Standard harmless antivirus test string, assembled only in test process memory.
const eicar = Buffer.from(['X5O!P%@AP[4\\PZX54(P^)7CC)7}', '$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'].join(''));
try { await scanDocument(eicar); throw new Error('EICAR not detected'); }
catch (error) {
  if (!(error instanceof Error) || !('status' in error) || error.status !== 415) throw error;
}
console.log('Real ClamAV: CLEAN PDF and EICAR rejection PASS');
}
main().catch(() => { console.error('Real ClamAV smoke FAILED'); process.exitCode = 1; });
