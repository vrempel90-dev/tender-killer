import Link from 'next/link';
import type { Metadata } from 'next';
import { Database, FileClock, Percent, Users } from 'lucide-react';
import { prisma } from '@/lib/db';
import { requireSession, ROLE_LABELS, type Role } from '@/lib/auth/guard';
import { isAiConfigured } from '@/lib/env';
import { maxUploadBytes } from '@/lib/documents/storage';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TAX_REGIME_LABELS } from '@/lib/finance/tax-config';
import { CompanySettingsForm } from './company-form';

export const metadata: Metadata = { title: 'Настройки' };

export default async function SettingsPage() {
  const session = await requireSession();

  const [company, users, unverifiedRates, auditCount] = await Promise.all([
    prisma.company.findUnique({ where: { id: session.companyId } }),
    prisma.user.findMany({
      where: { companyId: session.companyId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
      },
    }),
    prisma.taxRateConfig.count({ where: { notes: { contains: 'ТРЕБУЕТ СВЕРКИ' } } }),
    prisma.auditLog.count({ where: { companyId: session.companyId } }),
  ]);

  if (!company) throw new Error('Компания не найдена');

  return (
    <>
      <PageHeader
        title="Настройки"
        description="Параметры компании, налоговые ставки, пользователи и журнал операций."
      />
      <div className="flex-1 space-y-5 px-5 py-5 sm:px-7">
        <div className="grid gap-5 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Компания и налоговый режим</CardTitle>
              <CardDescription>
                Режим определяет, выделяется ли НДС из вашей цены и считается ли
                налог на доход с прибыли или с оборота. Изменение режима влияет на
                все новые расчёты.
              </CardDescription>
            </CardHeader>
            <CardBody>
              <CompanySettingsForm
                company={{
                  name: company.name,
                  bin: company.bin,
                  taxRegime: company.taxRegime,
                  isVatPayer: company.isVatPayer,
                  isSmallBusiness: company.isSmallBusiness,
                }}
                canEdit={session.role === 'OWNER' || session.role === 'ADMIN'}
              />
            </CardBody>
          </Card>

          <div className="space-y-5">
            <Card>
              <CardHeader
                action={
                  <Link
                    href="/settings/taxes"
                    className="text-[13px] font-medium text-brand-600 hover:text-brand-700"
                  >
                    Открыть
                  </Link>
                }
              >
                <CardTitle>
                  <span className="flex items-center gap-2">
                    <Percent className="size-4 text-ink-400" aria-hidden />
                    Налоговые ставки
                  </span>
                </CardTitle>
                <CardDescription>
                  Ставки с указанием источника и даты начала действия.
                </CardDescription>
              </CardHeader>
              <CardBody>
                {unverifiedRates > 0 ? (
                  <Badge tone="caution">
                    {unverifiedRates} ставок требуют сверки с первоисточником
                  </Badge>
                ) : (
                  <Badge tone="positive">Все ставки сверены</Badge>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>
                  <span className="flex items-center gap-2">
                    <Database className="size-4 text-ink-400" aria-hidden />
                    Состояние системы
                  </span>
                </CardTitle>
              </CardHeader>
              <CardBody className="space-y-2 text-[13px]">
                <Row label="AI-модули">
                  {isAiConfigured() ? (
                    <Badge tone="positive">Ключ настроен</Badge>
                  ) : (
                    <Badge tone="caution">ANTHROPIC_API_KEY не задан</Badge>
                  )}
                </Row>
                <Row label="Лимит загрузки файла">
                  {Math.round(maxUploadBytes() / 1_048_576)} МБ
                </Row>
                <Row label="Поддерживаемые форматы">PDF, DOCX, XLSX</Row>
                <Row label="Распознавание сканов">
                  <Badge tone="neutral">не поддерживается</Badge>
                </Row>
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                action={
                  <Link
                    href="/settings/audit"
                    className="text-[13px] font-medium text-brand-600 hover:text-brand-700"
                  >
                    Открыть
                  </Link>
                }
              >
                <CardTitle>
                  <span className="flex items-center gap-2">
                    <FileClock className="size-4 text-ink-400" aria-hidden />
                    Журнал операций
                  </span>
                </CardTitle>
                <CardDescription>
                  Записей: {auditCount}. Фиксируются входы, изменения данных,
                  загрузка и удаление документов, запуски AI-анализа.
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>
              <span className="flex items-center gap-2">
                <Users className="size-4 text-ink-400" aria-hidden />
                Пользователи компании
              </span>
            </CardTitle>
            <CardDescription>
              Данные компаний изолированы: пользователь видит только тендеры и
              документы своей компании.
            </CardDescription>
          </CardHeader>
          <CardBody className="p-0">
            <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-[13px]">
              <thead>
                <tr className="border-b border-ink-100 text-left text-[12px] uppercase tracking-wide text-ink-400">
                  <th className="px-5 py-2.5 font-medium">Пользователь</th>
                  <th className="px-5 py-2.5 font-medium">Роль</th>
                  <th className="px-5 py-2.5 font-medium">Последний вход</th>
                  <th className="px-5 py-2.5 font-medium">Статус</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="border-b border-ink-50 last:border-0">
                    <td className="px-5 py-3">
                      <p className="font-medium text-ink-900">{user.name}</p>
                      <p className="text-[12px] text-ink-400">{user.email}</p>
                    </td>
                    <td className="px-5 py-3 text-ink-600">
                      {ROLE_LABELS[user.role as Role] ?? user.role}
                    </td>
                    <td className="px-5 py-3 text-ink-600">
                      {user.lastLoginAt
                        ? new Intl.DateTimeFormat('ru-KZ', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          }).format(user.lastLoginAt)
                        : 'ни разу'}
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={user.isActive ? 'positive' : 'neutral'}>
                        {user.isActive ? 'активен' : 'отключён'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            <p className="border-t border-ink-100 px-5 py-3 text-[12.5px] text-ink-500">
              Приглашение новых пользователей будет добавлено отдельно. Сейчас
              учётную запись создаёт владелец при регистрации компании. Роли{' '}
              {Object.values(ROLE_LABELS).join(', ')} уже действуют: проверка прав
              выполняется на сервере.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Текущий режим налогообложения</CardTitle>
          </CardHeader>
          <CardBody className="space-y-1.5 text-[13px] text-ink-600">
            <p>
              <strong className="font-medium text-ink-800">
                {TAX_REGIME_LABELS[company.taxRegime]}
              </strong>
            </p>
            <p>
              {company.isVatPayer
                ? 'Вы плательщик НДС: НДС выделяется из цены, входящий НДС '
                  + 'принимается в зачёт.'
                : 'Вы не плательщик НДС: НДС из вашей цены не выделяется, '
                  + 'входящий НДС поставщиков становится вашим расходом.'}
            </p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-ink-50 pb-2 last:border-0 last:pb-0">
      <span className="text-ink-500">{label}</span>
      <span className="text-right text-ink-800">{children}</span>
    </div>
  );
}
