import type { Metadata } from 'next';
import { ResetPasswordForm } from './password-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Создание нового пароля', referrer: 'no-referrer', robots: { index: false, follow: false } };
export default function ResetPasswordPage() {
  return <div>
    <h1 className="text-2xl font-semibold text-ink-900">Создание нового пароля</h1>
    <div className="mt-7"><ResetPasswordForm /></div>
  </div>;
}
