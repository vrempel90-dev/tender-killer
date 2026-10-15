'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Calculator, Check, Save } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { StatusNotice } from '@/components/ui/status-notice';
import type {
  FinanceInput,
  FinanceResult,
  ScenarioCode,
  ScenarioResult,
} from '@/lib/finance/types';
import { CashflowPanel } from './cashflow-panel';
import {
  CostsSection,
  FinancingSection,
  ScheduleSection,
  SecuritiesSection,
  TaxSection,
  TenderPriceSection,
} from './input-sections';
import { ResultsPanel } from './results-panel';
import { ScenarioSwitch } from './scenario-switch';
import { SensitivityPanel } from './sensitivity-panel';

type Tab = 'INPUT' | 'RESULT' | 'CASHFLOW' | 'SENSITIVITY';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'INPUT', label: 'Исходные данные' },
  { id: 'RESULT', label: 'Результат' },
  { id: 'CASHFLOW', label: 'Денежный поток' },
  { id: 'SENSITIVITY', label: 'Чувствительность' },
];

export function FinanceCalculator({
  tenderId,
  initialInput,
  initialModelId,
  initialName,
  canSave,
}: {
  tenderId: string | null;
  initialInput: FinanceInput;
  initialModelId?: string | null;
  initialName?: string;
  canSave: boolean;
}) {
  const [input, setInput] = useState<FinanceInput>(initialInput);
  const [result, setResult] = useState<FinanceResult | null>(null);
  const [scenarios, setScenarios] = useState<ScenarioResult[]>([]);
  const [activeScenario, setActiveScenario] = useState<ScenarioCode>('BASE');
  const [tab, setTab] = useState<Tab>('INPUT');
  const [calculating, setCalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string | null>(initialModelId ?? null);
  const [name, setName] = useState(initialName ?? 'Базовый расчёт');

  const abortRef = useRef<AbortController | null>(null);

  const patch = useCallback(
    (updater: (current: FinanceInput) => FinanceInput) => {
      setInput((current) => updater(current));
    },
    [],
  );

  /** Расчёт выполняется на сервере: движок — единственный источник истины. */
  const calculate = useCallback(async (payload: FinanceInput) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setCalculating(true);
    setError(null);
    try {
      const response = await fetch('/api/finance/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: payload, withScenarios: true }),
        signal: controller.signal,
      });
      const body = await response.json();
      if (!response.ok) {
        setError(
          body.error ??
            'Не удалось выполнить расчёт. Проверьте заполненные значения.',
        );
        return;
      }
      setResult(body.data.result as FinanceResult);
      setScenarios(body.data.scenarios as ScenarioResult[]);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setError('Сервер недоступен. Расчёт не выполнен.');
    } finally {
      setCalculating(false);
    }
  }, []);

  // Автоматический пересчёт с задержкой: пользователь видит актуальные цифры,
  // но сервер не получает запрос на каждое нажатие клавиши.
  useEffect(() => {
    const timer = setTimeout(() => {
      void calculate(input);
    }, 450);
    return () => clearTimeout(timer);
  }, [input, calculate]);

  const shownResult = useMemo(() => {
    if (activeScenario === 'BASE') return result;
    return scenarios.find((s) => s.code === activeScenario)?.result ?? result;
  }, [activeScenario, result, scenarios]);

  async function handleSave() {
    if (!tenderId) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/tenders/${tenderId}/finance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, modelId: modelId ?? undefined, input }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? 'Не удалось сохранить расчёт');
        return;
      }
      setModelId(body.data.id);
      setSavedAt(new Date().toLocaleTimeString('ru-KZ'));
    } catch {
      setError('Сервер недоступен. Расчёт не сохранён.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {error ? <StatusNotice severity="CRITICAL">{error}</StatusNotice> : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex flex-wrap gap-1 rounded-lg bg-ink-100 p-1" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors',
                tab === t.id
                  ? 'bg-white text-ink-900 shadow-sm'
                  : 'text-ink-600 hover:text-ink-900',
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          {calculating ? (
            <span className="flex items-center gap-1.5 text-[12.5px] text-ink-500">
              <Calculator className="size-3.5 animate-pulse" aria-hidden />
              Пересчёт…
            </span>
          ) : savedAt ? (
            <span className="flex items-center gap-1.5 text-[12.5px] text-emerald-700">
              <Check className="size-3.5" aria-hidden />
              Сохранено в {savedAt}
            </span>
          ) : null}
          {tenderId && canSave ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={saving}
              onClick={handleSave}
            >
              <Save className="size-3.5" aria-hidden />
              Сохранить расчёт
            </Button>
          ) : null}
        </div>
      </div>

      {scenarios.length > 0 && tab !== 'INPUT' ? (
        <ScenarioSwitch
          scenarios={scenarios}
          active={activeScenario}
          onChange={setActiveScenario}
        />
      ) : null}

      {tab === 'INPUT' ? (
        <div className="space-y-5">
          {tenderId && canSave ? (
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[240px] flex-1">
                <label
                  htmlFor="model-name"
                  className="block text-[13px] font-medium text-ink-700"
                >
                  Название расчёта
                </label>
                <input
                  id="model-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1.5 h-10 w-full rounded-lg border border-ink-200 px-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                />
              </div>
            </div>
          ) : null}
          <TenderPriceSection input={input} patch={patch} />
          <TaxSection input={input} patch={patch} taxSourcesHref="/settings/taxes" />
          <CostsSection input={input} patch={patch} />
          <ScheduleSection input={input} patch={patch} />
          <SecuritiesSection input={input} patch={patch} />
          <FinancingSection input={input} patch={patch} />
        </div>
      ) : null}

      {tab === 'RESULT' ? (
        shownResult ? (
          <ResultsPanel result={shownResult} />
        ) : (
          <StatusNotice severity="INFO">
            Расчёт выполняется. Если сообщение не исчезает — проверьте значения на
            вкладке «Исходные данные».
          </StatusNotice>
        )
      ) : null}

      {tab === 'CASHFLOW' && shownResult ? (
        <CashflowPanel result={shownResult} />
      ) : null}

      {tab === 'SENSITIVITY' && shownResult ? (
        <SensitivityPanel sensitivity={shownResult.sensitivity} />
      ) : null}
    </div>
  );
}
