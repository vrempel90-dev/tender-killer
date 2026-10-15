'use client';

import { useState } from 'react';
import { ChevronDown, Info } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatMinorKzt, formatRatioAsPercent } from '@/lib/money';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { StatTile } from '@/components/ui/stat-tile';
import { StatusNotice } from '@/components/ui/status-notice';
import { Badge } from '@/components/ui/badge';
import type { FinanceResult, FormulaExplanation } from '@/lib/finance/types';

export function ResultsPanel({ result }: { result: FinanceResult }) {
  const profitable = result.profit.netMinor > 0;

  return (
    <div className="space-y-5">
      {result.missingInputs.length > 0 ? (
        <StatusNotice severity="WARNING" title="Не хватает данных для полного расчёта">
          <ul className="mt-1 space-y-1">
            {result.missingInputs.map((m) => (
              <li key={m.field}>
                <span className="font-medium">{m.label}</span> — без него не
                рассчитываются: {m.affects.join(', ')}
              </li>
            ))}
          </ul>
        </StatusNotice>
      ) : null}

      {result.warnings.map((w) => (
        <StatusNotice key={w.code} severity={w.severity}>
          {w.message}
        </StatusNotice>
      ))}

      {/* Ключевые показатели */}
      <section className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Выручка без НДС"
          value={formatMinorKzt(result.revenue.netMinor)}
          hint={`С НДС: ${formatMinorKzt(result.revenue.grossMinor)}`}
        />
        <StatTile
          label="Полная себестоимость"
          value={formatMinorKzt(result.costs.totalMinor)}
          hint="Возвратные залоги не включены"
        />
        <StatTile
          label="Расчётная чистая прибыль"
          value={formatMinorKzt(result.profit.netMinor)}
          tone={profitable ? 'positive' : 'negative'}
          hint="Это не деньги на счёте"
        />
        <StatTile
          label="Рентабельность продаж"
          value={formatRatioAsPercent(result.margins.netRatio)}
          tone={profitable ? 'positive' : 'negative'}
          hint="Чистая прибыль ÷ выручка без НДС"
        />
      </section>

      <section className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="ROI"
          value={formatRatioAsPercent(result.roi.ratio)}
          hint={
            result.roi.investedCapitalMinor === null
              ? 'Собственные средства не вкладываются'
              : `На вложенные ${formatMinorKzt(result.roi.investedCapitalMinor)}`
          }
          tone={
            result.roi.ratio === null
              ? 'neutral'
              : result.roi.ratio > 0
                ? 'positive'
                : 'negative'
          }
        />
        <StatTile
          label="Пиковый кассовый разрыв"
          value={
            result.workingCapital.requirementMinor === 0
              ? '—'
              : formatMinorKzt(result.workingCapital.requirementMinor)
          }
          tone={result.workingCapital.requirementMinor > 0 ? 'caution' : 'neutral'}
          hint={
            result.workingCapital.peakGapDay === null
              ? 'Разрыва нет'
              : `День ${result.workingCapital.peakGapDay}, в дефиците ${result.workingCapital.daysInDeficit} дн.`
          }
        />
        <StatTile
          label="Безубыточная цена"
          value={
            result.breakEven.priceMinor === null
              ? '—'
              : formatMinorKzt(result.breakEven.priceMinor)
          }
          hint={
            result.breakEven.marginOverBreakEvenRatio === null
              ? result.breakEven.note
              : `Запас до убытка ${formatRatioAsPercent(result.breakEven.marginOverBreakEvenRatio)}`
          }
        />
        <StatTile
          label="Цена под целевую прибыль"
          value={
            result.targetPrice.priceMinor === null
              ? '—'
              : formatMinorKzt(result.targetPrice.priceMinor)
          }
          hint={
            result.targetPrice.targetNetProfitMinor === null
              ? 'Цель не задана'
              : `Цель: ${formatMinorKzt(result.targetPrice.targetNetProfitMinor)}`
          }
        />
      </section>

      {/* Структура прибыли */}
      <Card>
        <CardHeader>
          <CardTitle>Структура результата</CardTitle>
        </CardHeader>
        <CardBody className="p-0">
          <table className="w-full table-fixed text-[13px]">
            <tbody>
              <Row label="Выручка с НДС (сумма договора)" value={result.revenue.grossMinor} />
              <Row
                label="НДС с реализации"
                value={-result.revenue.vatOutputMinor}
                muted
                note="Не доход: собирается для бюджета"
              />
              <Row label="Выручка без НДС" value={result.revenue.netMinor} strong />
              <Row
                label="Товары и материалы"
                value={-result.costs.directItemsNetMinor}
              />
              <Row label="Прочие прямые затраты" value={-result.costs.otherDirectNetMinor} />
              <Row label="Логистика и доставка" value={-result.costs.logisticsNetMinor} />
              <Row label="Таможенные платежи" value={-result.costs.customsMinor} />
              <Row
                label="Субподряд"
                value={-result.costs.subcontractorsNetMinor}
              />
              <Row label="Валовая прибыль" value={result.profit.grossMinor} strong />
              <Row label="Фонд оплаты труда" value={-result.costs.payrollMinor} />
              <Row label="Налоги и отчисления с ФОТ" value={-result.costs.payrollTaxesMinor} />
              <Row label="Накладные расходы" value={-result.costs.overheadNetMinor} />
              <Row label="Резерв на непредвиденные расходы" value={-result.costs.contingencyMinor} />
              <Row
                label="Невозмещаемый входящий НДС"
                value={-result.costs.vatNonRecoverableMinor}
                note={
                  result.costs.vatNonRecoverableMinor > 0
                    ? 'Не принимается в зачёт — реальный расход'
                    : undefined
                }
              />
              <Row label="Банковские комиссии" value={-result.costs.bankFeesMinor} />
              <Row
                label="Резерв на гарантийные обязательства"
                value={-result.costs.warrantyReserveMinor}
              />
              <Row
                label="Операционная прибыль"
                value={result.profit.operatingMinor}
                strong
              />
              <Row label="Проценты по заёмным средствам" value={-result.costs.financingCostMinor} />
              <Row
                label="Стоимость обеспечений"
                value={-result.costs.securityCostMinor}
                note="Комиссии за гарантии и стоимость замороженных денег"
              />
              <Row
                label="Прибыль до налогообложения"
                value={result.profit.preTaxMinor}
                strong
              />
              <Row label="Налог на доход" value={-result.profit.incomeTaxMinor} />
              <Row
                label="Расчётная чистая прибыль"
                value={result.profit.netMinor}
                strong
                highlight
              />
            </tbody>
          </table>
        </CardBody>
      </Card>

      {/* Прибыль vs денежный поток */}
      <Card>
        <CardHeader>
          <CardTitle>Прибыль и деньги — это разные величины</CardTitle>
        </CardHeader>
        <CardBody>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-[12px] uppercase tracking-wide text-ink-400">
                Расчётная прибыль
              </p>
              <p
                className={cn(
                  'mt-1 text-lg font-semibold tabular',
                  profitable ? 'text-emerald-700' : 'text-red-700',
                )}
              >
                {formatMinorKzt(result.profit.netMinor)}
              </p>
            </div>
            <div>
              <p className="text-[12px] uppercase tracking-wide text-ink-400">
                Итоговый денежный поток
              </p>
              <p
                className={cn(
                  'mt-1 text-lg font-semibold tabular',
                  result.cashflow.netCashMinor >= 0
                    ? 'text-emerald-700'
                    : 'text-red-700',
                )}
              >
                {formatMinorKzt(result.cashflow.netCashMinor)}
              </p>
            </div>
            <div>
              <p className="text-[12px] uppercase tracking-wide text-ink-400">
                Расхождение
              </p>
              <p className="mt-1 text-lg font-semibold tabular text-ink-900">
                {formatMinorKzt(result.cashflow.profitVsCashDeltaMinor)}
              </p>
            </div>
          </div>
          <p className="mt-3 text-[12.5px] leading-relaxed text-ink-500">
            Расхождение возникает из-за НДС (в потоке суммы с налогом), возвратных
            обеспечений, гарантийных удержаний и сроков платежей. Прибыльный тендер
            может потребовать денег, которых нет.
          </p>
        </CardBody>
      </Card>

      {/* НДС */}
      <Card>
        <CardHeader>
          <CardTitle>Расчёты по НДС</CardTitle>
        </CardHeader>
        <CardBody className="p-0">
          <table className="w-full table-fixed text-[13px]">
            <tbody>
              <Row label="НДС с реализации (исходящий)" value={result.vat.outputMinor} />
              <Row label="Входящий НДС по затратам" value={result.costs.vatInputTotalMinor} />
              <Row
                label="Принято в зачёт"
                value={result.vat.recoverableInputMinor}
              />
              <Row
                label="Не принято в зачёт (расход)"
                value={result.costs.vatNonRecoverableMinor}
              />
              <Row label="НДС к уплате в бюджет" value={result.vat.payableMinor} strong />
            </tbody>
          </table>
        </CardBody>
      </Card>

      {/* Подтверждённость данных */}
      <Card>
        <CardHeader>
          <CardTitle>Достоверность исходных данных</CardTitle>
        </CardHeader>
        <CardBody className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              tone={
                result.verifiedCostShareRatio === null
                  ? 'neutral'
                  : result.verifiedCostShareRatio >= 0.8
                    ? 'positive'
                    : result.verifiedCostShareRatio >= 0.5
                      ? 'caution'
                      : 'negative'
              }
            >
              Подтверждено документами:{' '}
              {formatRatioAsPercent(result.verifiedCostShareRatio)}
            </Badge>
            <Badge tone="neutral">
              Без подтверждения: {formatMinorKzt(result.unverifiedCostMinor)}
            </Badge>
          </div>
          <p className="text-[12.5px] leading-relaxed text-ink-500">
            Подтверждёнными считаются затраты, по которым отмечен документ-основание
            (коммерческое предложение, счёт, прайс-лист). Остальные суммы — оценка.
          </p>
          <p className="text-[12px] text-ink-400">
            Версия движка {result.engineVersion} · налоговый конфиг{' '}
            {result.taxConfigVersion}
          </p>
        </CardBody>
      </Card>

      <FormulaList explanations={result.explanations} />
    </div>
  );
}

function Row({
  label,
  value,
  strong,
  muted,
  highlight,
  note,
}: {
  label: string;
  value: number;
  strong?: boolean;
  muted?: boolean;
  highlight?: boolean;
  note?: string;
}) {
  if (value === 0 && !strong) return null;
  return (
    <tr
      className={cn(
        'border-b border-ink-50 last:border-0',
        strong && 'bg-ink-50/60',
        highlight && 'bg-brand-50/60',
      )}
    >
      <td
        className={cn(
          'break-words px-5 py-2.5',
          strong ? 'font-semibold text-ink-900' : 'text-ink-600',
          muted && 'text-ink-400',
        )}
      >
        {label}
        {note ? (
          <span className="ml-2 text-[11.5px] text-ink-400">{note}</span>
        ) : null}
      </td>
      <td
        className={cn(
          'whitespace-nowrap px-5 py-2.5 text-right tabular',
          strong ? 'font-semibold text-ink-900' : 'text-ink-700',
          value < 0 && !strong && 'text-ink-600',
        )}
      >
        {formatMinorKzt(value)}
      </td>
    </tr>
  );
}

function FormulaList({ explanations }: { explanations: FormulaExplanation[] }) {
  const [openKey, setOpenKey] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Как считается каждый показатель</CardTitle>
      </CardHeader>
      <CardBody className="space-y-1.5 p-3">
        {explanations.map((e) => {
          const open = openKey === e.key;
          return (
            <div
              key={e.key}
              className="overflow-hidden rounded-lg border border-ink-150 border-ink-200"
            >
              <button
                type="button"
                onClick={() => setOpenKey(open ? null : e.key)}
                className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left hover:bg-ink-50"
                aria-expanded={open}
              >
                <span className="flex items-center gap-2 text-[13px] font-medium text-ink-800">
                  <Info className="size-3.5 shrink-0 text-ink-400" aria-hidden />
                  {e.label}
                </span>
                <ChevronDown
                  className={cn(
                    'size-4 shrink-0 text-ink-400 transition-transform',
                    open && 'rotate-180',
                  )}
                  aria-hidden
                />
              </button>
              {open ? (
                <div className="space-y-2.5 border-t border-ink-100 bg-ink-50/40 px-3.5 py-3 text-[12.5px] leading-relaxed">
                  <div>
                    <p className="font-medium text-ink-700">Формула</p>
                    <p className="mt-0.5 text-ink-600">{e.formula}</p>
                  </div>
                  <div>
                    <p className="font-medium text-ink-700">Подстановка значений</p>
                    <p className="mt-0.5 font-mono text-[12px] text-ink-600">
                      {e.substitution}
                    </p>
                  </div>
                  <div>
                    <p className="font-medium text-ink-700">Что это означает</p>
                    <p className="mt-0.5 text-ink-600">{e.meaning}</p>
                  </div>
                  {e.caveat ? (
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2">
                      <p className="font-medium text-amber-900">Важно</p>
                      <p className="mt-0.5 text-amber-800">{e.caveat}</p>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </CardBody>
    </Card>
  );
}
