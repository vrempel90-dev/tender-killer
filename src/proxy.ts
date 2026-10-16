import { NextRequest, NextResponse } from 'next/server';
import { assertTrustedMutation, RequestError } from '@/lib/security/request';

/**
 * Единая точка на входе: проверка источника изменяющих запросов к API и
 * Content-Security-Policy для страниц.
 *
 * CSP строится здесь, а не в next.config, потому что строгая политика
 * требует одноразового nonce: без него пришлось бы разрешить
 * 'unsafe-inline' для скриптов, что обесценивает защиту от XSS. Next
 * читает nonce из заголовка запроса и подставляет его в свои теги script.
 */

function buildCsp(nonce: string): string {
  const development = process.env.NODE_ENV !== 'production';
  return [
    "default-src 'self'",
    // strict-dynamic: скрипты, загруженные доверенным скриптом, тоже
    // доверенные. В dev Turbopack требует eval для горячей перезагрузки.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`,
    // Tailwind и Next вставляют стили инлайн; nonce для стилей Next не ставит.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    // Внешних адресатов у приложения нет: запросы к AI идут с сервера.
    `connect-src 'self'${development ? ' ws: wss:' : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "worker-src 'self' blob:",
    'upgrade-insecure-requests',
  ].join('; ');
}

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith('/api/')) {
    try {
      assertTrustedMutation(request);
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: e instanceof RequestError ? e.message : 'Ошибка конфигурации' },
        { status: e instanceof RequestError ? e.status : 503 },
      );
    }
    return NextResponse.next();
  }

  const nonce = crypto.randomUUID().replace(/-/g, '');
  const csp = buildCsp(nonce);

  // Заголовок на запросе нужен Next, чтобы подставить nonce в свои скрипты.
  const headers = new Headers(request.headers);
  headers.set('content-security-policy', csp);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set('content-security-policy', csp);
  return response;
}

export const config = {
  matcher: [
    // Статика Next уже неизменяема и не исполняет пользовательских данных.
    '/((?!_next/static|_next/image|favicon\\.ico|icon\\.svg).*)',
  ],
};
