import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { requirePageSession } from '@/lib/auth/page-guard';
import { getMfaStatus } from '@/lib/auth/mfa/service';
import { ROLE_LABELS, type Role } from '@/lib/auth/guard';
import { isMfaRequiredForRole } from '@/lib/auth/mfa/policy';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardBody,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { MfaSettings } from './mfa-settings';

export const metadata: Metadata = { title: 'Безопасность' };

export default async function SecuritySettingsPage() {
  const session = await requirePageSession();

  const [status, company, users, sessions] = await Promise.all([
    getMfaStatus(session.userId),
    prisma.company.findUnique({
      where: { id: session.companyId },
      select: { requireMfaForAdmins: true },
    }),
    prisma.user.findMany({
      where: { companyId: session.companyId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        totpConfirmedAt: true,
      },
    }),
    prisma.session.findMany({
      where: {
        userId: session.userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        userAgent: true,
        ipAddress: true,
        mfaVerifiedAt: true,
      },
    }),
  ]);

  const requireForAdmins = false;
  void company;
  const dateTime = new Intl.DateTimeFormat('ru-KZ', {
    dateStyle: 'short',
    timeStyle: 'short',
  });

  return (
    <>
      <PageHeader
        title="Безопасность"
        description="Добровольный второй фактор, коды восстановления и активные сессии."
      />
      <div className="flex-1 space-y-5 px-5 py-5 sm:px-7">
        <div className="grid gap-5 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Второй фактор (TOTP)</CardTitle>
              <CardDescription>
                Одноразовые коды из приложения-аутентификатора. Реализация по
                RFC 6238; код действует 30 секунд, повторное предъявление того же
                кода отклоняется.
              </CardDescription>
            </CardHeader>
            <CardBody>
              <MfaSettings
                enabled={status.enabled}
                required={status.required}
                pendingConfirmation={status.pendingConfirmation}
                recoveryCodesLeft={status.recoveryCodesLeft}
                confirmedAt={status.confirmedAt ? dateTime.format(status.confirmedAt) : null}
              />
            </CardBody>
          </Card>

          <div className="space-y-5">
            <Card>
              <CardHeader>
                <CardTitle>Политика компании</CardTitle>
                <CardDescription>
                  Вход по e-mail и паролю одинаков для всех ролей. Второй фактор можно включить добровольно в своём аккаунте.
                </CardDescription>
              </CardHeader>
              <CardBody className="space-y-3 text-[13px]">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-ink-500">Обязателен для администраторов</span>
                  {requireForAdmins ? (
                    <Badge tone="positive">включено</Badge>
                  ) : (
                    <Badge tone="caution">выключено</Badge>
                  )}
                </div>
                <p className="leading-relaxed text-ink-400">
                  {requireForAdmins
                    ? 'Пользователь с правами администратора не получает доступ к данным, пока не подключит второй фактор.'
                    : 'Обязательная настройка отключена. Если вы добровольно включите TOTP, при следующем входе потребуется его код.'}
                </p>
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Ваши активные сессии</CardTitle>
                <CardDescription>
                  Управление сессиями и удаление своего аккаунта доступны в разделе «Мой аккаунт».
                </CardDescription>
              </CardHeader>
              <CardBody className="space-y-2.5 text-[13px]">
                {sessions.map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-wrap items-start justify-between gap-2 border-b border-ink-50 pb-2.5 last:border-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-ink-900">
                        {item.userAgent ?? 'Неизвестное устройство'}
                      </p>
                      <p className="text-[12px] text-ink-400">
                        {dateTime.format(item.createdAt)}
                        {item.ipAddress ? ` · ${item.ipAddress}` : ''}
                        {item.id === session.sid ? ' · текущая' : ''}
                      </p>
                    </div>
                    {item.mfaVerifiedAt ? (
                      <Badge tone="positive">фактор пройден</Badge>
                    ) : (
                      <Badge tone="neutral">без фактора</Badge>
                    )}
                  </div>
                ))}
              </CardBody>
            </Card>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Второй фактор у пользователей компании</CardTitle>
            <CardDescription>
              Кто защищён, а кто нет. Подключить фактор за другого пользователя
              нельзя: секрет создаётся только в его сессии.
            </CardDescription>
          </CardHeader>
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-[13px]">
                <thead>
                  <tr className="border-b border-ink-100 text-left text-[12px] uppercase tracking-wide text-ink-400">
                    <th className="px-5 py-2.5 font-medium">Пользователь</th>
                    <th className="px-5 py-2.5 font-medium">Роль</th>
                    <th className="px-5 py-2.5 font-medium">Второй фактор</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => {
                    const mandatory = isMfaRequiredForRole(user.role, requireForAdmins);
                    return (
                      <tr key={user.id} className="border-b border-ink-50 last:border-0">
                        <td className="px-5 py-3">
                          <p className="font-medium text-ink-900">{user.name}</p>
                          <p className="text-[12px] text-ink-400">{user.email}</p>
                        </td>
                        <td className="px-5 py-3 text-ink-600">
                          {ROLE_LABELS[user.role as Role] ?? user.role}
                        </td>
                        <td className="px-5 py-3">
                          {user.totpConfirmedAt ? (
                            <Badge tone="positive">
                              подключён {dateTime.format(user.totpConfirmedAt)}
                            </Badge>
                          ) : mandatory ? (
                            <Badge tone="caution">обязателен, не подключён</Badge>
                          ) : (
                            <Badge tone="neutral">не подключён</Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
