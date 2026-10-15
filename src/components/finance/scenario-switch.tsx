'use client';

import { cn } from '@/lib/cn';
import { formatMinorKzt, formatRatioAsPercent } from '@/lib/money';
import type { ScenarioCode, ScenarioResult } from '@/lib/finance/types';

export function ScenarioSwitch({
  scenarios,
  active,
  onChange,
}: {
  scenarios: ScenarioResult[];
  active: ScenarioCode;
  onChange: (code: ScenarioCode) => void;
}) {
  if (scenarios.length === 0) return null;

  return (
    <div className="grid gap-2.5 sm:grid-cols-3">
      {scenarios.map((s) => {
        const selected = s.code === active;
        const profitable = s.result.profit.netMinor > 0;
        return (
          <button
            key={s.code}
            type="button"
            onClick={() => onChange(s.code)}
            className={cn(
              'rounded-xl border px-4 py-3 text-left transition-colors',
              selected
                ? 'border-brand-500 bg-brand-50/60 ring-1 ring-brand-500'
                : 'border-ink-200 bg-white hover:border-ink-300',
            )}
            aria-pressed={selected}
          >
            <p
              className={cn(
                'text-[13px] font-semibold',
                selected ? 'text-brand-800' : 'text-ink-800',
              )}
            >
              {s.label}
            </p>
            <p
              className={cn(
                'mt-1.5 text-[18px] font-semibold tabular',
                profitable ? 'text-emerald-700' : 'text-red-700',
              )}
            >
              {formatMinorKzt(s.result.profit.netMinor)}
            </p>
            <p className="mt-0.5 text-[12px] text-ink-500">
              Рентабельность {formatRatioAsPercent(s.result.margins.netRatio)}
            </p>
            <p className="mt-2 text-[11.5px] leading-snug text-ink-400">
              {s.description}
            </p>
          </button>
        );
      })}
    </div>
  );
}
