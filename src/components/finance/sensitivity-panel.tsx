'use client';

import { formatMinorKzt, formatRatioAsPercent } from '@/lib/money';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import type { SensitivityResult, SensitivityRow } from '@/lib/finance/types';

export function SensitivityPanel({
  sensitivity,
}: {
  sensitivity: SensitivityResult;
}) {
  if (sensitivity.priceDrop.length === 0) {
    return (
      <EmptyState
        title="Чувствительность не рассчитана"
        description="Укажите цену предложения и затраты — расчёт покажет, насколько можно подвинуться в цене и какой рост затрат выдержит сделка."
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Card>
          <CardBody>
            <p className="text-[12px] uppercase tracking-wide text-ink-400">
              Запас по цене до нуля
            </p>
            <p className="mt-1.5 text-[22px] font-semibold tabular text-ink-900">
              {sensitivity.priceDropToZeroRatio === null
                ? '—'
                : formatRatioAsPercent(sensitivity.priceDropToZeroRatio)}
            </p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-500">
              На столько можно снизить цену предложения, прежде чем сделка станет
              убыточной.
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-[12px] uppercase tracking-wide text-ink-400">
              Запас по затратам до нуля
            </p>
            <p className="mt-1.5 text-[22px] font-semibold tabular text-ink-900">
              {sensitivity.costIncreaseToZeroRatio === null
                ? '—'
                : formatRatioAsPercent(sensitivity.costIncreaseToZeroRatio)}
            </p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-500">
              Такой рост затрат сделка выдержит без убытка.
            </p>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Снижение цены предложения</CardTitle>
          <CardDescription>
            Что произойдёт, если на торгах придётся опустить цену.
          </CardDescription>
        </CardHeader>
        <CardBody className="p-0">
          <SensitivityTable rows={sensitivity.priceDrop} factorLabel="Изменение цены" />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Рост затрат</CardTitle>
          <CardDescription>
            Подорожание закупки, логистики и работ — обычная причина убытка по
            длинным контрактам.
          </CardDescription>
        </CardHeader>
        <CardBody className="p-0">
          <SensitivityTable
            rows={sensitivity.costIncrease}
            factorLabel="Рост затрат"
            hidePrice
          />
        </CardBody>
      </Card>
    </div>
  );
}

function SensitivityTable({
  rows,
  factorLabel,
  hidePrice,
}: {
  rows: SensitivityRow[];
  factorLabel: string;
  hidePrice?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-ink-100 text-left text-[12px] uppercase tracking-wide text-ink-400">
            <th className="px-5 py-2.5 font-medium">{factorLabel}</th>
            {hidePrice ? null : (
              <th className="px-5 py-2.5 text-right font-medium">Цена</th>
            )}
            <th className="px-5 py-2.5 text-right font-medium">Чистая прибыль</th>
            <th className="px-5 py-2.5 text-right font-medium">Рентабельность</th>
            <th className="px-5 py-2.5 text-center font-medium">Итог</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.changePercent}
              className="border-b border-ink-50 last:border-0"
            >
              <td className="px-5 py-2.5 font-medium text-ink-800">
                {row.changePercent > 0 ? '+' : ''}
                {row.changePercent} %
              </td>
              {hidePrice ? null : (
                <td className="px-5 py-2.5 text-right tabular text-ink-700">
                  {formatMinorKzt(row.priceMinor)}
                </td>
              )}
              <td
                className={
                  row.isProfitable
                    ? 'px-5 py-2.5 text-right tabular text-emerald-700'
                    : 'px-5 py-2.5 text-right tabular text-red-700'
                }
              >
                {formatMinorKzt(row.netProfitMinor)}
              </td>
              <td className="px-5 py-2.5 text-right tabular text-ink-600">
                {formatRatioAsPercent(row.netMarginRatio)}
              </td>
              <td className="px-5 py-2.5 text-center">
                <Badge tone={row.isProfitable ? 'positive' : 'negative'}>
                  {row.isProfitable ? 'Прибыль' : 'Убыток'}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
