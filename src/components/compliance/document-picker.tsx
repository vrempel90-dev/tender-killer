'use client';

import { Badge } from '@/components/ui/badge';
import { DOCUMENT_KIND_LABELS, EXTRACTION_STATUS_LABELS } from '@/lib/tender-labels';

export interface PickableDocument {
  id: string;
  originalName: string;
  kind: keyof typeof DOCUMENT_KIND_LABELS;
  extractionStatus: keyof typeof EXTRACTION_STATUS_LABELS | null;
  charCount: number | null;
  unreadablePagesCount: number;
}

/**
 * Выбор документов для анализа. Документы без прочитанного текста
 * выбрать нельзя — анализировать в них нечего, и это честно показано.
 */
export function DocumentPicker({
  documents,
  selected,
  onChange,
  emptyMessage,
}: {
  documents: PickableDocument[];
  selected: string[];
  onChange: (next: string[]) => void;
  emptyMessage: string;
}) {
  if (documents.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-ink-200 bg-ink-50/40 px-3.5 py-6 text-center text-[13px] text-ink-400">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {documents.map((doc) => {
        const readable =
          doc.extractionStatus === 'SUCCEEDED' || doc.extractionStatus === 'PARTIAL';
        const checked = selected.includes(doc.id);
        return (
          <label
            key={doc.id}
            className={
              readable
                ? 'flex cursor-pointer items-start gap-2.5 rounded-lg border border-ink-200 px-3 py-2.5 hover:bg-ink-50/60'
                : 'flex items-start gap-2.5 rounded-lg border border-ink-150 border-ink-200 bg-ink-50/60 px-3 py-2.5 opacity-70'
            }
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={!readable}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...selected, doc.id]
                    : selected.filter((id) => id !== doc.id),
                )
              }
              className="mt-0.5 size-4 rounded border-ink-300"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-ink-900">
                {doc.originalName}
              </span>
              <span className="mt-1 flex flex-wrap items-center gap-1.5">
                <Badge>{DOCUMENT_KIND_LABELS[doc.kind]}</Badge>
                <Badge
                  tone={
                    doc.extractionStatus === 'SUCCEEDED'
                      ? 'positive'
                      : doc.extractionStatus === 'PARTIAL'
                        ? 'caution'
                        : 'negative'
                  }
                >
                  {doc.extractionStatus
                    ? EXTRACTION_STATUS_LABELS[doc.extractionStatus]
                    : 'Не обработан'}
                </Badge>
                {doc.unreadablePagesCount > 0 ? (
                  <Badge tone="caution">
                    {doc.unreadablePagesCount} стр. без текста
                  </Badge>
                ) : null}
              </span>
              {!readable ? (
                <span className="mt-1 block text-[12px] text-ink-500">
                  Текст не извлечён — документ нельзя использовать для анализа.
                  Загрузите версию с текстовым слоем.
                </span>
              ) : null}
            </span>
          </label>
        );
      })}
    </div>
  );
}
