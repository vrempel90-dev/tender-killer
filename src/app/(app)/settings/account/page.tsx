import type { Metadata } from 'next';
import { requirePageSession } from '@/lib/auth/page-guard';
import { PageHeader } from '@/components/layout/page-header';
import { AccountActions } from './account-actions';

export const metadata: Metadata = { title: 'Мой аккаунт' };
export default async function AccountPage() {
  const session = await requirePageSession();
  return <>
    <PageHeader title="Мой аккаунт" description={`${session.name} · ${session.email}`} />
    <div className="flex-1 px-5 py-5 sm:px-7"><AccountActions /></div>
  </>;
}
