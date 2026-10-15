import { describe, expect, it } from 'vitest';
import {
  ALLOWED_EXTENSIONS,
  buildStoragePath,
  resolveStoragePath,
  sha256,
  validateUpload,
} from '../storage';

describe('проверка загружаемых файлов', () => {
  it('пропускает корректный PDF', () => {
    expect(
      validateUpload({
        originalName: 'Техническая спецификация.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1_000_000,
      }),
    ).toBeNull();
  });

  it('пропускает корректный DOCX и XLSX', () => {
    expect(
      validateUpload({
        originalName: 'Договор.docx',
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        sizeBytes: 50_000,
      }),
    ).toBeNull();
    expect(
      validateUpload({
        originalName: 'Прайс.xlsx',
        mimeType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        sizeBytes: 50_000,
      }),
    ).toBeNull();
  });

  it('отклоняет пустой файл', () => {
    const error = validateUpload({
      originalName: 'a.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 0,
    });
    expect(error?.code).toBe('EMPTY_FILE');
  });

  it('отклоняет файл сверх лимита', () => {
    const error = validateUpload({
      originalName: 'a.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 999_999_999,
    });
    expect(error?.code).toBe('TOO_LARGE');
    expect(error?.message).toMatch(/МБ/);
  });

  it('отклоняет неподдерживаемое расширение', () => {
    const error = validateUpload({
      originalName: 'скрипт.exe',
      mimeType: 'application/pdf',
      sizeBytes: 1000,
    });
    expect(error?.code).toBe('UNSUPPORTED_TYPE');
  });

  it('отклоняет неподдерживаемый MIME-тип', () => {
    const error = validateUpload({
      originalName: 'файл.pdf',
      mimeType: 'application/x-msdownload',
      sizeBytes: 1000,
    });
    expect(error?.code).toBe('UNSUPPORTED_TYPE');
  });

  it('отклоняет несоответствие расширения и типа', () => {
    const error = validateUpload({
      originalName: 'файл.docx',
      mimeType: 'application/pdf',
      sizeBytes: 1000,
    });
    expect(error?.code).toBe('EXTENSION_MISMATCH');
  });

  it('отклоняет имя файла с переходом по каталогам', () => {
    for (const name of ['../../etc/passwd.pdf', 'a/b.pdf', 'a\\b.pdf']) {
      const error = validateUpload({
        originalName: name,
        mimeType: 'application/pdf',
        sizeBytes: 1000,
      });
      expect(error).not.toBeNull();
    }
  });

  it('список разрешённых расширений ограничен документами', () => {
    expect(ALLOWED_EXTENSIONS).toEqual(['.pdf', '.docx', '.xlsx', '.xls']);
  });
});

describe('пути хранения', () => {
  it('раскладывает файлы по каталогам компаний', () => {
    const relative = buildStoragePath('company-123', 'Спецификация.pdf');
    expect(relative.startsWith('company-123/')).toBe(true);
    expect(relative.endsWith('.pdf')).toBe(true);
    // имя файла не содержит исходного названия: нет утечки через путь
    expect(relative).not.toContain('Спецификация');
  });

  it('генерирует уникальные пути', () => {
    const a = buildStoragePath('c', 'f.pdf');
    const b = buildStoragePath('c', 'f.pdf');
    expect(a).not.toBe(b);
  });

  it('не допускает выхода за пределы каталога хранения', () => {
    expect(() => resolveStoragePath('../../etc/passwd')).toThrow(
      /выходит за пределы/,
    );
    expect(() => resolveStoragePath('company/../../secret')).toThrow();
  });

  it('разрешает корректный относительный путь', () => {
    expect(() => resolveStoragePath('company-1/file.pdf')).not.toThrow();
  });
});

describe('хеширование содержимого', () => {
  it('даёт одинаковый хеш для одинакового содержимого', () => {
    const a = sha256(Buffer.from('одинаковое содержимое'));
    const b = sha256(Buffer.from('одинаковое содержимое'));
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it('даёт разный хеш для разного содержимого', () => {
    expect(sha256(Buffer.from('a'))).not.toBe(sha256(Buffer.from('b')));
  });
});
