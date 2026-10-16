import { prisma } from '@/lib/db';
import { requirePageSession } from '@/lib/auth/page-guard';
import { ROLE_LABELS, type Role } from '@/lib/auth/guard';
import { isAiConfigured } from '@/lib/env';
import { Sidebar } from '@/components/layout/sidebar';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Один вход для всей защищённой зоны: нет сессии — на вход, не пройден
  // второй фактор — на /mfa.
  const session = await requirePageSession();

  const company = await prisma.company.findUnique({
    where: { id: session.companyId },
    select: { name: true },
  });

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <Sidebar
        companyName={company?.name ?? 'Компания'}
        userName={session.name}
        roleLabel={ROLE_LABELS[session.role as Role] ?? session.role}
        aiConfigured={isAiConfigured()}
      />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
