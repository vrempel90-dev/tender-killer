/**
 * Поиск шрифта с поддержкой кириллицы для генерации PDF.
 *
 * Встроенные шрифты PDFKit (Helvetica, Times) кириллицу не поддерживают,
 * поэтому нужен TTF. Шрифт берётся из системы; в Docker-образ он
 * устанавливается пакетом font-dejavu (см. Dockerfile).
 *
 * Если шрифт не найден, генерация PDF честно объявляется недоступной —
 * вместо выдачи документа с нечитаемым текстом.
 */

import { existsSync } from 'node:fs';

const CANDIDATE_REGULAR = [
  process.env.PDF_FONT_REGULAR,
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/TTF/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
  '/usr/share/fonts/liberation/LiberationSans-Regular.ttf',
  '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf',
].filter((p): p is string => typeof p === 'string' && p.length > 0);

const CANDIDATE_BOLD = [
  process.env.PDF_FONT_BOLD,
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
  '/usr/share/fonts/liberation/LiberationSans-Bold.ttf',
  '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf',
].filter((p): p is string => typeof p === 'string' && p.length > 0);

export interface PdfFonts {
  regular: string;
  bold: string;
}

/** Возвращает пути к шрифтам или null, если подходящих нет. */
export function findPdfFonts(): PdfFonts | null {
  const regular = CANDIDATE_REGULAR.find((path) => existsSync(path));
  if (!regular) return null;
  const bold = CANDIDATE_BOLD.find((path) => existsSync(path)) ?? regular;
  return { regular, bold };
}

export const PDF_FONT_HELP =
  'Для генерации PDF нужен шрифт с поддержкой кириллицы. Установите пакет '
  + 'шрифтов (например font-dejavu или fonts-dejavu-core) либо укажите путь '
  + 'к TTF в переменных PDF_FONT_REGULAR и PDF_FONT_BOLD. '
  + 'Отчёт доступен на экране и для печати из браузера независимо от этого.';
