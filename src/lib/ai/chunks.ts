import { getAiConfig } from './config';
import { AiResponseError } from './errors';
import type { SourceDocument } from './verify';

/** Sequential fragments, with overlap; every source character is covered. */
export function planChunks(documents: SourceDocument[], system: string, schema: object, extra = ''): SourceDocument[][] {
  const config = getAiConfig();
  if (documents.length > 100 || documents.reduce((n, d) => n + d.text.length, 0) > config.AI_MAX_DOCUMENT_CHARS) {
    throw new AiResponseError(`Объём документов превышает лимит ${config.AI_MAX_DOCUMENT_CHARS} символов. Разделите задание; текст не обрезан.`);
  }
  const fixed = Buffer.byteLength(system + JSON.stringify(schema) + extra, 'utf8');
  const availableBytes = config.AI_PROVIDER === 'ollama'
    ? config.AI_CONTEXT_TOKENS - config.AI_MAX_OUTPUT_TOKENS - fixed - 2048 : 400_000 - fixed;
  // Four UTF-8 bytes per JS character also covers headers and unusual Unicode.
  const chars = Math.min(config.AI_CHUNK_CHARS, Math.floor(availableBytes / 4));
  if (chars < 128) throw new AiResponseError('Контекст AI слишком мал для схемы и требований. Увеличьте AI_CONTEXT_TOKENS или уменьшите число требований.');
  const groups: SourceDocument[][] = [];
  for (const doc of documents) {
    if (!doc.text.length) continue;
    let start = 0;
    while (start < doc.text.length) {
      const end = Math.min(start + chars, doc.text.length);
      groups.push([{ ...doc, text: doc.text.slice(start, end), analysisTruncated: start > 0 || end < doc.text.length }]);
      if (groups.length > config.AI_MAX_CHUNKS) throw new AiResponseError(`Документ требует больше ${config.AI_MAX_CHUNKS} фрагментов. Разделите задание; текст не обрезан.`);
      if (end === doc.text.length) break;
      start = end - Math.min(160, Math.floor(chars / 5));
    }
  }
  return groups.length ? groups : [[]];
}

export function coverageLimitations(documents: SourceDocument[], chunks: number): string[] {
  const warnings: string[] = [];
  if (chunks > 1) warnings.push(`Проанализировано последовательно фрагментов: ${chunks}. Между фрагментами возможна потеря связей; требуется ручная проверка полноты.`);
  for (const doc of documents) {
    if (doc.extractionStatus !== 'SUCCEEDED' || !doc.text.length) warnings.push(`Документ «${doc.name}» прочитан не полностью. Непрочитанные страницы: ${doc.unreadablePages.join(', ') || 'не определены'}. Требует ручной проверки.`);
  }
  if (getAiConfig().AI_PROVIDER === 'ollama') warnings.push('Локальная модель: полнота и смысловая корректность выводов требуют ручной проверки. Совпадение цитаты само по себе не доказывает вывод.');
  return warnings;
}
