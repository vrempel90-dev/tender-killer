'use client';

import { forwardRef, useId } from 'react';
import { cn } from '@/lib/cn';

export function Label({
  className,
  children,
  htmlFor,
  hint,
}: {
  className?: string;
  children: React.ReactNode;
  htmlFor?: string;
  hint?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn('block text-[13px] font-medium text-ink-700', className)}
    >
      {children}
      {hint ? (
        <span className="ml-1 font-normal text-ink-400">({hint})</span>
      ) : null}
    </label>
  );
}

export const Input = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        'h-10 w-full rounded-lg border border-ink-200 bg-white px-3 text-sm text-ink-900',
        'placeholder:text-ink-300 focus:border-brand-500 focus:outline-none',
        'focus:ring-2 focus:ring-brand-500/20 disabled:bg-ink-50 disabled:text-ink-400',
        className,
      )}
      {...props}
    />
  );
});

export const Select = forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, children, ...props }, ref) {
  return (
    <select
      ref={ref}
      className={cn(
        'h-10 w-full rounded-lg border border-ink-200 bg-white px-3 text-sm text-ink-900',
        'focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
});

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        'w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900',
        'placeholder:text-ink-300 focus:border-brand-500 focus:outline-none',
        'focus:ring-2 focus:ring-brand-500/20',
        className,
      )}
      {...props}
    />
  );
});

/** Поле с подписью, подсказкой и текстом ошибки. */
export function Field({
  label,
  hint,
  error,
  help,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  help?: string;
  children: (id: string) => React.ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={id} hint={hint}>
        {label}
      </Label>
      {children(id)}
      {help && !error ? (
        <p className="text-[12px] leading-relaxed text-ink-400">{help}</p>
      ) : null}
      {error ? (
        <p className="text-[12px] font-medium text-red-600">{error}</p>
      ) : null}
    </div>
  );
}
