'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Download, Eye, RefreshCw, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StatusNotice } from '@/components/ui/status-notice';
import { DOCUMENT_KIND_LABELS, EXTRACTION_STATUS_LABELS } from '@/lib/tender-labels';

export interface DocumentRow {
  id: string;
  originalName: string;
  kind: keyof typeof DOCUMENT_KIND_LABELS;
  sizeBytes: number;
  createdAt: string;
  sha256: string;
  extraction: {
    status: keyof typeof EXTRACTION_STATUS_LABELS;
    pageCount: number | null;
    charCount: number | null;
    unreadablePages: number[];
    warnings: string[];
    engine: string | null;
  } | null;
}

export function DocumentList({
  documents,
  canEdit,
}: {
  documents: DocumentRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  async function handleDelete(id: string, name: string) {
    if (
      !window.confirm(
        `Удалить документ «${name}»? Файл будет стёрт с диска, извлечённый текст удалён. Действие необратимо.`,
      )
    ) {
      return;
    }
    setBusyId(id);
    setError(null);
    try {
      const response = await fetch(`/api/documents/${id}`, { method: 'DELETE' });
      if (!response.ok) {
        const body = await response.json();
        setError(body.error ?? 'Не удалось удалить документ');
        return;
      }
      router.refresh();
    } catch {
      setError('Сервер недоступен. Документ не удалён.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleReextract(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const response = await fetch(`/api/documents/${id}/extract`, {
        method: 'POST',
      });
      if (!response.ok) {
        const body = await response.json();
        setError(body.error ?? 'Не удалось прочитать документ');
        return;
      }
      router.refresh();
    } catch {
      setError('Сервер недоступен.');
    } finally {
      setBusyId(null);
    }
  }

  if (documents.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-ink-200 bg-ink-50/40 px-4 py-8 text-center text-[13px] text-ink-400">
        Документы не загружены. Загрузите техническую спецификацию, проект
        договора и объявление о закупке.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {error ? <StatusNotice severity="CRITICAL">{error}</StatusNotice> : null}

      {documents.map((doc) => {
        const status = doc.extraction?.status;
        const expanded = expandedId === doc.id;
        return (
          <div
            key={doc.id}
            className="rounded-lg border border-ink-200 bg-white"
          >
            <div className="flex flex-wrap items-start justify-between gap-3 p-3.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-medium text-ink-900">
                  {doc.originalName}
                </p>
                <p className="mt-0.5 text-[12px] text-ink-400">
                  {DOCUMENT_KIND_LABELS[doc.kind]} ·{' '}
                  {(doc.sizeBytes / 1024).toFixed(0)} КБ ·{' '}
                  {new Intl.DateTimeFormat('ru-KZ', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  }).format(new Date(doc.createdAt))}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge
                    tone={
                      status === 'SUCCEEDED'
                        ? 'positive'
                        : status === 'PARTIAL'
                          ? 'caution'
                          : status === 'FAILED'
                            ? 'negative'
                            : 'neutral'
                    }
                  >
                    {status ? EXTRACTION_STATUS_LABELS[status] : 'Не обработан'}
                  </Badge>
                  {doc.extraction?.pageCount ? (
                    <Badge>{doc.extraction.pageCount} стр.</Badge>
                  ) : null}
                  {doc.extraction?.unreadablePages &&
                  doc.extraction.unreadablePages.length > 0 ? (
                    <Badge tone="caution">
                      {doc.extraction.unreadablePages.length} стр. без текста
                    </Badge>
                  ) : null}
                  {doc.extraction?.charCount ? (
                    <Badge>
                      {doc.extraction.charCount.toLocaleString('ru-KZ')} симв.
                    </Badge>
                  ) : null}
                </div>
              </div>

              <div className="flex shrink-0 gap-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setExpandedId(expanded ? null : doc.id)}
                  title="Показать извлечённое содержимое"
                >
                  <Eye className="size-3.5" aria-hidden />
                  {expanded ? 'Скрыть' : 'Текст'}
                </Button>
                <a
                  href={`/api/documents/${doc.id}/download`}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium text-ink-700 hover:bg-ink-100"
                >
                  <Download className="size-3.5" aria-hidden />
                  Скачать
                </a>
                {canEdit ? (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      loading={busyId === doc.id}
                      onClick={() => void handleReextract(doc.id)}
                      title="Прочитать документ заново"
                    >
                      <RefreshCw className="size-3.5" aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      loading={busyId === doc.id}
                      onClick={() => void handleDelete(doc.id, doc.originalName)}
                      className="text-red-600 hover:bg-red-50"
                      title="Удалить документ"
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </Button>
                  </>
                ) : null}
              </div>
            </div>

            {doc.extraction?.warnings && doc.extraction.warnings.length > 0 ? (
              <div className="border-t border-ink-100 bg-amber-50/50 px-3.5 py-2.5">
                <ul className="space-y-0.5 text-[12px] leading-relaxed text-amber-900">
                  {doc.extraction.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {expanded ? (
              <DocumentTextPreview documentId={doc.id} />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function DocumentTextPreview({ documentId }: { documentId: string }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/documents/${documentId}`, {
          signal: controller.signal,
        });
        const body = await response.json();
        if (!response.ok) {
          setError(body.error ?? 'Не удалось получить содержимое');
          return;
        }
        setText(body.data.extraction?.text ?? '');
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        setError('Сервер недоступен');
      }
    })();
    return () => controller.abort();
  }, [documentId]);

  return (
    <div className="border-t border-ink-100 bg-ink-50/60 px-3.5 py-3">
      {error ? (
        <p className="text-[12.5px] text-red-600">{error}</p>
      ) : text === null ? (
        <p className="text-[12.5px] text-ink-400">Загрузка содержимого…</p>
      ) : text.length === 0 ? (
        <p className="text-[12.5px] text-ink-500">
          Текст не извлечён. Это не означает, что документ пустой: возможно,
          он состоит из сканов.
        </p>
      ) : (
        <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed text-ink-700 scrollbar-slim">
          {text}
        </pre>
      )}
    </div>
  );
}
