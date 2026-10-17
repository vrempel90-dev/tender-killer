import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getCurrentSession } from '@/lib/auth/session';
import { sessionMfaGate } from '@/lib/auth/guard';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Вход' };

export default async function LoginPage() {
  const session = await getCurrentSession();
  if (session) redirect(sessionMfaGate(session) === 'OK' ? '/dashboard' : '/mfa');

  return (
    <div>
      <p className="text-[13px] font-semibold tracking-[0.2em] text-brand-600 lg:hidden">
        TENDER KILLER
      </p>
      <h1 className="mt-4 text-2xl font-semibold text-ink-900 lg:mt-0">
        Вход в систему
      </h1>
      <p className="mt-1.5 text-[13px] text-ink-500">
        Введите данные учётной записи вашей компании.
      </p>
      <div className="mt-7">
        <LoginForm />
      </div>
      <p className="mt-6 text-[13px] text-ink-500">
        Нет аккаунта?{' '}
        <Link
          href="/register"
          className="font-medium text-brand-600 hover:text-brand-700"
        >
          Зарегистрировать компанию
        </Link>
      </p>
    </div>
  );
}
