/**
 * Шифрование загруженных документов на диске.
 *
 * Зачем: в документах тендеров лежат коммерческие условия, цены и
 * персональные данные. Том с файлами может попасть в резервную копию, в
 * снимок диска или в руки оператора инфраструктуры. Без шифрования любой
 * доступ к тому — это доступ ко всем документам всех компаний.
 *
 * AES-256-GCM: шифрование и контроль целостности одним алгоритмом. В
 * качестве дополнительных данных (AAD) берётся путь файла, поэтому
 * подменить файл одной записи файлом другой не получится — расшифровка
 * не пройдёт проверку тега.
 *
 * Ключ берётся из DOCUMENT_ENCRYPTION_KEY (32 байта в base64).
 * Управление ключами (KMS, ротация) зависит от выбора хостинга и пока не
 * решено: см. docs/release-gates.md.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** Признак зашифрованного файла. Файлы без него считаются незашифрованными. */
const MAGIC = Buffer.from('TKENC1\n', 'ascii');
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export class EncryptionKeyError extends Error {}

/** Ключ шифрования или null, если он не настроен. */
export function encryptionKey(): Buffer | null {
  const raw = process.env.DOCUMENT_ENCRYPTION_KEY;
  if (!raw || raw.trim().length === 0) return null;
  let key: Buffer;
  try {
    key = Buffer.from(raw.trim(), 'base64');
  } catch {
    throw new EncryptionKeyError('DOCUMENT_ENCRYPTION_KEY не является base64');
  }
  if (key.byteLength !== KEY_BYTES) {
    throw new EncryptionKeyError(
      `DOCUMENT_ENCRYPTION_KEY должен содержать ${KEY_BYTES} байта (base64 от 32 байт), получено ${key.byteLength}`,
    );
  }
  return key;
}

/**
 * Требуется ли шифрование. В production — да: иначе документы легли бы на
 * диск в открытом виде, и это не та ошибка, которую стоит прощать молча.
 */
export function encryptionRequired(): boolean {
  return process.env.NODE_ENV === 'production'
    || process.env.DOCUMENT_ENCRYPTION_MODE === 'required';
}

export function isEncrypted(buffer: Buffer): boolean {
  return buffer.byteLength >= MAGIC.byteLength
    && buffer.subarray(0, MAGIC.byteLength).equals(MAGIC);
}

/**
 * Шифрует содержимое файла. Если ключ не настроен и шифрование не
 * обязательно (разработка), возвращает исходные байты без изменений.
 */
export function encryptDocument(plain: Buffer, storagePath: string): Buffer {
  const key = encryptionKey();
  if (!key) {
    if (encryptionRequired()) {
      throw new EncryptionKeyError(
        'DOCUMENT_ENCRYPTION_KEY не задан: загрузка документов отключена, '
        + 'чтобы файлы не попали на диск в открытом виде. Смотрите .env.example',
      );
    }
    return plain;
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(storagePath, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), ciphertext]);
}

/**
 * Расшифровывает содержимое файла.
 *
 * Файлы без признака шифрования возвращаются как есть: это документы,
 * загруженные до включения шифрования. В production такой файл — сигнал,
 * что том нужно перешифровать, поэтому вызывающий получает признак.
 */
export function decryptDocument(
  stored: Buffer,
  storagePath: string,
): { plain: Buffer; wasEncrypted: boolean } {
  if (!isEncrypted(stored)) {
    return { plain: stored, wasEncrypted: false };
  }
  const key = encryptionKey();
  if (!key) {
    throw new EncryptionKeyError(
      'Файл зашифрован, но DOCUMENT_ENCRYPTION_KEY не задан',
    );
  }
  const ivStart = MAGIC.byteLength;
  const tagStart = ivStart + IV_BYTES;
  const dataStart = tagStart + TAG_BYTES;
  if (stored.byteLength < dataStart) {
    throw new Error('Зашифрованный файл повреждён: нет заголовка');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    stored.subarray(ivStart, tagStart),
  );
  decipher.setAAD(Buffer.from(storagePath, 'utf8'));
  decipher.setAuthTag(stored.subarray(tagStart, dataStart));
  try {
    const plain = Buffer.concat([
      decipher.update(stored.subarray(dataStart)),
      decipher.final(),
    ]);
    return { plain, wasEncrypted: true };
  } catch {
    // Неверный тег означает повреждение или подмену файла.
    throw new Error(
      'Не удалось расшифровать документ: файл повреждён или подменён',
    );
  }
}

/** Генерация ключа для .env (используется в документации и скриптах). */
export function generateEncryptionKey(): string {
  return randomBytes(KEY_BYTES).toString('base64');
}
