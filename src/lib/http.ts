/**
 * Единый формат ответов API и обработка ошибок.
 */

import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AuthError } from './auth/guard';
import { RequestError } from './security/request';
import { jsonSafe } from './serialize';

export function jsonOk<T>(data: T, status = 200) {
  return NextResponse.json({ ok: true, data: jsonSafe(data) }, { status, headers: { 'Cache-Control': 'private, no-store' } });
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
  if (error instanceof RequestError) return jsonError(error.message, error.status);
  if (error instanceof RangeError) return jsonError('Финансовое значение выходит за допустимый диапазон', 422);
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
    // Log a correlation ID and class, never raw SQL, document text or credentials.
    const errorId = crypto.randomUUID();
    console.error(JSON.stringify({ event: 'api_error', errorId, type: error.name }));
    return jsonError('Внутренняя ошибка сервера', 500, { errorId });
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
