import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  decryptDocument,
  encryptDocument,
  encryptionKey,
  EncryptionKeyError,
  generateEncryptionKey,
  isEncrypted,
} from '../encryption';

const KEY = randomBytes(32).toString('base64');
const PATH = 'company-1/doc-1.pdf';
const CONTENT = Buffer.from('%PDF-1.7 тестовое содержимое документа', 'utf8');

const saved = {
  key: process.env.DOCUMENT_ENCRYPTION_KEY,
  mode: process.env.DOCUMENT_ENCRYPTION_MODE,
};

beforeEach(() => {
  process.env.DOCUMENT_ENCRYPTION_KEY = KEY;
  delete process.env.DOCUMENT_ENCRYPTION_MODE;
});

afterEach(() => {
  if (saved.key === undefined) delete process.env.DOCUMENT_ENCRYPTION_KEY;
  else process.env.DOCUMENT_ENCRYPTION_KEY = saved.key;
  if (saved.mode === undefined) delete process.env.DOCUMENT_ENCRYPTION_MODE;
  else process.env.DOCUMENT_ENCRYPTION_MODE = saved.mode;
});

describe('ключ шифрования', () => {
  it('принимает 32 байта в base64', () => {
    expect(encryptionKey()?.byteLength).toBe(32);
  });

  it('отвергает ключ неверной длины', () => {
    process.env.DOCUMENT_ENCRYPTION_KEY = randomBytes(16).toString('base64');
    expect(() => encryptionKey()).toThrow(EncryptionKeyError);
  });

  it('генератор выдаёт пригодный ключ', () => {
    process.env.DOCUMENT_ENCRYPTION_KEY = generateEncryptionKey();
    expect(encryptionKey()?.byteLength).toBe(32);
  });

  it('пустое значение считается «не настроено»', () => {
    process.env.DOCUMENT_ENCRYPTION_KEY = '   ';
    expect(encryptionKey()).toBeNull();
  });
});

describe('шифрование документа', () => {
  it('содержимое не читается в зашифрованном виде', () => {
    const stored = encryptDocument(CONTENT, PATH);
    expect(isEncrypted(stored)).toBe(true);
    expect(stored.includes(CONTENT)).toBe(false);
    expect(stored.toString('utf8')).not.toContain('тестовое');
  });

  it('расшифровка возвращает исходные байты', () => {
    const stored = encryptDocument(CONTENT, PATH);
    const { plain, wasEncrypted } = decryptDocument(stored, PATH);
    expect(wasEncrypted).toBe(true);
    expect(plain.equals(CONTENT)).toBe(true);
  });

  it('каждое шифрование даёт разный результат (случайный IV)', () => {
    const a = encryptDocument(CONTENT, PATH);
    const b = encryptDocument(CONTENT, PATH);
    expect(a.equals(b)).toBe(false);
  });

  it('ГЛАВНОЕ: файл одной записи не расшифровывается как файл другой', () => {
    const stored = encryptDocument(CONTENT, PATH);
    expect(() => decryptDocument(stored, 'company-2/doc-9.pdf')).toThrow(
      /повреждён или подменён/,
    );
  });

  it('изменение байта обнаруживается', () => {
    const stored = encryptDocument(CONTENT, PATH);
    const tampered = Buffer.from(stored);
    const last = tampered.byteLength - 1;
    tampered.writeUInt8(tampered.readUInt8(last) ^ 0xff, last);
    expect(() => decryptDocument(tampered, PATH)).toThrow(/повреждён или подменён/);
  });

  it('обрезанный файл обнаруживается', () => {
    const stored = encryptDocument(CONTENT, PATH);
    expect(() => decryptDocument(stored.subarray(0, 20), PATH)).toThrow();
  });

  it('пустой документ шифруется и расшифровывается', () => {
    const stored = encryptDocument(Buffer.alloc(0), PATH);
    expect(decryptDocument(stored, PATH).plain.byteLength).toBe(0);
  });
});

describe('совместимость и отказ закрытый', () => {
  it('файл без признака шифрования читается как есть', () => {
    const { plain, wasEncrypted } = decryptDocument(CONTENT, PATH);
    expect(wasEncrypted).toBe(false);
    expect(plain.equals(CONTENT)).toBe(true);
  });

  it('без ключа в режиме разработки пишет открыто', () => {
    delete process.env.DOCUMENT_ENCRYPTION_KEY;
    const stored = encryptDocument(CONTENT, PATH);
    expect(isEncrypted(stored)).toBe(false);
    expect(stored.equals(CONTENT)).toBe(true);
  });

  it('ГЛАВНОЕ: без ключа при обязательном шифровании загрузка запрещена', () => {
    delete process.env.DOCUMENT_ENCRYPTION_KEY;
    process.env.DOCUMENT_ENCRYPTION_MODE = 'required';
    expect(() => encryptDocument(CONTENT, PATH)).toThrow(EncryptionKeyError);
  });

  it('зашифрованный файл без ключа не читается', () => {
    const stored = encryptDocument(CONTENT, PATH);
    delete process.env.DOCUMENT_ENCRYPTION_KEY;
    expect(() => decryptDocument(stored, PATH)).toThrow(EncryptionKeyError);
  });
});
