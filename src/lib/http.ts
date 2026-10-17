/**
 * Единый формат ответов API и обработка ошибок.
 */

import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AuthError, MfaError } from './auth/guard';
import { DocumentIntegrityError } from './documents/storage';
import { EncryptionKeyError } from './documents/encryption';
import { RateLimitError, RequestError } from './security/request';
import { jsonSafe } from './serialize';
import { trustedClientIp } from './security/client-ip';

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
    // Ответы с ошибками тоже не должны попадать в кэши промежуточных узлов:
    // они содержат сведения о состоянии конкретной сессии.
    { status, headers: { 'Cache-Control': 'private, no-store' } },
  );
}

/** Приводит любую ошибку обработчика к корректному HTTP-ответу. */
export function handleApiError(error: unknown) {
  if (error instanceof RateLimitError) {
    const response = jsonError(error.message, 429, { retryAfterSeconds: error.retryAfterSeconds });
    response.headers.set('Retry-After', String(error.retryAfterSeconds));
    return response;
  }
  if (error instanceof RequestError) return jsonError(error.message, error.status);
  if (error instanceof RangeError) return jsonError('Финансовое значение выходит за допустимый диапазон', 422);
  if (error instanceof DocumentIntegrityError) {
    // Это проблема хранилища, не запроса: сообщение честное, подробности
    // файла не раскрываются.
    return jsonError(error.message, 500);
  }
  if (error instanceof EncryptionKeyError) {
    return jsonError('Хранилище документов не настроено. Обратитесь к администратору.', 503);
  }
  if (error instanceof MfaError) {
    // Клиент по этому признаку уводит пользователя на /mfa.
    return jsonError(error.message, error.status, { mfaGate: error.gate });
  }
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
    // Вне production текст ошибки нужен для диагностики; в production он
    // не раскрывается, чтобы не утекли подробности запроса.
    if (process.env.NODE_ENV !== 'production') console.error(error);
    return jsonError('Внутренняя ошибка сервера', 500, { errorId });
  }
  console.error('Неизвестная ошибка API:', error);
  return jsonError('Внутренняя ошибка сервера', 500);
}

/** IP клиента из заголовков прокси. */
export function clientIp(request: Request): string | null {
  return trustedClientIp(request);
}
