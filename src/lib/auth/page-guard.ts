/**
 * Проверки доступа для серверных страниц.
 *
 * Отличие от guard.ts: там непройденная проверка — это ошибка HTTP (нужно
 * для API), а на странице пользователя нужно увести на нужный шаг. Поэтому
 * здесь redirect, а не исключение: иначе вместо формы второго фактора
 * пользователь видел бы экран ошибки.
 */

import { redirect } from 'next/navigation';
import { sessionMfaGate } from './guard';
import { getCurrentSession, type VerifiedSession } from './session';

/**
 * Сессия для защищённой страницы: без авторизации — на вход,
 * без пройденного второго фактора — на его подключение или подтверждение.
 */
export async function requirePageSession(): Promise<VerifiedSession> {
  const session = await getCurrentSession();
  if (!session) redirect('/login');
  if (sessionMfaGate(session) !== 'OK') redirect('/mfa');
  return session;
}
