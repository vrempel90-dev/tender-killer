/**
 * Извлечение текста из PDF через pdfjs-dist.
 *
 * Важно: если страница не содержит текстового слоя (скан), текст из неё
 * получить нельзя. Такие страницы перечисляются в unreadablePages, а статус
 * извлечения становится PARTIAL или FAILED. Делать вывод «документа нет» по
 * непрочитанной странице недопустимо — это отдельно учитывается в AI-проверке.
 */

export interface PdfExtractionResult {
  text: string;
  pageCount: number;
  /** Номера страниц (с 1), из которых не удалось получить текст. */
  unreadablePages: number[];
  warnings: string[];
  charCount: number;
}

/** Порог: страница с текстовым слоем даёт хотя бы столько символов. */
const MIN_CHARS_PER_PAGE = 20;

export async function extractPdfText(
  buffer: Buffer,
): Promise<PdfExtractionResult> {
  // Legacy-сборка pdfjs работает в Node.js без DOM.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

  const data = new Uint8Array(buffer);
  const loadingTask = pdfjs.getDocument({
    data,
    // Шрифты не подгружаем: нужен только текстовый слой.
    useSystemFonts: false,
  });
  const doc = await loadingTask.promise;

  const pageTexts: string[] = [];
  const unreadablePages: number[] = [];
  const warnings: string[] = [];

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    try {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+\n/g, '\n')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();

      if (pageText.length < MIN_CHARS_PER_PAGE) {
        unreadablePages.push(pageNumber);
      }
      pageTexts.push(`--- стр. ${pageNumber} ---\n${pageText}`);
      page.cleanup();
    } catch (error) {
      unreadablePages.push(pageNumber);
      pageTexts.push(`--- стр. ${pageNumber} ---\n`);
      warnings.push(
        `Страница ${pageNumber}: ошибка чтения (${(error as Error).message})`,
      );
    }
  }

  // Освобождаем ресурсы: destroy объявлен у задачи загрузки, не у документа.
  doc.cleanup();
  await loadingTask.destroy();

  if (unreadablePages.length > 0) {
    warnings.push(
      `Без текстового слоя: ${unreadablePages.length} из ${doc.numPages} страниц `
      + `(${unreadablePages.slice(0, 20).join(', ')}`
      + `${unreadablePages.length > 20 ? ' и далее' : ''}). `
      + 'Вероятно, это сканы. Их содержимое не прочитано — распознавание '
      + 'изображений не выполняется.',
    );
  }

  const text = pageTexts.join('\n\n');
  return {
    text,
    pageCount: doc.numPages,
    unreadablePages,
    warnings,
    charCount: text.replace(/--- стр\. \d+ ---/g, '').trim().length,
  };
}
