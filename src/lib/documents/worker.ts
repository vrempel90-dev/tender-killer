import { parentPort, workerData } from 'node:worker_threads';
import { extractDocument } from './extract';
import { extractXlsxData } from './extract-xlsx';

const buffer = Buffer.from(workerData.buffer);
const operation = workerData.mode === 'market'
  ? extractXlsxData(buffer)
  : extractDocument({ buffer, mimeType: workerData.mimeType, originalName: workerData.originalName });
operation.then(data => parentPort?.postMessage({ ok: true, data }))
  .catch(() => parentPort?.postMessage({ ok: false, error: 'Парсер не смог прочитать документ' }));
