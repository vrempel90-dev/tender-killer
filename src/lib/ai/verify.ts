/**
 * Постобработка ответов модели: защита от вымышленных фактов.
 *
 * Это ключевой слой честности продукта. Модель может вернуть структурно
 * корректный ответ с цитатой, которой в документе нет, или заявить об
 * отсутствии документа, который просто не удалось прочитать. Здесь такие
 * выводы понижаются в статусе, а не попадают в отчёт как факты.
 */

import { findQuotePage } from '../documents/extract';
import Decimal from 'decimal.js';

export interface SourceDocument {
  id: string;
  name: string;
  /** Извлечённый текст. Пустая строка, если прочитать не удалось. */
  text: string;
  /** Статус извлечения. */
  extractionStatus: 'SUCCEEDED' | 'PARTIAL' | 'FAILED' | 'PENDING' | 'PROCESSING';
  /** Номера страниц без текстового слоя. */
  unreadablePages: number[];
  /** The model did not receive all extracted text. */
  analysisTruncated?: boolean;
}

export interface QuoteVerification {
  /** Найдена ли цитата в тексте документа. */
  verified: boolean;
  /** Номер страницы, определённый поиском (а не со слов модели). */
  pageNumber: number | null;
  /** Документ, в котором нашлась цитата. */
  documentId: string | null;
  documentName: string | null;
}

/** Нормализация для сравнения: регистр, кавычки, пробелы, дефисы. */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[«»"'`]/g, '')
    .replace(/[–—]/g, '-')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Минимальная длина цитаты, которую имеет смысл проверять. */
const MIN_QUOTE_LENGTH = 12;

/**
 * Проверяет, встречается ли цитата в одном из документов.
 * Номер страницы берётся из результата поиска, а НЕ из ответа модели.
 */
export function verifyQuote(
  quote: string,
  documents: SourceDocument[],
): QuoteVerification {
  const needle = normalize(quote);
  if (needle.length < MIN_QUOTE_LENGTH) {
    return { verified: false, pageNumber: null, documentId: null, documentName: null };
  }

  for (const doc of documents) {
    if (doc.text.length === 0) continue;
    const haystack = normalize(doc.text);

    if (haystack.includes(needle)) {
      return {
        verified: true,
        pageNumber: findQuotePage(doc.text, quote),
        documentId: doc.id,
        documentName: doc.name,
      };
    }
  }

  return { verified: false, pageNumber: null, documentId: null, documentName: null };
}

/**
 * Можно ли вообще делать вывод об ОТСУТСТВИИ чего-либо.
 * Нельзя, если хотя бы один документ прочитан не полностью: отсутствие
 * текста — это отсутствие данных, а не доказательство отсутствия документа.
 */
export function canConcludeAbsence(documents: SourceDocument[]): {
  allowed: boolean;
  reason: string | null;
} {
  if (documents.some(d => d.analysisTruncated)) return { allowed: false,
    reason: 'Текст был сокращён перед AI-анализом; вывод об отсутствии не допускается.' };
  if (documents.length === 0) {
    return {
      allowed: false,
      reason:
        'Документы поставщика не загружены, поэтому вывод об отсутствии '
        + 'подтверждения сделать нельзя.',
    };
  }

  const unreadable = documents.filter(
    (d) => d.extractionStatus === 'FAILED' || d.text.length === 0,
  );
  const partial = documents.filter((d) => d.extractionStatus !== 'SUCCEEDED' && d.extractionStatus !== 'FAILED');

  if (unreadable.length > 0) {
    return {
      allowed: false,
      reason:
        `Не прочитано содержимое документов: ${unreadable
          .map((d) => d.name)
          .join(', ')}. Их содержимое могло содержать подтверждение, поэтому `
        + 'вывод об отсутствии не делается.',
    };
  }

  if (partial.length > 0) {
    const pages = partial
      .map(
        (d) =>
          `${d.name} (страницы без текста: ${d.unreadablePages.slice(0, 10).join(', ')})`,
      )
      .join('; ');
    return {
      allowed: false,
      reason:
        `Часть страниц не прочитана: ${pages}. Вывод об отсутствии не делается — `
        + 'проверьте эти страницы вручную.',
    };
  }

  return { allowed: true, reason: null };
}

export type ComplianceStatus =
  | 'CONFIRMED'
  | 'NOT_FOUND'
  | 'MISMATCH'
  | 'NEEDS_REVIEW';

export interface VerifiedFinding {
  status: ComplianceStatus;
  documentId: string | null;
  documentName: string | null;
  pageNumber: number | null;
  evidenceQuote: string | null;
  uncertaintyReason: string | null;
  /** Был ли вывод модели изменён постобработкой. */
  adjusted: boolean;
  adjustmentNote: string | null;
}

/**
 * Приводит вывод модели по одному требованию к проверяемому виду.
 *
 * Правила:
 *  • CONFIRMED и MISMATCH требуют цитаты, найденной в документе. Если цитата
 *    не подтверждена — статус понижается до NEEDS_REVIEW.
 *  • NOT_FOUND допустим только если все документы прочитаны полностью.
 *  • Номер страницы берётся из поиска, а не из ответа модели.
 */
export function verifyComplianceFinding(params: {
  status: ComplianceStatus;
  evidenceQuote: string | null;
  uncertaintyReason: string | null;
  documents: SourceDocument[];
}): VerifiedFinding {
  const { status, evidenceQuote, documents } = params;

  if (status === 'CONFIRMED' || status === 'MISMATCH') {
    if (!evidenceQuote || evidenceQuote.trim().length === 0) {
      return {
        status: 'NEEDS_REVIEW',
        documentId: null,
        documentName: null,
        pageNumber: null,
        evidenceQuote: null,
        uncertaintyReason:
          'Вывод не принят: не приведена цитата из документа, подтверждающая его. '
          + 'Проверьте требование вручную.',
        adjusted: true,
        adjustmentNote: `Статус ${status} понижен: нет цитаты`,
      };
    }

    const verification = verifyQuote(evidenceQuote, documents);
    if (!verification.verified) {
      return {
        status: 'NEEDS_REVIEW',
        documentId: null,
        documentName: null,
        pageNumber: null,
        evidenceQuote,
        uncertaintyReason:
          'Вывод не принят: приведённая цитата не найдена в загруженных '
          + 'документах. Возможно, она неточна. Проверьте требование вручную.',
        adjusted: true,
        adjustmentNote: `Статус ${status} понижен: цитата не найдена в документах`,
      };
    }

    return {
      status,
      documentId: verification.documentId,
      documentName: verification.documentName,
      pageNumber: verification.pageNumber,
      evidenceQuote,
      uncertaintyReason: null,
      adjusted: false,
      adjustmentNote: null,
    };
  }

  if (status === 'NOT_FOUND') {
    const absence = canConcludeAbsence(documents);
    if (!absence.allowed) {
      return {
        status: 'NEEDS_REVIEW',
        documentId: null,
        documentName: null,
        pageNumber: null,
        evidenceQuote: null,
        uncertaintyReason: absence.reason,
        adjusted: true,
        adjustmentNote:
          'Статус «Не обнаружено» заменён на «Требует проверки»: '
          + 'содержимое документов прочитано не полностью',
      };
    }
    return {
      status: 'NOT_FOUND',
      documentId: null,
      documentName: null,
      pageNumber: null,
      evidenceQuote: null,
      uncertaintyReason: null,
      adjusted: false,
      adjustmentNote: null,
    };
  }

  // NEEDS_REVIEW
  return {
    status: 'NEEDS_REVIEW',
    documentId: null,
    documentName: null,
    pageNumber: null,
    evidenceQuote: evidenceQuote ?? null,
    uncertaintyReason:
      params.uncertaintyReason ??
      'Причина не указана. Требование нужно проверить вручную.',
    adjusted: false,
    adjustmentNote: null,
  };
}

/**
 * Проверка цитаты для извлечённого требования или позиции.
 * Непроверяемая цитата не повод отбросить запись — это повод отметить её
 * как требующую подтверждения пользователем.
 */
export interface VerifiedExtraction {
  pageNumber: number | null;
  quoteVerified: boolean;
  note: string | null;
}

export function verifyExtractionQuote(
  quote: string,
  documents: SourceDocument[],
): VerifiedExtraction {
  const verification = verifyQuote(quote, documents);
  if (verification.verified) {
    return {
      pageNumber: verification.pageNumber,
      quoteVerified: true,
      note: null,
    };
  }
  return {
    pageNumber: null,
    quoteVerified: false,
    note:
      'Цитата не найдена в тексте документа — формулировка могла быть изменена '
      + 'при извлечении. Подтвердите запись вручную.',
  };
}

/** Explicit decimal numerals only. No guessed conversions, word-numbers or math. */
export function explicitNumbers(text: string): string[] {
  return (text.match(/\d+(?:[ \u00a0\u202f]\d{3})*(?:[.,]\d+)?/g) ?? [])
    .flatMap(value => { try { return [new Decimal(value.replace(/[ \u00a0\u202f]/g, '').replace(',', '.')).toString()]; } catch { return []; } });
}

export function numberInQuote(value: number, quote: string): boolean {
  return Number.isFinite(value) && explicitNumbers(quote).includes(new Decimal(value).toString());
}

export function claimsNumbersGrounded(claim: string, quote: string): boolean {
  const source = new Set(explicitNumbers(quote));
  return explicitNumbers(claim).every(n => source.has(n));
}

function numberWithContext(value: number, quote: string, before: RegExp, after: RegExp): boolean {
  for (const match of quote.matchAll(/\d+(?:[ \u00a0\u202f]\d{3})*(?:[.,]\d+)?/g)) {
    if (!numberInQuote(value, match[0])) continue;
    const index = match.index;
    if (before.test(quote.slice(Math.max(0, index - 60), index)) || after.test(quote.slice(index + match[0].length, index + match[0].length + 40))) return true;
  }
  return false;
}

export function quantityInQuote(value: number, quote: string): boolean {
  return numberWithContext(value, quote, /(?:количество|кол-во|объ[её]м)\s*[:-]?\s*$/i,
    /^\s*(?:шт(?=[.\s,;:]|$)|штук|штука|компл|кг(?=[.\s,;:]|$)|тонн|метр|пар[аы]?(?=[.\s,;:]|$)|единиц)/i);
}

export function priceInQuote(value: number, quote: string): boolean {
  return numberWithContext(value, quote, /(?:цена|стоимость)(?:\s+за\s+единицу)?\s*[:-]?\s*$/i,
    /^\s*(?:тенге|тг(?=[.\s,;:]|$)|₸|KZT\b)/i);
}
