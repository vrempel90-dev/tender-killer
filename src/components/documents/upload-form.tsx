'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { Field, Select } from '@/components/ui/field';
import { StatusNotice } from '@/components/ui/status-notice';
import { DOCUMENT_KIND_LABELS } from '@/lib/tender-labels';

interface ExtractionInfo {
  status: string;
  engine?: string;
  pageCount?: number | null;
  unreadablePages?: number[];
  charCount?: number;
  warnings?: string[];
  tableCount?: number;
}

export function DocumentUploadForm({
  tenderId,
  maxMb,
}: {
  tenderId: string;
  maxMb: number;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    name: string;
    extraction: ExtractionInfo;
  } | null>(null);
  const [kind, setKind] = useState('TECHNICAL_SPEC');

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    setResult(null);

    const form = new FormData();
    form.append('file', file);
    form.append('tenderId', tenderId);
    form.append('kind', kind);

    try {
      const response = await fetch('/api/documents/upload', {
        method: 'POST',
        body: form,
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? 'Не удалось загрузить файл');
        return;
      }
      setResult({ name: file.name, extraction: body.data.extraction });
      if (inputRef.current) inputRef.current.value = '';
      router.refresh();
    } catch {
      setError('Сервер недоступен. Файл не загружен.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-3.5">
      {error ? <StatusNotice severity="CRITICAL">{error}</StatusNotice> : null}

      {result ? <ExtractionResult name={result.name} info={result.extraction} /> : null}

      <div className="grid gap-3.5 sm:grid-cols-[220px_1fr]">
        <Field label="Тип документа">
          {(id) => (
            <Select
              id={id}
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              {Object.entries(DOCUMENT_KIND_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Файл" help={`PDF, DOCX, XLSX. До ${maxMb} МБ.`}>
          {(id) => (
            <div className="flex min-w-0 flex-wrap gap-2">
              <input
                ref={inputRef}
                id={id}
                type="file"
                accept=".pdf,.docx,.xlsx,.xls"
                disabled={uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void upload(file);
                }}
                className="h-10 w-full min-w-0 flex-1 cursor-pointer rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-[12.5px] file:mr-2 file:rounded file:border-0 file:bg-ink-100 file:px-2 file:py-1 file:text-[12px] file:font-medium file:text-ink-700 hover:file:bg-ink-200"
              />
              {uploading ? (
                <span className="flex items-center gap-1.5 whitespace-nowrap text-[12.5px] text-ink-500">
                  <Upload className="size-3.5 animate-pulse" aria-hidden />
                  Чтение файла…
                </span>
              ) : null}
            </div>
          )}
        </Field>
      </div>
    </div>
  );
}

function ExtractionResult({
  name,
  info,
}: {
  name: string;
  info: ExtractionInfo;
}) {
  const severity =
    info.status === 'SUCCEEDED'
      ? 'INFO'
      : info.status === 'PARTIAL'
        ? 'WARNING'
        : 'CRITICAL';

  return (
    <StatusNotice severity={severity} title={`Загружено: ${name}`}>
      {info.status === 'SUCCEEDED' ? (
        <p>
          Содержимое прочитано
          {info.pageCount ? `, страниц: ${info.pageCount}` : ''}
          {info.charCount ? `, символов: ${info.charCount.toLocaleString('ru-KZ')}` : ''}
          {info.tableCount ? `, таблиц: ${info.tableCount}` : ''}.
        </p>
      ) : info.status === 'PARTIAL' ? (
        <p>
          Содержимое прочитано частично. Страниц без текстового слоя:{' '}
          {info.unreadablePages?.length ?? 0}
          {info.unreadablePages && info.unreadablePages.length > 0
            ? ` (${info.unreadablePages.slice(0, 10).join(', ')})`
            : ''}
          . Эти страницы в анализ не попадут.
        </p>
      ) : (
        <p>
          Содержимое прочитать не удалось. Файл сохранён, но текст из него не
          извлечён — вероятно, это сканированный документ. Распознавание
          изображений в системе не выполняется.
        </p>
      )}
      {info.warnings && info.warnings.length > 0 ? (
        <ul className="mt-1 list-disc pl-4">
          {info.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
    </StatusNotice>
  );
}
