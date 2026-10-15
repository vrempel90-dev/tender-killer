import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getCurrentSession } from '@/lib/auth/session';
import { RegisterForm } from './register-form';

export const metadata: Metadata = { title: 'Регистрация компании' };

export default async function RegisterPage() {
  const session = await getCurrentSession();
  if (session) redirect('/dashboard');

  return (
    <div>
      <p className="text-[13px] font-semibold tracking-[0.2em] text-brand-600 lg:hidden">
        TENDER KILLER
      </p>
      <h1 className="mt-4 text-2xl font-semibold text-ink-900 lg:mt-0">
        Регистрация компании
      </h1>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-500">
        Налоговый режим определяет расчёт НДС и налога на доход. Его можно
        изменить позже в настройках.
      </p>
      <div className="mt-7">
        <RegisterForm />
      </div>
      <p className="mt-6 text-[13px] text-ink-500">
        Уже есть аккаунт?{' '}
        <Link href="/login" className="font-medium text-brand-600 hover:text-brand-700">
          Войти
        </Link>
      </p>
    </div>
  );
}
