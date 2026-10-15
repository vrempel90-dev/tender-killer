/**
 * Единый формат ответов API и обработка ошибок.
 */

import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AuthError } from './auth/guard';

export function jsonOk<T>(data: T, status = 200) {
  return NextResponse.json({ ok: true, data }, { status });
}

export function jsonError(
  message: string,
  status = 400,
  details?: unknown,
) {
  return NextResponse.json(
    { ok: false, error: message, details: details ?? null },
    { status },
  );
}

/** Приводит любую ошибку обработчика к корректному HTTP-ответу. */
export function handleApiError(error: unknown) {
  if (error instanceof AuthError) {
    return jsonError(error.message, error.status);
  }
  if (error instanceof ZodError) {
    return jsonError(
      'Некорректные данные запроса',
      422,
      error.issues.map((i) => ({
        field: i.path.join('.'),
        message: i.message,
      })),
    );
  }
  if (error instanceof Error) {
    console.error('Ошибка API:', error);
    return jsonError(error.message, 500);
  }
  console.error('Неизвестная ошибка API:', error);
  return jsonError('Внутренняя ошибка сервера', 500);
}

/** IP клиента из заголовков прокси. */
export function clientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? null;
  return request.headers.get('x-real-ip');
}
