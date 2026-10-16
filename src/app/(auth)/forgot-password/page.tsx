import type { Metadata } from 'next';
import { ForgotPasswordForm } from './password-form';

export const metadata: Metadata = { title: 'Восстановление пароля', robots: { index: false, follow: false } };
export default function ForgotPasswordPage() {
  return <div>
    <h1 className="text-2xl font-semibold text-ink-900">Восстановление пароля</h1>
    <p className="mt-2 text-[13px] leading-relaxed text-ink-500">Введите электронную почту, указанную при регистрации. Мы отправим вам ссылку для создания нового пароля</p>
    <div className="mt-7"><ForgotPasswordForm /></div>
  </div>;
}
