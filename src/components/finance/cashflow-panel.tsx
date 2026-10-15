'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatMinorKzt, toMajor } from '@/lib/money';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import type { FinanceResult } from '@/lib/finance/types';

export function CashflowPanel({ result }: { result: FinanceResult }) {
  const periods = result.cashflow.periods;

  if (periods.length === 0) {
    return (
      <EmptyState
        title="Прогноз движения денег не построен"
        description="Заполните цену предложения, затраты, срок исполнения и срок оплаты — прогноз строится по фактическим датам платежей."
      />
    );
  }

  const chartData = periods.map((p) => ({
    day: p.day,
    cumulative: toMajor(p.cumulativeMinor),
  }));

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Накопленный денежный поток по дням проекта</CardTitle>
          <CardDescription>
            Минимум кривой — это сумма, которую нужно иметь или привлечь. Возвратные
            обеспечения учтены как оттоки с последующим возвратом.
          </CardDescription>
        </CardHeader>
        <CardBody>
          <div className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                <defs>
                  <linearGradient id="cashGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#4f46e5" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#eceef2" />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 11, fill: '#65708b' }}
                  axisLine={{ stroke: '#e4e7ee' }}
                  tickLine={false}
                  label={{
                    value: 'день проекта',
                    position: 'insideBottomRight',
                    offset: -2,
                    style: { fontSize: 11, fill: '#848ea6' },
                  }}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#65708b' }}
                  axisLine={false}
                  tickLine={false}
                  width={86}
                  tickFormatter={(v: number) =>
                    new Intl.NumberFormat('ru-KZ', {
                      notation: 'compact',
                      maximumFractionDigits: 1,
                    }).format(v)
                  }
                />
                <ReferenceLine y={0} stroke="#b0b7c7" strokeDasharray="3 3" />
                <Tooltip
                  contentStyle={{
                    borderRadius: 8,
                    border: '1px solid #e4e7ee',
                    fontSize: 12,
                  }}
                  labelFormatter={(label) => `День ${label}`}
                  formatter={(value) => [
                    `${new Intl.NumberFormat('ru-KZ').format(Number(value ?? 0))} ₸`,
                    'Накопленный поток',
                  ]}
                />
                <Area
                  type="stepAfter"
                  dataKey="cumulative"
                  stroke="#4f46e5"
                  strokeWidth={2}
                  fill="url(#cashGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Движения по дням</CardTitle>
          <CardDescription>
            Все суммы — фактические платежи, включая НДС. Это не отчёт о прибыли.
          </CardDescription>
        </CardHeader>
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-ink-100 text-left text-[12px] uppercase tracking-wide text-ink-400">
                  <th className="px-5 py-2.5 font-medium">День</th>
                  <th className="px-5 py-2.5 font-medium">Операции</th>
                  <th className="px-5 py-2.5 text-right font-medium">Поступления</th>
                  <th className="px-5 py-2.5 text-right font-medium">Выплаты</th>
                  <th className="px-5 py-2.5 text-right font-medium">Накопленный</th>
                </tr>
              </thead>
              <tbody>
                {periods.map((p) => (
                  <tr
                    key={p.day}
                    className={
                      p.day === result.workingCapital.peakGapDay
                        ? 'border-b border-ink-50 bg-amber-50/60'
                        : 'border-b border-ink-50 last:border-0'
                    }
                  >
                    <td className="px-5 py-3 align-top font-medium text-ink-900">
                      {p.day}
                      {p.day === result.workingCapital.peakGapDay ? (
                        <span className="ml-1.5 text-[11px] font-normal text-amber-700">
                          пик разрыва
                        </span>
                      ) : null}
                    </td>
                    <td className="px-5 py-3">
                      <ul className="space-y-0.5 text-[12.5px] text-ink-600">
                        {p.entries.map((e, i) => (
                          <li key={i}>
                            <span
                              className={
                                e.kind === 'IN' ? 'text-emerald-700' : 'text-ink-500'
                              }
                            >
                              {e.kind === 'IN' ? '+' : '−'}
                            </span>{' '}
                            {e.label}
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="px-5 py-3 text-right align-top tabular text-emerald-700">
                      {p.inflowMinor > 0 ? formatMinorKzt(p.inflowMinor) : '—'}
                    </td>
                    <td className="px-5 py-3 text-right align-top tabular text-ink-700">
                      {p.outflowMinor > 0 ? formatMinorKzt(p.outflowMinor) : '—'}
                    </td>
                    <td
                      className={
                        p.cumulativeMinor < 0
                          ? 'px-5 py-3 text-right align-top tabular font-medium text-red-700'
                          : 'px-5 py-3 text-right align-top tabular font-medium text-ink-900'
                      }
                    >
                      {formatMinorKzt(p.cumulativeMinor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
