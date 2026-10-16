// Regression check for parser files resolved dynamically outside Next's module graph.
import { Worker } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout, clearTimeout } from 'node:timers';
const runtime = path.resolve('.next/standalone');
const buffer = await readFile('src/lib/documents/__tests__/fixtures/spec.pdf');
await new Promise((resolve, reject) => {
  const worker = new Worker(path.join(runtime, '.workers/extract.cjs'), {
    workerData: { buffer, mimeType: 'application/pdf', originalName: 'spec.pdf' },
    env: { NODE_ENV: 'production' },
    resourceLimits: { maxOldGenerationSizeMb: 192 },
  });
  const timeout = setTimeout(() => { void worker.terminate(); reject(new Error('Standalone PDF timed out')); }, 30000);
  worker.once('error', error => { clearTimeout(timeout); reject(error); });
  worker.once('message', result => {
    clearTimeout(timeout); void worker.terminate();
    if (result.ok && result.data.status === 'SUCCEEDED' && result.data.charCount > 20) resolve();
    else reject(new Error('Standalone PDF parser failed'));
  });
});
console.log('Standalone PDF worker dependency check PASS');
