/**
 * Единая точка извлечения содержимого документа.
 * Возвращает нормализованный результат независимо от формата.
 */

import { extractDocxText } from './extract-docx';
import { extractPdfText } from './extract-pdf';
import { extractXlsxData } from './extract-xlsx';

export type ExtractionStatusCode =
  | 'SUCCEEDED'
  | 'PARTIAL'
  | 'FAILED';

export interface ExtractedTable {
  /** Страница (PDF) или название листа/таблицы. */
  source: string;
  page: number | null;
  rows: string[][];
}

export interface ExtractionOutcome {
  status: ExtractionStatusCode;
  engine: 'pdfjs' | 'mammoth' | 'exceljs';
  text: string;
  pageCount: number | null;
  unreadablePages: number[];
  tables: ExtractedTable[];
  warnings: string[];
  charCount: number;
}

/** Доля непрочитанных страниц, при которой извлечение считается неудачным. */
const FAILED_THRESHOLD = 0.9;

export async function extractDocument(params: {
  buffer: Buffer;
  mimeType: string;
  originalName: string;
}): Promise<ExtractionOutcome> {
  const ext = params.originalName.toLowerCase().split('.').pop() ?? '';

  if (params.mimeType === 'application/pdf' || ext === 'pdf') {
    const result = await extractPdfText(params.buffer);
    const unreadableShare =
      result.pageCount > 0 ? result.unreadablePages.length / result.pageCount : 1;

    let status: ExtractionStatusCode = 'SUCCEEDED';
    if (result.charCount === 0 || unreadableShare >= FAILED_THRESHOLD) {
      status = 'FAILED';
    } else if (result.unreadablePages.length > 0) {
      status = 'PARTIAL';
    }

    return {
      status,
      engine: 'pdfjs',
      text: result.text,
      pageCount: result.pageCount,
      unreadablePages: result.unreadablePages,
      tables: [],
      warnings: result.warnings,
      charCount: result.charCount,
    };
  }

  if (ext === 'docx') {
    const result = await extractDocxText(params.buffer);
    return {
      status: result.charCount === 0 ? 'FAILED' : 'SUCCEEDED',
      engine: 'mammoth',
      text: result.text,
      pageCount: null,
      unreadablePages: [],
      tables: result.tables.map((t, index) => ({
        source: `Таблица ${index + 1}`,
        page: null,
        rows: t.rows,
      })),
      warnings: result.warnings,
      charCount: result.charCount,
    };
  }

  if (ext === 'xlsx' || ext === 'xls') {
    const result = await extractXlsxData(params.buffer);
    return {
      status: result.charCount === 0 ? 'FAILED' : 'SUCCEEDED',
      engine: 'exceljs',
      text: result.text,
      pageCount: null,
      unreadablePages: [],
      tables: result.tables.map((t) => ({
        source: `Лист «${t.sheetName}»`,
        page: null,
        rows: t.rows,
      })),
      warnings: result.warnings,
      charCount: result.charCount,
    };
  }

  throw new Error(
    `Формат файла не поддерживается: ${params.originalName} (${params.mimeType})`,
  );
}

/**
 * Разбивает извлечённый текст PDF на страницы по маркерам.
 * Нужно, чтобы находить номер страницы для цитаты требования.
 */
export function splitByPages(text: string): Array<{ page: number; text: string }> {
  const parts = text.split(/--- стр\. (\d+) ---/);
  const pages: Array<{ page: number; text: string }> = [];
  // parts: ['', '1', 'текст1', '2', 'текст2', ...]
  for (let i = 1; i < parts.length; i += 2) {
    const page = Number(parts[i]);
    const body = (parts[i + 1] ?? '').trim();
    if (Number.isFinite(page)) pages.push({ page, text: body });
  }
  return pages;
}

/**
 * Находит номер страницы, содержащей цитату.
 * Возвращает null, если цитата не найдена — выдумывать номер нельзя.
 */
export function findQuotePage(text: string, quote: string): number | null {
  const needle = normalizeForSearch(quote);
  if (needle.length < 12) return null;

  const pages = splitByPages(text);
  for (const page of pages) {
    if (normalizeForSearch(page.text).includes(needle)) {
      return page.page;
    }
  }
  // Попытка по сокращённой цитате: AI может слегка переформулировать.
  const shortNeedle = needle.slice(0, Math.max(24, Math.floor(needle.length / 2)));
  for (const page of pages) {
    if (normalizeForSearch(page.text).includes(shortNeedle)) {
      return page.page;
    }
  }
  return null;
}

function normalizeForSearch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[«»"'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
