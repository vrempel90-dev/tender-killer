/**
 * Тесты извлечения содержимого на РЕАЛЬНЫХ файлах.
 * Фикстуры в каталоге fixtures/ созданы программно и не содержат
 * документов клиентов.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractDocument, findQuotePage, splitByPages } from '../extract';

const FIXTURES = path.join(process.cwd(), 'src/lib/documents/__tests__/fixtures');

async function fixture(name: string): Promise<Buffer> {
  return readFile(path.join(FIXTURES, name));
}

describe('извлечение из PDF', () => {
  it('читает текстовый слой и считает страницы', async () => {
    const result = await extractDocument({
      buffer: await fixture('spec.pdf'),
      mimeType: 'application/pdf',
      originalName: 'spec.pdf',
    });

    expect(result.engine).toBe('pdfjs');
    expect(result.status).toBe('SUCCEEDED');
    expect(result.pageCount).toBe(2);
    expect(result.charCount).toBeGreaterThan(100);
    expect(result.unreadablePages).toEqual([]);
    // содержимое действительно извлечено
    expect(result.text).toContain('SPECIFIKACIYA');
    expect(result.text).toContain('100 sht');
    expect(result.text).toContain('TREBUEMYE DOKUMENTY');
  });

  it('размечает текст по страницам', async () => {
    const result = await extractDocument({
      buffer: await fixture('spec.pdf'),
      mimeType: 'application/pdf',
      originalName: 'spec.pdf',
    });
    const pages = splitByPages(result.text);
    expect(pages).toHaveLength(2);
    expect(pages[0]!.page).toBe(1);
    expect(pages[1]!.page).toBe(2);
    expect(pages[0]!.text).toContain('SPECIFIKACIYA');
    expect(pages[1]!.text).toContain('licenzii');
  });

  it('НЕ объявляет содержимое прочитанным, если текстового слоя нет', async () => {
    const result = await extractDocument({
      buffer: await fixture('scan-like.pdf'),
      mimeType: 'application/pdf',
      originalName: 'scan-like.pdf',
    });

    // Это главное требование: страницы-сканы отмечаются как непрочитанные,
    // а не трактуются как «документ пустой».
    expect(result.status).toBe('FAILED');
    expect(result.pageCount).toBe(2);
    expect(result.unreadablePages).toEqual([1, 2]);
    expect(result.warnings.join(' ')).toMatch(/текстового слоя/);
    expect(result.warnings.join(' ')).toMatch(/не прочитано/);
  });
});

describe('извлечение из DOCX', () => {
  it('читает текст договора', async () => {
    const result = await extractDocument({
      buffer: await fixture('contract.docx'),
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      originalName: 'contract.docx',
    });

    expect(result.engine).toBe('mammoth');
    expect(result.status).toBe('SUCCEEDED');
    expect(result.charCount).toBeGreaterThan(500);
    expect(result.text).toContain('ДОГОВОР О ГОСУДАРСТВЕННЫХ ЗАКУПКАХ');
    expect(result.text).toContain('46 000 000');
    expect(result.text).toContain('30 (тридцати) рабочих дней');
    expect(result.text).toContain('0,1 %');
    expect(result.text).toContain('36 (тридцать шесть) месяцев');
    // у DOCX нет страниц
    expect(result.pageCount).toBeNull();
  });

  it('извлекает таблицы со структурой', async () => {
    const result = await extractDocument({
      buffer: await fixture('contract.docx'),
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      originalName: 'contract.docx',
    });

    expect(result.tables.length).toBeGreaterThan(0);
    const table = result.tables[0]!;
    expect(table.rows[0]).toEqual(['№', 'Наименование', 'Количество', 'Ед.']);
    expect(table.rows[1]![1]).toContain('Ноутбук');
    expect(table.rows[1]![2]).toBe('100');
  });
});

describe('извлечение из XLSX', () => {
  it('читает листы и строки', async () => {
    const result = await extractDocument({
      buffer: await fixture('quote.xlsx'),
      mimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      originalName: 'quote.xlsx',
    });

    expect(result.engine).toBe('exceljs');
    expect(result.status).toBe('SUCCEEDED');
    expect(result.tables).toHaveLength(2);
    expect(result.tables[0]!.source).toContain('КП');
    expect(result.tables[1]!.source).toContain('Условия');
    expect(result.text).toContain('Техноснаб');
    expect(result.text).toContain('348000');
  });

  it('берёт вычисленный результат формулы, а не её текст', async () => {
    const result = await extractDocument({
      buffer: await fixture('quote.xlsx'),
      mimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      originalName: 'quote.xlsx',
    });
    const flat = result.tables[0]!.rows.flat().join(' ');
    expect(flat).toContain('35550000');
    expect(flat).not.toContain('D6*C6');
  });

  it('приводит дату к читаемому виду', async () => {
    const result = await extractDocument({
      buffer: await fixture('quote.xlsx'),
      mimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      originalName: 'quote.xlsx',
    });
    expect(result.tables[1]!.rows.flat().join(' ')).toContain('2026-12-31');
  });
});

describe('неподдерживаемый формат', () => {
  it('выбрасывает понятную ошибку', async () => {
    await expect(
      extractDocument({
        buffer: Buffer.from('текст'),
        mimeType: 'text/plain',
        originalName: 'notes.txt',
      }),
    ).rejects.toThrow(/не поддерживается/);
  });
});

describe('поиск страницы по цитате', () => {
  const text = [
    '--- стр. 1 ---',
    'Срок поставки товара составляет 50 календарных дней со дня заключения договора.',
    '',
    '--- стр. 2 ---',
    'Гарантийный срок на поставляемый товар составляет 36 месяцев.',
  ].join('\n');

  it('находит страницу по точной цитате', () => {
    expect(findQuotePage(text, 'Срок поставки товара составляет 50')).toBe(1);
    expect(findQuotePage(text, 'Гарантийный срок на поставляемый товар')).toBe(2);
  });

  it('находит страницу при незначительном расхождении кавычек и пробелов', () => {
    expect(
      findQuotePage(text, '«Срок  поставки   товара составляет 50 календарных дней»'),
    ).toBe(1);
  });

  it('возвращает null, если цитаты нет — номер страницы не выдумывается', () => {
    expect(
      findQuotePage(text, 'Поставщик предоставляет банковскую гарантию на 5 лет'),
    ).toBeNull();
  });

  it('возвращает null для слишком короткой цитаты', () => {
    expect(findQuotePage(text, '50 дней')).toBeNull();
  });
});
