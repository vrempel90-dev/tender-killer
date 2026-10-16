import { Worker } from 'node:worker_threads';
import path from 'node:path';
import type { ExtractionOutcome } from './extract';
import type { XlsxExtractionResult } from './extract-xlsx';

/** A killable V8 worker bounds heap and execution time; it is not an OS security sandbox. */
export function parseIsolated<T>(params: { buffer: Buffer; mimeType?: string; originalName?: string; mode?: 'market' }): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(process.cwd(), '.workers', 'extract.cjs'), {
      workerData: params,
      env: { NODE_ENV: 'production' },
      resourceLimits: { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 },
    });
    const timeout = setTimeout(() => { void worker.terminate(); reject(new Error('Превышено время обработки документа')); }, 30_000);
    worker.once('message', result => {
      clearTimeout(timeout); void worker.terminate();
      if (result.ok) resolve(result.data as T); else reject(new Error(result.error));
    });
    worker.once('error', () => { clearTimeout(timeout); void worker.terminate(); reject(new Error('Изолированный парсер завершился с ошибкой')); });
    worker.once('exit', code => { clearTimeout(timeout); if (code !== 0) reject(new Error('Парсер остановлен по ограничению ресурсов')); });
  });
}
export const extractDocumentIsolated = (p: { buffer: Buffer; mimeType: string; originalName: string }) => parseIsolated<ExtractionOutcome>(p);
export const extractSpreadsheetIsolated = (buffer: Buffer) => parseIsolated<XlsxExtractionResult>({ buffer, mode: 'market' });
