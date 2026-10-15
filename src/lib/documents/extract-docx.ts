/**
 * Извлечение текста и таблиц из DOCX через mammoth.
 *
 * DOCX не имеет страниц как таковых (разбиение на страницы делает
 * текстовый процессор при вёрстке), поэтому pageCount не возвращается,
 * а ссылки на фрагменты даются по абзацам.
 */

export interface DocxTable {
  rows: string[][];
}

export interface DocxExtractionResult {
  text: string;
  tables: DocxTable[];
  warnings: string[];
  charCount: number;
  paragraphCount: number;
}

export async function extractDocxText(
  buffer: Buffer,
): Promise<DocxExtractionResult> {
  const mammoth = await import('mammoth');

  const warnings: string[] = [];

  // Сначала HTML — из него извлекаем таблицы со структурой.
  const html = await mammoth.convertToHtml({ buffer });
  for (const message of html.messages) {
    warnings.push(`${message.type}: ${message.message}`);
  }

  const raw = await mammoth.extractRawText({ buffer });
  const text = raw.value.replace(/\n{3,}/g, '\n\n').trim();

  const tables = parseHtmlTables(html.value);

  if (text.length === 0) {
    warnings.push(
      'Текстовое содержимое не найдено. Возможно, документ состоит из '
      + 'изображений — их содержимое не прочитано.',
    );
  }

  return {
    text,
    tables,
    warnings,
    charCount: text.length,
    paragraphCount: text.split(/\n\s*\n/).filter((p) => p.trim().length > 0).length,
  };
}

/**
 * Разбор таблиц из HTML без внешних зависимостей.
 * Формат mammoth предсказуем, поэтому достаточно разбора по тегам.
 */
function parseHtmlTables(html: string): DocxTable[] {
  const tables: DocxTable[] = [];
  const tableMatches = html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi);

  for (const tableMatch of tableMatches) {
    const body = tableMatch[1] ?? '';
    const rows: string[][] = [];
    for (const rowMatch of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const rowHtml = rowMatch[1] ?? '';
      const cells: string[] = [];
      for (const cellMatch of rowHtml.matchAll(
        /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi,
      )) {
        cells.push(stripTags(cellMatch[1] ?? ''));
      }
      if (cells.length > 0) rows.push(cells);
    }
    if (rows.length > 0) tables.push({ rows });
  }

  return tables;
}

function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
