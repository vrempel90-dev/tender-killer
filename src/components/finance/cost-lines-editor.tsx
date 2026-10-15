'use client';

import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { MoneyInput } from './money-input';
import type { ItemCostLine, SimpleCostLine } from '@/lib/finance/types';

const VAT_MODE_OPTIONS = [
  { value: 'INCLUSIVE', label: 'с НДС' },
  { value: 'EXCLUSIVE', label: 'без НДС' },
] as const;

/** Редактор простых затратных строк (логистика, субподряд, накладные). */
export function SimpleCostLinesEditor({
  lines,
  onChange,
  addLabel,
  namePlaceholder,
}: {
  lines: SimpleCostLine[];
  onChange: (next: SimpleCostLine[]) => void;
  addLabel: string;
  namePlaceholder: string;
}) {
  function update(index: number, patch: Partial<SimpleCostLine>) {
    onChange(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  return (
    <div className="space-y-2.5">
      {lines.length === 0 ? (
        <p className="rounded-lg border border-dashed border-ink-200 bg-ink-50/40 px-3 py-3 text-[12.5px] text-ink-400">
          Строк нет. Незаполненные затраты в расчёт не попадают.
        </p>
      ) : null}

      {lines.map((line, index) => (
        <div
          key={index}
          className="grid gap-2 rounded-lg border border-ink-200 bg-white p-2.5 sm:grid-cols-[1fr_130px_96px_auto]"
        >
          <Input
            value={line.label}
            placeholder={namePlaceholder}
            onChange={(e) => update(index, { label: e.target.value })}
          />
          <MoneyInput
            valueMinor={line.amountMinor}
            allowNull={false}
            onChangeMinor={(v) => update(index, { amountMinor: v ?? 0 })}
            placeholder="сумма, ₸"
          />
          <Select
            value={line.vatMode}
            onChange={(e) =>
              update(index, { vatMode: e.target.value as SimpleCostLine['vatMode'] })
            }
          >
            {VAT_MODE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-[12px] text-ink-600">
              <input
                type="checkbox"
                checked={line.supplierChargesVat}
                onChange={(e) =>
                  update(index, { supplierChargesVat: e.target.checked })
                }
                className="size-3.5 rounded border-ink-300"
              />
              НДС
            </label>
            <label
              className="flex items-center gap-1.5 text-[12px] text-ink-600"
              title="Есть подтверждающий документ: КП, счёт, прайс"
            >
              <input
                type="checkbox"
                checked={line.verified}
                onChange={(e) => update(index, { verified: e.target.checked })}
                className="size-3.5 rounded border-ink-300"
              />
              Док.
            </label>
            <button
              type="button"
              onClick={() => onChange(lines.filter((_, i) => i !== index))}
              className="rounded p-1 text-ink-400 hover:bg-red-50 hover:text-red-600"
              aria-label="Удалить строку"
            >
              <Trash2 className="size-4" aria-hidden />
            </button>
          </div>
        </div>
      ))}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          onChange([
            ...lines,
            {
              label: '',
              amountMinor: 0,
              vatMode: 'INCLUSIVE',
              supplierChargesVat: true,
              verified: false,
            },
          ])
        }
      >
        <Plus className="size-3.5" aria-hidden />
        {addLabel}
      </Button>
    </div>
  );
}

/** Редактор товарных позиций с количеством. */
export function ItemCostLinesEditor({
  items,
  onChange,
}: {
  items: ItemCostLine[];
  onChange: (next: ItemCostLine[]) => void;
}) {
  function update(index: number, patch: Partial<ItemCostLine>) {
    onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  return (
    <div className="space-y-2.5">
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-ink-200 bg-ink-50/40 px-3 py-3 text-[12.5px] text-ink-400">
          Позиций нет. Добавьте вручную или импортируйте из коммерческого
          предложения поставщика в разделе «AI-Снабженец».
        </p>
      ) : null}

      {items.map((item, index) => (
        <div
          key={index}
          className="grid gap-2 rounded-lg border border-ink-200 bg-white p-2.5 sm:grid-cols-[1fr_80px_72px_140px_auto]"
        >
          <Input
            value={item.label}
            placeholder="Наименование позиции"
            onChange={(e) => update(index, { label: e.target.value })}
          />
          <Input
            type="number"
            min="0"
            step="any"
            value={item.quantity}
            placeholder="кол-во"
            onChange={(e) =>
              update(index, { quantity: Number(e.target.value) || 0 })
            }
          />
          <Input
            value={item.unit ?? 'шт'}
            placeholder="ед."
            onChange={(e) => update(index, { unit: e.target.value })}
          />
          <MoneyInput
            valueMinor={item.unitCostMinor}
            allowNull={false}
            onChangeMinor={(v) => update(index, { unitCostMinor: v ?? 0 })}
            placeholder="цена за ед., ₸"
          />
          <div className="flex items-center gap-2">
            <Select
              value={item.vatMode}
              className="h-10 w-[104px]"
              onChange={(e) =>
                update(index, { vatMode: e.target.value as ItemCostLine['vatMode'] })
              }
            >
              {VAT_MODE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            <label
              className="flex items-center gap-1.5 text-[12px] text-ink-600"
              title="Цена подтверждена документом поставщика"
            >
              <input
                type="checkbox"
                checked={item.verified}
                onChange={(e) => update(index, { verified: e.target.checked })}
                className="size-3.5 rounded border-ink-300"
              />
              Док.
            </label>
            <button
              type="button"
              onClick={() => onChange(items.filter((_, i) => i !== index))}
              className="rounded p-1 text-ink-400 hover:bg-red-50 hover:text-red-600"
              aria-label="Удалить позицию"
            >
              <Trash2 className="size-4" aria-hidden />
            </button>
          </div>
        </div>
      ))}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          onChange([
            ...items,
            {
              label: '',
              quantity: 1,
              unitCostMinor: 0,
              unit: 'шт',
              vatMode: 'INCLUSIVE',
              supplierChargesVat: true,
              verified: false,
            },
          ])
        }
      >
        <Plus className="size-3.5" aria-hidden />
        Добавить позицию
      </Button>
    </div>
  );
}
