import { NextRequest, NextResponse } from 'next/server';
import { assertTrustedMutation, RequestError } from '@/lib/security/request';

export function proxy(request: NextRequest) {
  try { assertTrustedMutation(request); }
  catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof RequestError ? e.message : 'Ошибка конфигурации' },
      { status: e instanceof RequestError ? e.status : 503 });
  }
  return NextResponse.next();
}
export const config = { matcher: '/api/:path*' };
