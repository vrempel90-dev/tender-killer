import { redirect } from 'next/navigation';
import { getCurrentSession } from '@/lib/auth/session';
import { sessionMfaGate } from '@/lib/auth/guard';
import { getMfaStatus } from '@/lib/auth/mfa/service';
import { MfaFlow } from './mfa-flow';

export const metadata = { title: 'Второй фактор — TENDER KILLER' };

export default async function MfaPage() {
  const session = await getCurrentSession();
  if (!session) redirect('/login');

  const gate = sessionMfaGate(session);
  // Страница нужна только пока фактор не пройден: иначе это лишний шаг.
  if (gate === 'OK') redirect('/dashboard');

  const status = await getMfaStatus(session.userId);

  return (
    <MfaFlow
      gate={gate}
      email={session.email}
      required={status.required}
      pendingConfirmation={status.pendingConfirmation}
    />
  );
}
