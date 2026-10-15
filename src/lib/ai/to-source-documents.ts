/** Преобразование документов из БД в формат, понятный AI-слою. */

import type { SourceDocument } from './verify';

export interface DbDocumentWithExtraction {
  id: string;
  originalName: string;
  extraction: {
    status: string;
    text: string | null;
    unreadablePages: number[];
  } | null;
}

export function toSourceDocuments(
  documents: DbDocumentWithExtraction[],
): SourceDocument[] {
  return documents.map((doc) => ({
    id: doc.id,
    name: doc.originalName,
    text: doc.extraction?.text ?? '',
    extractionStatus: (doc.extraction?.status ?? 'PENDING') as
      SourceDocument['extractionStatus'],
    unreadablePages: doc.extraction?.unreadablePages ?? [],
  }));
}
