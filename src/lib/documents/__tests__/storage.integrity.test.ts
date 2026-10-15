import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  DocumentIntegrityError,
  readStoredFile,
  resolveStoragePath,
  saveFile,
  sha256,
} from '../storage';
import { isEncrypted } from '../encryption';

const CONTENT = Buffer.from('%PDF-1.7 содержимое для проверки хранения', 'utf8');
const RELATIVE = path.join('company-a', 'doc.pdf');

const saved = {
  dir: process.env.STORAGE_DIR,
  key: process.env.DOCUMENT_ENCRYPTION_KEY,
};
let root = '';

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'tk-storage-'));
  process.env.STORAGE_DIR = root;
  process.env.DOCUMENT_ENCRYPTION_KEY = randomBytes(32).toString('base64');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

afterAll(() => {
  if (saved.dir === undefined) delete process.env.STORAGE_DIR;
  else process.env.STORAGE_DIR = saved.dir;
  if (saved.key === undefined) delete process.env.DOCUMENT_ENCRYPTION_KEY;
  else process.env.DOCUMENT_ENCRYPTION_KEY = saved.key;
});

describe('запись и чтение документа', () => {
  it('на диск попадают зашифрованные байты', async () => {
    await saveFile(RELATIVE, CONTENT);
    const onDisk = await readFile(resolveStoragePath(RELATIVE));
    expect(isEncrypted(onDisk)).toBe(true);
    expect(onDisk.includes(CONTENT)).toBe(false);
  });

  it('чтение возвращает исходное содержимое', async () => {
    await saveFile(RELATIVE, CONTENT);
    const read = await readStoredFile(RELATIVE, sha256(CONTENT));
    expect(read.equals(CONTENT)).toBe(true);
  });

  it('каталог компании и файл недоступны другим пользователям системы', async () => {
    await saveFile(RELATIVE, CONTENT);
    const dir = await stat(path.dirname(resolveStoragePath(RELATIVE)));
    const file = await stat(resolveStoragePath(RELATIVE));
    expect(dir.mode & 0o077).toBe(0);
    expect(file.mode & 0o077).toBe(0);
  });

  it('ГЛАВНОЕ: несовпадение контрольной суммы останавливает выдачу файла', async () => {
    await saveFile(RELATIVE, CONTENT);
    await expect(readStoredFile(RELATIVE, sha256(Buffer.from('другое')))).rejects.toThrow(
      DocumentIntegrityError,
    );
  });

  it('подмена файла на диске обнаруживается', async () => {
    await saveFile(RELATIVE, CONTENT);
    await saveFile(path.join('company-b', 'doc.pdf'), CONTENT);
    // Файл другой записи кладём на место первой.
    const foreign = await readFile(resolveStoragePath(path.join('company-b', 'doc.pdf')));
    await writeFile(resolveStoragePath(RELATIVE), foreign);
    await expect(readStoredFile(RELATIVE, sha256(CONTENT))).rejects.toThrow(
      /повреждён или подменён/,
    );
  });

  it('без контрольной суммы чтение работает (обратная совместимость)', async () => {
    await saveFile(RELATIVE, CONTENT);
    expect((await readStoredFile(RELATIVE)).equals(CONTENT)).toBe(true);
  });

  it('выход за пределы каталога хранения запрещён', () => {
    expect(() => resolveStoragePath('../../etc/passwd')).toThrow(/за пределы/);
  });
});
