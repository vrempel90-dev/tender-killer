'use client';

/**
 * TENDER RADAR: поиск закупок по импортированным данным.
 *
 * Правило раздела: ни одна закупка не показывается без источника и даты
 * актуальности. Если данных нет — честное пустое состояние с объяснением,
 * а не демонстрационные записи.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Database,
  ExternalLink,
  Radar,
  Save,
  Search,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, Input, Select } from '@/components/ui/field';
import { StatusNotice } from '@/components/ui/status-notice';
import {
  PROCUREMENT_TYPE_LABELS,
  type ProcurementTypeValue,
  type SearchFilters,
} from '@/lib/radar/filters';
import { RadarImportForm } from './radar-import-form';
import { InterpretationButton } from '@/components/ai/interpretation-button';

export interface ImportSummary {
  id: string;
  sourceName: string;
  sourceUrl: string | null;
  fileName: string;
  actualAt: string;
  importedAt: string;
  rowsImported: number;
  rowsRejected: number;
  warnings: string[];
  opportunities: number;
}

export interface SavedSearchSummary {
  id: string;
  name: string;
  filters: SearchFilters | null;
  description: string | null;
  invalid: string | null;
}

interface MatchReason {
  code: string;
  weight: number;
  detail: string;
}

interface Opportunity {
  id: string;
  externalId: string | null;
  title: string;
  customerName: string | null;
  customerBin: string | null;
  price: number | null;
  currency: string;
  procurementType: ProcurementTypeValue;
  region: string | null;
  deadline: string | null;
  deliveryDeadline: string | null;
  sourceUrl: string | null;
  source: {
    importId: string;
    name: string;
    url: string | null;
    fileName: string;
    actualAt: string;
    importedAt: string;
  };
  tender: { id: string; stage: string } | null;
  match: {
    score: number;
    label: 'ВЫСОКОЕ' | 'СРЕДНЕЕ' | 'НИЗКОЕ';
    suitable: boolean;
    reasons: MatchReason[];
    blockers: Array<{ code: string; detail: string }>;
    matchedKeywords: string[];
  };
}

interface SearchResponse {
  items: Opportunity[];
  page: number;
  pageSize: number;
  matched: number;
  scanned: number;
  total: number;
  truncated: boolean;
  profileFilled: boolean;
}

const money = new Intl.NumberFormat('ru-KZ', { maximumFractionDigits: 0 });
const date = new Intl.DateTimeFormat('ru-KZ', { dateStyle: 'medium' });

function formatDate(value: string | null): string {
  return value ? date.format(new Date(value)) : '—';
}

function daysLeft(deadline: string | null): number | null {
  if (!deadline) return null;
  return Math.floor((new Date(deadline).getTime() - Date.now()) / 86_400_000);
}

export function RadarPanel({
  canWrite,
  imports,
  savedSearches,
  profile,
  stats,
}: {
  canWrite: boolean;
  imports: ImportSummary[];
  savedSearches: SavedSearchSummary[];
  profile: {
    exists: boolean;
    keywords: string[];
    completeness: { filled: number; total: number; missing: string[] };
  };
  stats: { total: number; open: number };
}) {
  const router = useRouter();
  const [filters, setFilters] = useState<SearchFilters>({ onlyOpen: true, sort: 'score' });
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(imports.length === 0);
  const [searchName, setSearchName] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const hasData = stats.total > 0;

  const runSearch = useCallback(
    async (next: SearchFilters, page = 1) => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch('/api/radar/opportunities/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filters: next, page }),
        });
        const payload = await response.json();
        if (!response.ok) {
          setError(payload.error ?? 'Не удалось выполнить поиск');
          return;
        }
        setResult(payload.data as SearchResponse);
      } catch {
        setError('Сервер недоступен. Повторите попытку.');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Первый поиск выполняется один раз при открытии раздела: фильтры в
  // зависимостях вызвали бы запрос на каждое нажатие клавиши.
  const [initialised, setInitialised] = useState(false);
  useEffect(() => {
    if (!hasData || initialised) return;
    setInitialised(true);
    void runSearch({ onlyOpen: true, sort: 'score' });
  }, [hasData, initialised, runSearch]);

  const latestActualAt = useMemo(() => {
    if (imports.length === 0) return null;
    return imports.reduce(
      (latest, item) => (item.actualAt > latest ? item.actualAt : latest),
      imports[0]!.actualAt,
    );
  }, [imports]);

  async function saveSearch() {
    if (searchName.trim().length < 2) {
      setError('Укажите название поиска');
      return;
    }
    setError(null);
    const response = await fetch('/api/radar/searches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: searchName.trim(), filters }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setError(payload.error ?? 'Не удалось сохранить поиск');
      return;
    }
    setNotice(
      payload.data.replaced
        ? `Поиск «${payload.data.name}» обновлён`
        : `Поиск «${payload.data.name}» сохранён`,
    );
    setSearchName('');
    router.refresh();
  }

  async function removeSearch(id: string) {
    const response = await fetch(`/api/radar/searches/${id}`, { method: 'DELETE' });
    if (response.ok) router.refresh();
  }

  async function toTender(id: string) {
    setError(null);
    const response = await fetch(`/api/radar/opportunities/${id}/to-tender`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const payload = await response.json();
    if (!response.ok) {
      setError(payload.error ?? 'Не удалось передать в расчёт');
      return;
    }
    setNotice(
      payload.data.priceKnown
        ? 'Тендер создан, можно переходить к расчёту'
        : 'Тендер создан. В выгрузке не было суммы — заполните начальную цену вручную.',
    );
    void runSearch(filters, result?.page ?? 1);
    router.refresh();
  }

  return (
    <div className="space-y-5">
      {error ? <StatusNotice severity="CRITICAL">{error}</StatusNotice> : null}
      {notice ? <StatusNotice severity="INFO">{notice}</StatusNotice> : null}

      {/* Состояние данных и профиля */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>
              <span className="flex items-center gap-2">
                <Database className="size-4 text-ink-400" aria-hidden />
                Импортированные данные
              </span>
            </CardTitle>
          </CardHeader>
          <CardBody className="space-y-2 text-[13px]">
            <Row label="Объявлений всего">{stats.total}</Row>
            <Row label="Приём заявок не закончен">{stats.open}</Row>
            <Row label="Данные актуальны на">
              {latestActualAt ? (
                formatDate(latestActualAt)
              ) : (
                <Badge tone="neutral">нет данных</Badge>
              )}
            </Row>
            <Row label="Партий импорта">{imports.length}</Row>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Профиль компании</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2 text-[13px]">
            <Row label="Заполнено">
              {profile.completeness.filled} из {profile.completeness.total}
            </Row>
            {profile.keywords.length > 0 ? (
              <p className="text-ink-500">
                Предмет: {profile.keywords.slice(0, 5).join(', ')}
                {profile.keywords.length > 5 ? ` и ещё ${profile.keywords.length - 5}` : ''}
              </p>
            ) : (
              <p className="text-ink-500">
                Не указано, что поставляет компания — отбор по предмету не работает.
              </p>
            )}
            {profile.completeness.missing.length > 0 ? (
              <p className="text-[12px] leading-relaxed text-amber-700">
                Не заполнено: {profile.completeness.missing.join(', ')}.
              </p>
            ) : null}
            <Link
              href="/settings/profile"
              className="inline-block text-[13px] font-medium text-brand-600 hover:text-brand-700"
            >
              Настроить профиль
            </Link>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            action={
              canWrite ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setShowImport((value) => !value)}
                >
                  <Upload className="size-4" aria-hidden />
                  {showImport ? 'Скрыть' : 'Импорт'}
                </Button>
              ) : null
            }
          >
            <CardTitle>Сохранённые поиски</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2 text-[13px]">
            {savedSearches.length === 0 ? (
              <p className="text-ink-500">
                Пока нет. Настройте фильтры и сохраните набор, чтобы возвращаться
                к нему.
              </p>
            ) : (
              savedSearches.map((search) => (
                <div key={search.id} className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    {search.invalid ? (
                      <>
                        <p className="font-medium text-ink-900">{search.name}</p>
                        <p className="text-[12px] text-amber-700">{search.invalid}</p>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="text-left"
                        onClick={() => {
                          if (!search.filters) return;
                          setFilters(search.filters);
                          void runSearch(search.filters);
                        }}
                      >
                        <span className="font-medium text-brand-600 hover:text-brand-700">
                          {search.name}
                        </span>
                        <span className="block text-[12px] text-ink-400">
                          {search.description}
                        </span>
                      </button>
                    )}
                  </div>
                  {canWrite ? (
                    <button
                      type="button"
                      aria-label={`Удалить поиск ${search.name}`}
                      onClick={() => void removeSearch(search.id)}
                      className="shrink-0 text-ink-400 hover:text-red-600"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  ) : null}
                </div>
              ))
            )}
          </CardBody>
        </Card>
      </div>

      {showImport && canWrite ? (
        <RadarImportForm
          onImported={() => {
            setShowImport(false);
            setNotice('Импорт выполнен');
            router.refresh();
            void runSearch(filters);
          }}
        />
      ) : null}

      {imports.length > 0 ? <ImportList imports={imports} /> : null}

      {!hasData ? (
        <EmptyState
          icon={<Radar className="size-8" aria-hidden />}
          title="Объявлений пока нет"
          description={
            'Приложение не загружает закупки с порталов самостоятельно: для этого '
            + 'нужен законный доступ к их API. Выгрузите объявления с портала в '
            + 'CSV или XLSX и импортируйте файл — вместе с ним укажите источник и '
            + 'дату, на которую данные актуальны.'
          }
          action={
            canWrite ? (
              <Button type="button" onClick={() => setShowImport(true)}>
                <Upload className="size-4" aria-hidden />
                Импортировать выгрузку
              </Button>
            ) : null
          }
        />
      ) : (
        <>
          <SearchForm
            filters={filters}
            onChange={setFilters}
            onSubmit={() => void runSearch(filters)}
            loading={loading}
          />

          {canWrite ? (
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Сохранить этот набор фильтров" className="w-full max-w-xs">
                {(id) => (
                  <Input
                    id={id}
                    value={searchName}
                    onChange={(event) => setSearchName(event.target.value)}
                    placeholder="Например: кабель, Алматы, до 50 млн"
                    maxLength={100}
                  />
                )}
              </Field>
              <Button type="button" variant="outline" onClick={() => void saveSearch()}>
                <Save className="size-4" aria-hidden />
                Сохранить поиск
              </Button>
            </div>
          ) : null}

          {result ? (
            <Results
              result={result}
              expanded={expanded}
              onToggle={(id) => setExpanded(expanded === id ? null : id)}
              onToTender={canWrite ? toTender : undefined}
              onPage={(page) => void runSearch(filters, page)}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-ink-500">{label}</span>
      <span className="font-medium text-ink-900">{children}</span>
    </div>
  );
}

function ImportList({ imports }: { imports: ImportSummary[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Источники данных</CardTitle>
      </CardHeader>
      <CardBody className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-[13px]">
            <thead>
              <tr className="border-b border-ink-100 text-left text-[12px] uppercase tracking-wide text-ink-400">
                <th className="px-5 py-2.5 font-medium">Источник</th>
                <th className="px-5 py-2.5 font-medium">Файл</th>
                <th className="px-5 py-2.5 font-medium">Актуально на</th>
                <th className="px-5 py-2.5 font-medium">Загружено</th>
                <th className="px-5 py-2.5 font-medium">Объявлений</th>
              </tr>
            </thead>
            <tbody>
              {imports.map((item) => (
                <tr key={item.id} className="border-b border-ink-50 last:border-0 align-top">
                  <td className="px-5 py-3">
                    <p className="font-medium text-ink-900">{item.sourceName}</p>
                    {item.sourceUrl ? (
                      <a
                        href={item.sourceUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1 text-[12px] text-brand-600 hover:text-brand-700"
                      >
                        страница источника
                        <ExternalLink className="size-3" aria-hidden />
                      </a>
                    ) : null}
                    {item.warnings.length > 0 ? (
                      <ul className="mt-1 space-y-0.5 text-[12px] leading-relaxed text-amber-700">
                        {item.warnings.map((warning) => (
                          <li key={warning}>{warning}</li>
                        ))}
                      </ul>
                    ) : null}
                  </td>
                  <td className="px-5 py-3 text-ink-600">{item.fileName}</td>
                  <td className="px-5 py-3 text-ink-900">{formatDate(item.actualAt)}</td>
                  <td className="px-5 py-3 text-ink-600">{formatDate(item.importedAt)}</td>
                  <td className="px-5 py-3 text-ink-900">
                    {item.opportunities}
                    {item.rowsRejected > 0 ? (
                      <span className="ml-1 text-[12px] text-amber-700">
                        (отклонено {item.rowsRejected})
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}

function SearchForm({
  filters,
  onChange,
  onSubmit,
  loading,
}: {
  filters: SearchFilters;
  onChange: (next: SearchFilters) => void;
  onSubmit: () => void;
  loading: boolean;
}) {
  const set = <K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) => {
    const next = { ...filters };
    if (value === undefined || value === '' || value === null) delete next[key];
    else next[key] = value;
    onChange(next);
  };

  return (
    <Card>
      <CardBody>
        <form
          className="grid gap-4 md:grid-cols-2 lg:grid-cols-4"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <Field label="Поиск по наименованию и заказчику" className="lg:col-span-2">
            {(id) => (
              <Input
                id={id}
                value={filters.query ?? ''}
                onChange={(event) => set('query', event.target.value)}
                placeholder="кабель, видеонаблюдение, ремонт…"
                maxLength={200}
              />
            )}
          </Field>

          <Field label="Регион">
            {(id) => (
              <Input
                id={id}
                value={filters.regions?.join(', ') ?? ''}
                onChange={(event) =>
                  set(
                    'regions',
                    event.target.value
                      .split(',')
                      .map((part) => part.trim())
                      .filter((part) => part.length > 0),
                  )
                }
                placeholder="Алматы, Астана"
              />
            )}
          </Field>

          <Field label="Способ закупки">
            {(id) => (
              <Select
                id={id}
                value={filters.procurementTypes?.[0] ?? ''}
                onChange={(event) =>
                  set(
                    'procurementTypes',
                    event.target.value
                      ? [event.target.value as ProcurementTypeValue]
                      : undefined,
                  )
                }
              >
                <option value="">любой</option>
                {(Object.keys(PROCUREMENT_TYPE_LABELS) as ProcurementTypeValue[]).map(
                  (type) => (
                    <option key={type} value={type}>
                      {PROCUREMENT_TYPE_LABELS[type]}
                    </option>
                  ),
                )}
              </Select>
            )}
          </Field>

          <Field label="Сумма от, ₸">
            {(id) => (
              <Input
                id={id}
                type="number"
                min={0}
                value={filters.minPrice ?? ''}
                onChange={(event) =>
                  set(
                    'minPrice',
                    event.target.value === '' ? undefined : Number(event.target.value),
                  )
                }
              />
            )}
          </Field>

          <Field label="Сумма до, ₸">
            {(id) => (
              <Input
                id={id}
                type="number"
                min={0}
                value={filters.maxPrice ?? ''}
                onChange={(event) =>
                  set(
                    'maxPrice',
                    event.target.value === '' ? undefined : Number(event.target.value),
                  )
                }
              />
            )}
          </Field>

          <Field label="Минимальная оценка соответствия">
            {(id) => (
              <Input
                id={id}
                type="number"
                min={0}
                max={100}
                value={filters.minScore ?? ''}
                onChange={(event) =>
                  set(
                    'minScore',
                    event.target.value === '' ? undefined : Number(event.target.value),
                  )
                }
              />
            )}
          </Field>

          <Field label="Сортировка">
            {(id) => (
              <Select
                id={id}
                value={filters.sort ?? 'score'}
                onChange={(event) =>
                  set('sort', event.target.value as SearchFilters['sort'])
                }
              >
                <option value="score">по соответствию</option>
                <option value="deadline">по сроку подачи</option>
                <option value="price">по сумме</option>
                <option value="imported">по дате импорта</option>
              </Select>
            )}
          </Field>

          <div className="flex flex-wrap items-center gap-4 md:col-span-2 lg:col-span-4">
            <Checkbox
              label="Только с незакрытым приёмом заявок"
              checked={filters.onlyOpen ?? false}
              onChange={(value) => set('onlyOpen', value || undefined)}
            />
            <Checkbox
              label="Только без препятствий по профилю"
              checked={filters.onlySuitable ?? false}
              onChange={(value) => set('onlySuitable', value || undefined)}
            />
            <Checkbox
              label="Только не переданные в расчёт"
              checked={filters.notTransferred ?? false}
              onChange={(value) => set('notTransferred', value || undefined)}
            />
            <Button type="submit" loading={loading} className="ml-auto">
              <Search className="size-4" aria-hidden />
              Найти
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-[13px] text-ink-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500/30"
      />
      {label}
    </label>
  );
}

function Results({
  result,
  expanded,
  onToggle,
  onToTender,
  onPage,
}: {
  result: SearchResponse;
  expanded: string | null;
  onToggle: (id: string) => void;
  onToTender?: (id: string) => Promise<void>;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(result.matched / result.pageSize));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-ink-500">
        <span>
          Найдено: <strong className="text-ink-900">{result.matched}</strong>
          {result.matched !== result.scanned
            ? ` из ${result.scanned} отобранных по условиям`
            : ''}
        </span>
        {!result.profileFilled ? (
          <Badge tone="caution">
            профиль не заполнен — оценка соответствия ограничена
          </Badge>
        ) : null}
      </div>

      {result.truncated ? (
        <StatusNotice severity="WARNING">
          Условиям отвечает больше записей ({result.total}), чем просмотрено за один
          раз. Уточните фильтры, чтобы ничего не пропустить.
        </StatusNotice>
      ) : null}

      {result.items.length === 0 ? (
        <EmptyState
          title="Под эти условия ничего не подошло"
          description="Ослабьте фильтры или проверьте профиль компании: отбор по предмету работает по его ключевым словам."
        />
      ) : (
        result.items.map((item) => (
          <OpportunityCard
            key={item.id}
            item={item}
            expanded={expanded === item.id}
            onToggle={() => onToggle(item.id)}
            onToTender={onToTender}
          />
        ))
      )}

      {pages > 1 ? (
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={result.page <= 1}
            onClick={() => onPage(result.page - 1)}
          >
            Назад
          </Button>
          <span className="text-[13px] text-ink-500">
            {result.page} из {pages}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={result.page >= pages}
            onClick={() => onPage(result.page + 1)}
          >
            Вперёд
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function OpportunityCard({
  item,
  expanded,
  onToggle,
  onToTender,
}: {
  item: Opportunity;
  expanded: boolean;
  onToggle: () => void;
  onToTender?: (id: string) => Promise<void>;
}) {
  const left = daysLeft(item.deadline);
  const tone = item.match.label === 'ВЫСОКОЕ'
    ? 'positive'
    : item.match.label === 'СРЕДНЕЕ'
      ? 'caution'
      : 'neutral';

  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={item.match.suitable ? tone : 'negative'}>
                {item.match.suitable
                  ? `соответствие ${item.match.score} из 100`
                  : 'не подходит по профилю'}
              </Badge>
              <Badge tone="neutral">
                {PROCUREMENT_TYPE_LABELS[item.procurementType]}
              </Badge>
              {item.externalId ? (
                <span className="text-[12px] text-ink-400">№ {item.externalId}</span>
              ) : null}
            </div>
            <h3 className="mt-1.5 text-[15px] font-medium leading-snug text-ink-900">
              {item.title}
            </h3>
            <p className="mt-0.5 text-[13px] text-ink-500">
              {item.customerName ?? 'Заказчик не указан'}
              {item.customerBin ? ` · БИН ${item.customerBin}` : ''}
              {item.region ? ` · ${item.region}` : ''}
            </p>
          </div>

          <div className="text-right">
            <p className="text-[15px] font-semibold text-ink-900">
              {item.price === null
                ? 'сумма не указана'
                : `${money.format(item.price)} ${item.currency}`}
            </p>
            <p className="mt-0.5 flex items-center justify-end gap-1 text-[12px] text-ink-500">
              <CalendarClock className="size-3.5" aria-hidden />
              {item.deadline
                ? `до ${formatDate(item.deadline)}${left !== null ? ` (${left} дн.)` : ''}`
                : 'срок не указан'}
            </p>
          </div>
        </div>

        {/* Источник показывается всегда: пользователь должен знать, откуда это. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-ink-100 pt-2.5 text-[12px] text-ink-500">
          <span>
            Источник: <span className="text-ink-700">{item.source.name}</span>
          </span>
          <span>Файл: {item.source.fileName}</span>
          <span>Актуально на {formatDate(item.source.actualAt)}</span>
          {item.sourceUrl ? (
            <a
              href={item.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-brand-600 hover:text-brand-700"
            >
              объявление
              <ExternalLink className="size-3" aria-hidden />
            </a>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onToggle}>
            <ChevronDown
              className={`size-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
              aria-hidden
            />
            Почему так оценено
          </Button>

          {item.tender ? (
            <Link
              href={`/tenders/${item.tender.id}/finance`}
              className="text-[13px] font-medium text-brand-600 hover:text-brand-700"
            >
              Открыть расчёт
            </Link>
          ) : onToTender ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void onToTender(item.id)}
            >
              Передать в расчёт
            </Button>
          ) : null}
        </div>

        {onToTender && <InterpretationButton endpoint={`/api/radar/opportunities/${item.id}/ai`} label="AI: сопоставить с профилем" />}
        {expanded ? (
          <div className="space-y-2 rounded-lg bg-ink-50 p-3 text-[13px]">
            {item.match.blockers.length > 0 ? (
              <div>
                <p className="font-medium text-red-700">Препятствия</p>
                <ul className="mt-1 space-y-1">
                  {item.match.blockers.map((blocker) => (
                    <li key={blocker.code} className="flex gap-2 text-ink-700">
                      <XCircle className="mt-0.5 size-3.5 shrink-0 text-red-600" aria-hidden />
                      {blocker.detail}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div>
              <p className="font-medium text-ink-800">Из чего складывается оценка</p>
              <ul className="mt-1 space-y-1">
                {item.match.reasons.map((reason) => (
                  <li key={reason.code + reason.detail} className="flex gap-2 text-ink-700">
                    {reason.weight > 0 ? (
                      <CheckCircle2
                        className="mt-0.5 size-3.5 shrink-0 text-emerald-600"
                        aria-hidden
                      />
                    ) : (
                      <AlertTriangle
                        className="mt-0.5 size-3.5 shrink-0 text-ink-400"
                        aria-hidden
                      />
                    )}
                    <span>
                      {reason.detail}
                      {reason.weight > 0 ? (
                        <span className="ml-1 text-ink-400">+{reason.weight}</span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-[12px] leading-relaxed text-ink-400">
              Оценка — мера совпадения закупки с профилем компании, а не прогноз
              победы. Решение принимает человек.
            </p>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
