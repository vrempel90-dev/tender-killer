import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { canManageUsers } from '@/lib/auth/guard';
import { requirePageSession } from '@/lib/auth/page-guard';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusNotice } from '@/components/ui/status-notice';

export const metadata: Metadata = { title: 'Журнал операций' };

const ACTION_LABELS: Record<string, string> = {
  USER_REGISTER: 'Регистрация компании',
  USER_LOGIN: 'Вход в систему',
  USER_LOGIN_FAILED: 'Неудачная попытка входа',
  USER_LOGOUT: 'Выход',
  TENDER_CREATE: 'Создание тендера',
  TENDER_UPDATE: 'Изменение тендера',
  TENDER_DELETE: 'Удаление тендера',
  DOCUMENT_UPLOAD: 'Загрузка документа',
  DOCUMENT_DELETE: 'Удаление документа',
  DOCUMENT_EXTRACT: 'Извлечение содержимого',
  FINANCE_SAVE: 'Сохранение финансового расчёта',
  AI_REQUIREMENTS_RUN: 'AI: извлечение требований',
  AI_COMPLIANCE_RUN: 'AI: проверка документов',
  AI_CONTRACT_RUN: 'AI: анализ договора',
  QUOTE_IMPORT: 'Импорт коммерческого предложения',
  QUOTE_DELETE: 'Удаление предложения',
  HISTORY_IMPORT: 'Импорт закупок',
  REPORT_GENERATE: 'Формирование отчёта',
  TAX_CONFIG_UPDATE: 'Изменение настроек и ставок',
};

export default async function AuditPage() {
  const session = await requirePageSession();

  // Журнал доступен администраторам и владельцу. Остальным показываем
  // понятное сообщение, а не ошибку.
  if (!canManageUsers(session.role)) {
    return (
      <>
        <PageHeader
          title="Журнал операций"
          description="Раздел доступен администратору и владельцу компании."
        />
        <div className="flex-1 px-5 py-5 sm:px-7">
          <StatusNotice severity="INFO" title="Недостаточно прав">
            Журнал операций содержит сведения о действиях всех пользователей
            компании, поэтому доступен только администратору и владельцу.
            Обратитесь к администратору вашей компании, если вам нужен доступ.
          </StatusNotice>
        </div>
      </>
    );
  }

  const logs = await prisma.auditLog.findMany({
    where: { companyId: session.companyId },
    orderBy: { createdAt: 'desc' },
    take: 300,
    include: { user: { select: { name: true, email: true } } },
  });

  return (
    <>
      <PageHeader
        title="Журнал операций"
        description="Последние 300 записей. Фиксируются действия, изменяющие данные, а также запуски AI-анализа."
      />
      <div className="flex-1 px-5 py-5 sm:px-7">
        <Card>
          <CardHeader>
            <CardTitle>События</CardTitle>
            <CardDescription>
              Журнал относится только к вашей компании: данные разных компаний
              изолированы.
            </CardDescription>
          </CardHeader>
          <CardBody className="p-0">
            {logs.length === 0 ? (
              <p className="px-5 py-8 text-center text-[13px] text-ink-400">
                Записей пока нет.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[840px] text-[13px]">
                  <thead>
                    <tr className="border-b border-ink-100 text-left text-[12px] uppercase tracking-wide text-ink-400">
                      <th className="px-5 py-2.5 font-medium">Время</th>
                      <th className="px-5 py-2.5 font-medium">Событие</th>
                      <th className="px-5 py-2.5 font-medium">Пользователь</th>
                      <th className="px-5 py-2.5 font-medium">Объект</th>
                      <th className="px-5 py-2.5 font-medium">Детали</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => (
                      <tr
                        key={log.id}
                        className="border-b border-ink-50 align-top last:border-0"
                      >
                        <td className="whitespace-nowrap px-5 py-2.5 text-ink-600">
                          {new Intl.DateTimeFormat('ru-KZ', {
                            dateStyle: 'short',
                            timeStyle: 'medium',
                          }).format(log.createdAt)}
                        </td>
                        <td className="px-5 py-2.5">
                          <Badge
                            tone={
                              log.action === 'USER_LOGIN_FAILED'
                                ? 'negative'
                                : log.action.startsWith('AI_')
                                  ? 'brand'
                                  : log.action.includes('DELETE')
                                    ? 'caution'
                                    : 'neutral'
                            }
                          >
                            {ACTION_LABELS[log.action] ?? log.action}
                          </Badge>
                        </td>
                        <td className="px-5 py-2.5 text-ink-600">
                          {log.user?.name ?? '—'}
                        </td>
                        <td className="px-5 py-2.5 font-mono text-[11.5px] text-ink-400">
                          {log.entity ?? '—'}
                          {log.entityId ? ` ${log.entityId.slice(0, 8)}…` : ''}
                        </td>
                        <td className="px-5 py-2.5">
                          <pre className="max-w-sm overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-ink-500">
                            {log.metadata && Object.keys(log.metadata).length > 0
                              ? JSON.stringify(log.metadata, null, 1)
                              : '—'}
                          </pre>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
