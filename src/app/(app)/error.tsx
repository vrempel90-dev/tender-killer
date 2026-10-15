'use client';

import { useEffect } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button, ButtonLink } from '@/components/ui/button';

/**
 * Обработчик ошибок защищённой части приложения.
 * Показывает понятное сообщение вместо пустого экрана и не раскрывает
 * внутренние подробности.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Ошибка страницы:', error);
  }, [error]);

  // Сообщения о правах доступа понятны пользователю и показываются как есть.
  const isAccessError = /Недостаточно прав|Требуется авторизация/.test(
    error.message,
  );

  return (
    <div className="flex flex-1 items-center justify-center px-5 py-16">
      <div className="max-w-md text-center">
        <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-amber-50">
          <AlertTriangle className="size-5 text-amber-600" aria-hidden />
        </div>
        <h1 className="mt-4 text-lg font-semibold text-ink-900">
          {isAccessError ? 'Нет доступа к разделу' : 'Не удалось открыть страницу'}
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-500">
          {isAccessError
            ? error.message
            : 'Произошла ошибка при загрузке данных. Повторите попытку, а если '
              + 'ошибка сохраняется — обратитесь к администратору компании.'}
        </p>
        {!isAccessError && error.digest ? (
          <p className="mt-2 font-mono text-[11.5px] text-ink-400">
            Код ошибки: {error.digest}
          </p>
        ) : null}
        <div className="mt-5 flex justify-center gap-2">
          {!isAccessError ? (
            <Button type="button" onClick={reset}>
              <RotateCcw className="size-4" aria-hidden />
              Повторить
            </Button>
          ) : null}
          <ButtonLink href="/dashboard" variant="outline">
            На главную
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}
