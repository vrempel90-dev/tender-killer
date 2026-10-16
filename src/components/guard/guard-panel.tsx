'use client';

/**
 * TENDER GUARD: контроль изменений.
 *
 * В интерфейсе всегда видно: изменение само не находится, редакцию
 * приносит пользователь. Пустой перечень изменений — отдельный честный
 * результат («условия не менялись»), а не отсутствие проверки.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  AlertOctagon,
  BellRing,
  Check,
  ChevronDown,
  Clock,
  Eye,
  EyeOff,
  FilePlus2,
  History,
  ShieldAlert,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, Input, Select } from '@/components/ui/field';
import { StatusNotice } from '@/components/ui/status-notice';
import { CHANGE_KIND_LABELS, SEVERITY_LABELS, type ChangeKind, type ChangeSeverity } from '@/lib/guard/compare';
import { VERDICT_LABELS, type RiskVerdict } from '@/lib/guard/risk';
import { InterpretationButton } from '@/components/ai/interpretation-button';

export interface WatchChangeRow {
  id: string;
  kind: ChangeKind;
  severity: ChangeSeverity;
  summary: string;
  detail: Record<string, unknown>;
  requiresRecalc: boolean;
  financialImpact: Record<string, unknown> | null;
  acknowledgedAt: string | null;
  createdAt: string;
  fromRevision: number | null;
  toRevision: number;
}

export interface WatchSnapshotRow {
  id: string;
  revision: number;
  sourceKind: 'DOCUMENT' | 'MANUAL';
  capturedAt: string;
  specCharCount: number | null;
  note: string | null;
  documentName: string | null;
}

export interface WatchRow {
  id: string;
  tenderId: string;
  title: string;
  externalNumber: string | null;
  isActive: boolean;
  note: string | null;
  revisions: number;
  changesTotal: number;
  startPrice: number | null;
  submissionDeadline: string | null;
  deliveryDeadline: string | null;
  updatedAt: string;
  changes: WatchChangeRow[];
  snapshots: WatchSnapshotRow[];
}

export interface TenderOption {
  id: string;
  title: string;
  externalNumber: string | null;
  specDocuments: Array<{ id: string; name: string }>;
}

const money = new Intl.NumberFormat('ru-KZ', { maximumFractionDigits: 0 });
const dateTime = new Intl.DateTimeFormat('ru-KZ', { dateStyle: 'medium', timeStyle: 'short' });
const dateOnly = new Intl.DateTimeFormat('ru-KZ', { dateStyle: 'medium' });

const SEVERITY_TONE: Record<ChangeSeverity, 'negative' | 'caution' | 'info' | 'neutral'> = {
  CRITICAL: 'negative',
  MAJOR: 'caution',
  MINOR: 'info',
  INFO: 'neutral',
};

export function GuardPanel({
  canWrite,
  watches,
  tenderOptions,
  pendingCount,
}: {
  canWrite: boolean;
  watches: WatchRow[];
  tenderOptions: TenderOption[];
  pendingCount: number;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(watches.length === 0);

  async function call(url: string, body?: unknown, method = 'POST') {
    setError(null);
    const response = await fetch(url, {
      method,
      headers: method === 'DELETE' ? {} : { 'Content-Type': 'application/json' },
      body: method === 'DELETE' ? undefined : JSON.stringify(body ?? {}),
    });
    const payload = await response.json();
    if (!response.ok) {
      setError(payload.error ?? 'Не удалось выполнить операцию');
      return null;
    }
    return payload.data;
  }

  const active = watches.filter((watch) => watch.isActive);
  const stopped = watches.filter((watch) => !watch.isActive);

  return (
    <div className="space-y-5">
      {error ? <StatusNotice severity="CRITICAL">{error}</StatusNotice> : null}
      {notice ? <StatusNotice severity="INFO">{notice}</StatusNotice> : null}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>
              <span className="flex items-center gap-2">
                <Eye className="size-4 text-ink-400" aria-hidden />
                На контроле
              </span>
            </CardTitle>
          </CardHeader>
          <CardBody className="space-y-2 text-[13px]">
            <div className="flex items-center justify-between">
              <span className="text-ink-500">Активных наблюдений</span>
              <span className="font-medium text-ink-900">{active.length}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-ink-500">Непросмотренных изменений</span>
              {pendingCount > 0 ? (
                <Badge tone="caution">{pendingCount}</Badge>
              ) : (
                <Badge tone="positive">нет</Badge>
              )}
            </div>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            action={
              canWrite ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setShowAdd((value) => !value)}
                >
                  <FilePlus2 className="size-4" aria-hidden />
                  {showAdd ? 'Скрыть' : 'Поставить на контроль'}
                </Button>
              ) : null
            }
          >
            <CardTitle>Как это работает</CardTitle>
            <CardDescription>
              При постановке на контроль фиксируется точка отсчёта: сроки, начальная
              цена и текст технического задания. Когда появляется новая редакция,
              вы загружаете документ или вводите новые сроки — GUARD сравнивает,
              показывает разницу и переоценивает расчёт. Уведомления показываются
              здесь и в журнале; внешней рассылки (почта, push) в системе нет.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>

      {showAdd && canWrite ? (
        <AddWatchForm
          options={tenderOptions}
          onDone={(message) => {
            setShowAdd(false);
            setNotice(message);
            router.refresh();
          }}
          onError={setError}
        />
      ) : null}

      {watches.length === 0 ? (
        <EmptyState
          icon={<ShieldAlert className="size-8" aria-hidden />}
          title="Ни один тендер не на контроле"
          description={
            'Поставьте тендер на контроль, чтобы фиксировать редакции условий. '
            + 'GUARD не узнаёт об изменениях сам: новую редакцию приносите вы, а он '
            + 'сравнивает её с предыдущей и считает последствия.'
          }
        />
      ) : (
        <div className="space-y-4">
          {active.map((watch) => (
            <WatchCard
              key={watch.id}
              watch={watch}
              canWrite={canWrite}
              onCall={call}
              onNotice={setNotice}
            />
          ))}
          {stopped.length > 0 ? (
            <>
              <h2 className="pt-2 text-[13px] font-medium uppercase tracking-wide text-ink-400">
                Снятые с контроля — история сохранена
              </h2>
              {stopped.map((watch) => (
                <WatchCard
                  key={watch.id}
                  watch={watch}
                  canWrite={canWrite}
                  onCall={call}
                  onNotice={setNotice}
                />
              ))}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

function AddWatchForm({
  options,
  onDone,
  onError,
}: {
  options: TenderOption[];
  onDone: (message: string) => void;
  onError: (message: string | null) => void;
}) {
  const [tenderId, setTenderId] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);

  const selected = options.find((option) => option.id === tenderId);

  if (options.length === 0) {
    return (
      <StatusNotice severity="INFO">
        Все тендеры компании уже на контроле либо тендеров ещё нет. Создайте тендер
        или передайте закупку из TENDER RADAR.
      </StatusNotice>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Поставить тендер на контроль</CardTitle>
        <CardDescription>
          Будет создана точка отсчёта. Если к тендеру приложено техническое задание,
          его текст войдёт в снимок — иначе изменения требований отслеживаться не
          будут, и об этом будет сказано прямо.
        </CardDescription>
      </CardHeader>
      <CardBody>
        <form
          className="grid gap-4 md:grid-cols-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!tenderId) {
              onError('Выберите тендер');
              return;
            }
            setLoading(true);
            onError(null);
            void fetch('/api/guard/watches', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                tenderId,
                documentId: documentId || undefined,
                note: note.trim() || undefined,
              }),
            })
              .then(async (response) => {
                const payload = await response.json();
                if (!response.ok) {
                  onError(payload.error ?? 'Не удалось поставить на контроль');
                  return;
                }
                onDone(
                  payload.data.limitation
                    ? `Тендер на контроле. ${payload.data.limitation}`
                    : 'Тендер на контроле: точка отсчёта зафиксирована',
                );
              })
              .catch(() => onError('Сервер недоступен'))
              .finally(() => setLoading(false));
          }}
        >
          <Field label="Тендер">
            {(id) => (
              <Select
                id={id}
                value={tenderId}
                onChange={(event) => {
                  setTenderId(event.target.value);
                  setDocumentId('');
                }}
              >
                <option value="">выберите тендер</option>
                {options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.externalNumber ? `${option.externalNumber} — ` : ''}
                    {option.title}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field
            label="Техническое задание"
            help={
              selected && selected.specDocuments.length === 0
                ? 'К тендеру не приложено техзадание'
                : 'По умолчанию — последнее загруженное'
            }
          >
            {(id) => (
              <Select
                id={id}
                value={documentId}
                disabled={!selected || selected.specDocuments.length === 0}
                onChange={(event) => setDocumentId(event.target.value)}
              >
                <option value="">последнее загруженное</option>
                {selected?.specDocuments.map((document) => (
                  <option key={document.id} value={document.id}>
                    {document.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Заметка" hint="необязательно">
            {(id) => (
              <Input
                id={id}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Что именно контролируем"
                maxLength={500}
              />
            )}
          </Field>

          <div className="md:col-span-3">
            <Button type="submit" loading={loading}>
              <Eye className="size-4" aria-hidden />
              Поставить на контроль
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function WatchCard({
  watch,
  canWrite,
  onCall,
  onNotice,
}: {
  watch: WatchRow;
  canWrite: boolean;
  onCall: (url: string, body?: unknown, method?: string) => Promise<Record<string, unknown> | null>;
  onNotice: (message: string | null) => void;
}) {
  const router = useRouter();
  const [showRevision, setShowRevision] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const pending = watch.changes.filter((change) => change.acknowledgedAt === null);
  const critical = pending.filter((change) => change.severity === 'CRITICAL');

  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {watch.isActive ? (
                <Badge tone="brand">на контроле</Badge>
              ) : (
                <Badge tone="neutral">снят с контроля</Badge>
              )}
              <Badge tone="neutral">редакций: {watch.revisions}</Badge>
              {critical.length > 0 ? (
                <Badge tone="negative">
                  <AlertOctagon className="size-3" aria-hidden />
                  критичных изменений: {critical.length}
                </Badge>
              ) : pending.length > 0 ? (
                <Badge tone="caution">
                  <BellRing className="size-3" aria-hidden />
                  непросмотрено: {pending.length}
                </Badge>
              ) : (
                <Badge tone="positive">всё просмотрено</Badge>
              )}
            </div>
            <h3 className="mt-1.5 text-[15px] font-medium leading-snug text-ink-900">
              <Link
                href={`/tenders/${watch.tenderId}`}
                className="hover:text-brand-700"
              >
                {watch.externalNumber ? `${watch.externalNumber} — ` : ''}
                {watch.title}
              </Link>
            </h3>
            <p className="mt-0.5 text-[12px] text-ink-500">
              {watch.startPrice !== null
                ? `Начальная цена ${money.format(watch.startPrice)} ₸ · `
                : ''}
              {watch.submissionDeadline
                ? `подача до ${dateOnly.format(new Date(watch.submissionDeadline))}`
                : 'срок подачи не задан'}
              {watch.deliveryDeadline
                ? ` · поставка до ${dateOnly.format(new Date(watch.deliveryDeadline))}`
                : ''}
            </p>
            {watch.note ? (
              <p className="mt-1 text-[12px] text-ink-500">{watch.note}</p>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            {canWrite && watch.isActive ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setShowRevision((value) => !value)}
                >
                  <FilePlus2 className="size-4" aria-hidden />
                  Новая редакция
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void onCall(`/api/guard/watches/${watch.id}`, undefined, 'DELETE').then(
                      (data) => {
                        if (data) {
                          onNotice('Наблюдение снято, история сохранена');
                          router.refresh();
                        }
                      },
                    )}
                >
                  <EyeOff className="size-4" aria-hidden />
                  Снять
                </Button>
              </>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setShowHistory((value) => !value)}
            >
              <History className="size-4" aria-hidden />
              История
            </Button>
          </div>
        </div>

        {showRevision && canWrite ? (
          <RevisionForm
            watchId={watch.id}
            onDone={(message) => {
              setShowRevision(false);
              onNotice(message);
              router.refresh();
            }}
            onError={(message) => onNotice(message)}
          />
        ) : null}

        {watch.changes.length === 0 ? (
          <p className="rounded-lg bg-ink-50 px-3 py-2 text-[13px] text-ink-600">
            {watch.revisions <= 1
              ? 'Зафиксирована точка отсчёта. Сравнивать пока не с чем — это не «изменений нет».'
              : 'Условия не менялись: сравнение редакций различий не нашло.'}
          </p>
        ) : (
          <div className="space-y-2">
            {watch.changes.map((change) => (
              <ChangeRow
                key={change.id}
                change={change}
                canWrite={canWrite}
                tenderId={watch.tenderId}
                onAck={() =>
                  void onCall(`/api/guard/changes/${change.id}/ack`).then((data) => {
                    if (data) router.refresh();
                  })}
              />
            ))}
          </div>
        )}

        {showHistory ? (
          <div className="space-y-1.5 rounded-lg border border-ink-200 p-3 text-[13px]">
            <p className="font-medium text-ink-800">Редакции</p>
            {watch.snapshots.map((snapshot) => (
              <div key={snapshot.id} className="flex flex-wrap items-baseline gap-x-2 text-ink-600">
                <span className="font-medium text-ink-900">№{snapshot.revision}</span>
                <span>{dateTime.format(new Date(snapshot.capturedAt))}</span>
                <span className="text-ink-400">
                  {snapshot.sourceKind === 'DOCUMENT'
                    ? `из документа${snapshot.documentName ? `: ${snapshot.documentName}` : ''}`
                    : 'внесено вручную'}
                </span>
                {snapshot.specCharCount !== null ? (
                  <span className="text-ink-400">
                    задание: {snapshot.specCharCount} симв.
                  </span>
                ) : (
                  <span className="text-amber-700">текста задания нет</span>
                )}
                {snapshot.note ? <span className="text-ink-500">{snapshot.note}</span> : null}
              </div>
            ))}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function ChangeRow({
  change,
  canWrite,
  tenderId,
  onAck,
}: {
  change: WatchChangeRow;
  canWrite: boolean;
  tenderId: string;
  onAck: () => void;
}) {
  const [open, setOpen] = useState(false);
  const impact = change.financialImpact as
    | {
      verdict?: RiskVerdict;
      applied?: string[];
      manual?: string[];
      notes?: string[];
      deltaNetMinor?: number | null;
      before?: { netMinor: number } | null;
      after?: { netMinor: number } | null;
    }
    | null;

  const added = Array.isArray(change.detail.addedLines)
    ? (change.detail.addedLines as string[])
    : [];
  const removed = Array.isArray(change.detail.removedLines)
    ? (change.detail.removedLines as string[])
    : [];

  return (
    <div
      className={`rounded-lg border p-3 ${
        change.acknowledgedAt === null ? 'border-ink-200 bg-white' : 'border-ink-100 bg-ink-50/60'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={SEVERITY_TONE[change.severity]}>
              {SEVERITY_LABELS[change.severity]}
            </Badge>
            <span className="text-[12px] text-ink-500">
              {CHANGE_KIND_LABELS[change.kind]}
            </span>
            <span className="text-[12px] text-ink-400">
              редакция {change.fromRevision ?? '—'} → {change.toRevision}
            </span>
            {change.requiresRecalc ? (
              <Badge tone="caution">нужен пересчёт</Badge>
            ) : null}
            {change.acknowledgedAt !== null ? (
              <Badge tone="neutral">просмотрено</Badge>
            ) : null}
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-800">{change.summary}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>
            <ChevronDown
              className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`}
              aria-hidden
            />
            Подробности
          </Button>
          {canWrite && change.acknowledgedAt === null ? (
            <Button type="button" size="sm" variant="outline" onClick={onAck}>
              <Check className="size-4" aria-hidden />
              Просмотрено
            </Button>
          ) : null}
        </div>
      </div>

      {canWrite && change.fromRevision !== null && <InterpretationButton endpoint={`/api/guard/changes/${change.id}/ai`} label="AI: объяснить изменение" />}
      {open ? (
        <div className="mt-2.5 space-y-2.5 border-t border-ink-100 pt-2.5 text-[13px]">
          <p className="flex items-center gap-1.5 text-[12px] text-ink-400">
            <Clock className="size-3.5" aria-hidden />
            зафиксировано {dateTime.format(new Date(change.createdAt))}
          </p>

          {added.length > 0 || removed.length > 0 ? (
            <div className="grid gap-2 md:grid-cols-2">
              {added.length > 0 ? (
                <div>
                  <p className="font-medium text-emerald-700">
                    Появилось ({String(change.detail.addedCount ?? added.length)})
                  </p>
                  <ul className="mt-1 space-y-0.5 text-ink-700">
                    {added.map((line) => (
                      <li key={line}>· {line}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {removed.length > 0 ? (
                <div>
                  <p className="font-medium text-red-700">
                    Исчезло ({String(change.detail.removedCount ?? removed.length)})
                  </p>
                  <ul className="mt-1 space-y-0.5 text-ink-700">
                    {removed.map((line) => (
                      <li key={line}>· {line}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          {impact ? (
            <div className="space-y-1.5 rounded-lg bg-ink-50 p-2.5">
              <p className="font-medium text-ink-900">
                Переоценка: {impact.verdict ? VERDICT_LABELS[impact.verdict] : '—'}
              </p>
              {impact.before && impact.after ? (
                <p className="text-ink-700">
                  Расчётная чистая прибыль: {money.format(impact.before.netMinor / 100)} ₸ →{' '}
                  {money.format(impact.after.netMinor / 100)} ₸
                </p>
              ) : null}
              {impact.applied && impact.applied.length > 0 ? (
                <p className="text-[12px] text-ink-500">
                  Подставлено в расчёт: {impact.applied.join('; ')}
                </p>
              ) : null}
              {impact.notes?.map((note) => (
                <p key={note} className="text-[12px] leading-relaxed text-ink-600">
                  {note}
                </p>
              ))}
              {impact.manual && impact.manual.length > 0 ? (
                <div className="text-[12px] leading-relaxed text-amber-700">
                  <p className="font-medium">Требует ручного пересмотра</p>
                  <ul className="mt-0.5 space-y-0.5">
                    {impact.manual.map((item) => (
                      <li key={item}>· {item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <Link
                href={`/tenders/${tenderId}/finance`}
                className="inline-block text-[13px] font-medium text-brand-600 hover:text-brand-700"
              >
                Открыть расчёт
              </Link>
            </div>
          ) : change.requiresRecalc ? (
            <p className="text-[12px] text-amber-700">
              Переоценка не выполнена: по тендеру нет сохранённого расчёта.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function RevisionForm({
  watchId,
  onDone,
  onError,
}: {
  watchId: string;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [documentId, setDocumentId] = useState('');
  const [submissionDeadline, setSubmissionDeadline] = useState('');
  const [deliveryDeadline, setDeliveryDeadline] = useState('');
  const [startPrice, setStartPrice] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);

  return (
    <form
      className="space-y-3 rounded-lg border border-ink-200 bg-ink-50/50 p-3.5"
      onSubmit={(event) => {
        event.preventDefault();
        setLoading(true);
        const body: Record<string, unknown> = {};
        if (documentId.trim()) body.documentId = documentId.trim();
        if (submissionDeadline) {
          body.submissionDeadline = new Date(`${submissionDeadline}T12:00:00.000Z`).toISOString();
        }
        if (deliveryDeadline) {
          body.deliveryDeadline = new Date(`${deliveryDeadline}T12:00:00.000Z`).toISOString();
        }
        if (startPrice !== '') body.startPrice = Number(startPrice);
        if (note.trim()) body.note = note.trim();

        void fetch(`/api/guard/watches/${watchId}/snapshots`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
          .then(async (response) => {
            const payload = await response.json();
            if (!response.ok) {
              onError(payload.error ?? 'Не удалось зафиксировать редакцию');
              return;
            }
            const count = Array.isArray(payload.data.changes) ? payload.data.changes.length : 0;
            onDone(
              count === 0
                ? `Редакция №${payload.data.revision} зафиксирована: различий не найдено`
                : `Редакция №${payload.data.revision}: найдено изменений — ${count}`,
            );
          })
          .catch(() => onError('Сервер недоступен'))
          .finally(() => setLoading(false));
      }}
    >
      <p className="text-[13px] leading-relaxed text-ink-600">
        Укажите, что изменилось. Документ новой редакции загружается в разделе
        документов тендера — здесь нужен его идентификатор; сроки и цену можно
        внести вручную. Незаполненные поля берутся из текущих данных тендера.
      </p>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <Field label="Документ новой редакции" hint="идентификатор">
          {(id) => (
            <Input
              id={id}
              value={documentId}
              onChange={(event) => setDocumentId(event.target.value)}
              placeholder="например, cmv9…"
              maxLength={64}
            />
          )}
        </Field>
        <Field label="Новый срок подачи">
          {(id) => (
            <Input
              id={id}
              type="date"
              value={submissionDeadline}
              onChange={(event) => setSubmissionDeadline(event.target.value)}
            />
          )}
        </Field>
        <Field label="Новый срок поставки">
          {(id) => (
            <Input
              id={id}
              type="date"
              value={deliveryDeadline}
              onChange={(event) => setDeliveryDeadline(event.target.value)}
            />
          )}
        </Field>
        <Field label="Новая начальная цена, ₸">
          {(id) => (
            <Input
              id={id}
              type="number"
              min={0}
              value={startPrice}
              onChange={(event) => setStartPrice(event.target.value)}
            />
          )}
        </Field>
        <Field label="Заметка" className="md:col-span-2 lg:col-span-4">
          {(id) => (
            <Input
              id={id}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Основание: письмо заказчика, новая редакция объявления…"
              maxLength={500}
            />
          )}
        </Field>
      </div>
      <Button type="submit" loading={loading} size="sm">
        Зафиксировать редакцию
      </Button>
    </form>
  );
}
