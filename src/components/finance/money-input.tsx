'use client';

import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/field';
import { toMajor, toMinor } from '@/lib/money';

/**
 * Ввод денежной суммы в тенге с хранением в тиын.
 * Пустое поле = null (данные не заполнены), а не 0.
 */
export function MoneyInput({
  valueMinor,
  onChangeMinor,
  id,
  placeholder,
  allowNull = true,
  className,
  disabled,
}: {
  valueMinor: number | null;
  onChangeMinor: (next: number | null) => void;
  id?: string;
  placeholder?: string;
  allowNull?: boolean;
  className?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(
    valueMinor === null ? '' : String(toMajor(valueMinor)),
  );

  // Синхронизация при внешнем изменении (например, подстановка из КП).
  useEffect(() => {
    const external = valueMinor === null ? '' : String(toMajor(valueMinor));
    setText((current) =>
      toMinorOrNull(current) === valueMinor ? current : external,
    );
  }, [valueMinor]);

  return (
    <Input
      id={id}
      type="number"
      min="0"
      step="0.01"
      inputMode="decimal"
      className={className}
      disabled={disabled}
      placeholder={placeholder ?? 'не заполнено'}
      value={text}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        const parsed = toMinorOrNull(next);
        onChangeMinor(parsed === null && !allowNull ? 0 : parsed);
      }}
    />
  );
}

function toMinorOrNull(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return toMinor(parsed);
}

/** Ввод числового значения (процент, дни) с поддержкой пустого значения. */
export function NumberInput({
  value,
  onChange,
  id,
  min = 0,
  max,
  step = 'any',
  suffix,
  placeholder,
  allowNull = true,
  disabled,
}: {
  value: number | null;
  onChange: (next: number | null) => void;
  id?: string;
  min?: number;
  max?: number;
  step?: number | 'any';
  suffix?: string;
  placeholder?: string;
  allowNull?: boolean;
  disabled?: boolean;
}) {
  const [text, setText] = useState(value === null ? '' : String(value));

  useEffect(() => {
    const external = value === null ? '' : String(value);
    setText((current) => (parseOrNull(current) === value ? current : external));
  }, [value]);

  return (
    <div className="relative">
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        inputMode="decimal"
        disabled={disabled}
        placeholder={placeholder ?? 'не заполнено'}
        className={suffix ? 'pr-10' : undefined}
        value={text}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          const parsed = parseOrNull(next);
          onChange(parsed === null && !allowNull ? 0 : parsed);
        }}
      />
      {suffix ? (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-ink-400">
          {suffix}
        </span>
      ) : null}
    </div>
  );
}

function parseOrNull(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}
