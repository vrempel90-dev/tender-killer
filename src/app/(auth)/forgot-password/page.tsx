import type { Metadata } from 'next';
import { ForgotPasswordForm } from './password-form';
import { resetMailConfig } from '@/lib/email/transport';

export const metadata: Metadata = { title: 'Восстановление пароля', robots: { index: false, follow: false } };
export default function ForgotPasswordPage() {
  let available = false;
  try { resetMailConfig(); available = true; } catch { /* Same state for every visitor. */ }
  return <div>
    <h1 className="text-2xl font-semibold text-ink-900">Восстановление пароля</h1>
    <p className="mt-2 text-[13px] leading-relaxed text-ink-500">{available
      ? 'Введите электронную почту, указанную при регистрации. Если аккаунт существует, запрос на восстановление будет обработан.'
      : 'Восстановление пароля временно недоступно: почтовый отправитель не настроен или не подтверждён. Обратитесь к администратору.'}</p>
    <div className="mt-7"><ForgotPasswordForm /></div>
  </div>;
}
