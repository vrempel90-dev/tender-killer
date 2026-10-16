/**
 * Хранение загруженных документов.
 *
 * Файлы лежат ВНЕ репозитория, в каталоге STORAGE_DIR, разложенные по
 * компаниям: {STORAGE_DIR}/{companyId}/{documentId}.{ext}
 * Изоляция по каталогам — дополнительный барьер к проверке прав в БД.
 *
 * На диск файлы пишутся зашифрованными (AES-256-GCM, см. encryption.ts):
 * доступ к тому или к резервной копии сам по себе не даёт содержимого.
 * Каталоги создаются с правами 0700 — только владелец процесса.
 */

import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { decryptDocument, encryptDocument } from './encryption';

/** Разрешённые типы файлов. Расширение проверяется вместе с MIME-типом. */
export const ALLOWED_UPLOAD_TYPES: Record<
  string,
  { extensions: string[]; label: string }
> = {
  'application/pdf': { extensions: ['.pdf'], label: 'PDF' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    extensions: ['.docx'],
    label: 'DOCX',
  },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    extensions: ['.xlsx'],
    label: 'XLSX',
  },
  'application/vnd.ms-excel': { extensions: ['.xlsx'], label: 'XLS' },
};

export const ALLOWED_EXTENSIONS = ['.pdf', '.docx', '.xlsx'];

export function storageRoot(): string {
  return path.resolve(/* turbopackIgnore: true */ process.env.STORAGE_DIR ?? './storage');
}

export function maxUploadBytes(): number {
  const raw = Number(process.env.MAX_UPLOAD_BYTES ?? 26_214_400);
  return Number.isFinite(raw) && raw > 0 ? raw : 26_214_400;
}

export interface UploadValidationError {
  code:
    | 'EMPTY_FILE'
    | 'TOO_LARGE'
    | 'UNSUPPORTED_TYPE'
    | 'EXTENSION_MISMATCH'
    | 'SUSPICIOUS_NAME';
  message: string;
}

/**
 * Проверка загружаемого файла до записи на диск.
 * Проверяются размер, MIME-тип, расширение и имя файла.
 */
export function validateUpload(params: {
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}): UploadValidationError | null {
  if (params.sizeBytes <= 0) {
    return { code: 'EMPTY_FILE', message: 'Файл пустой' };
  }
  const limit = maxUploadBytes();
  if (params.sizeBytes > limit) {
    return {
      code: 'TOO_LARGE',
      message: `Файл больше допустимого размера (${Math.round(limit / 1_048_576)} МБ)`,
    };
  }

  const ext = path.extname(params.originalName).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return {
      code: 'UNSUPPORTED_TYPE',
      message: `Поддерживаются только ${ALLOWED_EXTENSIONS.join(', ')}. Получено: ${ext || 'без расширения'}`,
    };
  }

  const allowed = ALLOWED_UPLOAD_TYPES[params.mimeType];
  if (!allowed) {
    return {
      code: 'UNSUPPORTED_TYPE',
      message: `Тип файла «${params.mimeType}» не поддерживается`,
    };
  }
  if (!allowed.extensions.includes(ext)) {
    return {
      code: 'EXTENSION_MISMATCH',
      message: `Расширение ${ext} не соответствует типу файла ${allowed.label}`,
    };
  }

  // Имя файла не должно содержать путей: оно используется только для показа,
  // но защищаемся от попыток выйти из каталога.
  if (/[/\\]|\.\./.test(params.originalName)) {
    return {
      code: 'SUSPICIOUS_NAME',
      message: 'Недопустимое имя файла',
    };
  }

  return null;
}

/** Относительный путь внутри STORAGE_DIR. */
export function buildStoragePath(companyId: string, originalName: string): string {
  const ext = path.extname(originalName).toLowerCase();
  return path.join(companyId, `${randomUUID()}${ext}`);
}

export function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export async function saveFile(
  relativePath: string,
  buffer: Buffer,
): Promise<void> {
  const absolute = resolveStoragePath(relativePath);
  // 0700: каталог компании не читается другими пользователями системы.
  await mkdir(path.dirname(absolute), { recursive: true, mode: 0o700 });
  // mode на writeFile — только для нового файла; существующий не меняется.
  await writeFile(absolute, encryptDocument(buffer, relativePath), { mode: 0o600 });
}

export class DocumentIntegrityError extends Error {}

/**
 * Читает файл и возвращает расшифрованное содержимое.
 *
 * expectedSha256 — контрольная сумма из БД. Сверка нужна не для защиты от
 * подмены (её закрывает тег GCM), а чтобы повреждение тома или рассинхрон
 * «запись в БД есть, файл другой» обнаруживались сразу, а не выдавались
 * пользователю как его документ.
 */
export async function readStoredFile(
  relativePath: string,
  expectedSha256?: string,
): Promise<Buffer> {
  const stored = await readFile(
    /* turbopackIgnore: true */ resolveStoragePath(relativePath),
  );
  const { plain } = decryptDocument(stored, relativePath);
  if (expectedSha256) {
    const actual = sha256(plain);
    const a = Buffer.from(actual, 'hex');
    const b = Buffer.from(expectedSha256, 'hex');
    if (a.byteLength !== b.byteLength || !timingSafeEqual(a, b)) {
      throw new DocumentIntegrityError(
        'Содержимое файла не соответствует записи в базе: документ повреждён или подменён',
      );
    }
  }
  return plain;
}

export async function deleteStoredFile(relativePath: string): Promise<void> {
  await rm(resolveStoragePath(relativePath), { force: true });
}

/**
 * Приводит относительный путь к абсолютному и проверяет, что он не выходит
 * за пределы каталога хранения.
 */
export function resolveStoragePath(relativePath: string): string {
  const root = storageRoot();
  const absolute = path.resolve(root, relativePath);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) {
    throw new Error('Путь к файлу выходит за пределы каталога хранения');
  }
  return absolute;
}
