import Link from 'next/link';
import type { Metadata } from 'next';
import { FileText, Plus } from 'lucide-react';
import { prisma } from '@/lib/db';
import { requireSession } from '@/lib/auth/guard';
import { formatMinorKzt } from '@/lib/money';
import { PageHeader } from '@/components/layout/page-header';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import { PROCUREMENT_TYPE_LABELS, TENDER_STAGE_LABELS } from '@/lib/tender-labels';

export const metadata: Metadata = { title: 'Мои тендеры' };

export default async function TendersPage() {
  const session = await requireSession();
  const tenders = await prisma.tender.findMany({
    where: { companyId: session.companyId },
    orderBy: { updatedAt: 'desc' },
    include: {
      _count: {
        select: {
          documents: true,
          requirements: true,
          lineItems: true,
          financialModels: true,
        },
      },
    },
  });

  return (
    <>
      <PageHeader
        title="Мои тендеры"
        description="Карточки закупок, по которым вы ведёте анализ."
        actions={
          <ButtonLink href="/tenders/new">
            <Plus className="size-4" aria-hidden />
            Новый тендер
          </ButtonLink>
        }
      />

      <div className="flex-1 px-5 py-5 sm:px-7">
        {tenders.length === 0 ? (
          <EmptyState
            icon={<FileText className="size-8" aria-hidden />}
            title="Здесь появятся ваши тендеры"
            description="Создайте карточку закупки: укажите начальную цену и сроки, загрузите техническую спецификацию и проект договора."
            action={
              <ButtonLink href="/tenders/new">
                <Plus className="size-4" aria-hidden />
                Создать тендер
              </ButtonLink>
            }
          />
        ) : (
          <Card>
            <CardBody className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-[13px]">
                  <thead>
                    <tr className="border-b border-ink-100 text-left text-[12px] uppercase tracking-wide text-ink-400">
                      <th className="px-5 py-2.5 font-medium">Тендер</th>
                      <th className="px-5 py-2.5 font-medium">Процедура</th>
                      <th className="px-5 py-2.5 font-medium">Стадия</th>
                      <th className="px-5 py-2.5 text-right font-medium">
                        Начальная цена
                      </th>
                      <th className="px-5 py-2.5 text-center font-medium">Данные</th>
                      <th className="px-5 py-2.5 font-medium">Срок подачи</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tenders.map((tender) => (
                      <tr
                        key={tender.id}
                        className="border-b border-ink-50 last:border-0 hover:bg-ink-50/60"
                      >
                        <td className="px-5 py-3">
                          <Link
                            href={`/tenders/${tender.id}`}
                            className="font-medium text-ink-900 hover:text-brand-700"
                          >
                            {tender.title}
                          </Link>
                          <p className="mt-0.5 text-[12px] text-ink-400">
                            {tender.customerName ?? 'Заказчик не указан'}
                            {tender.externalNumber ? ` · № ${tender.externalNumber}` : ''}
                          </p>
                        </td>
                        <td className="px-5 py-3 text-ink-600">
                          {PROCUREMENT_TYPE_LABELS[tender.procurementType]}
                        </td>
                        <td className="px-5 py-3">
                          <Badge>{TENDER_STAGE_LABELS[tender.stage]}</Badge>
                        </td>
                        <td className="px-5 py-3 text-right tabular text-ink-700">
                          {tender.startPriceMinor === null
                            ? '—'
                            : formatMinorKzt(Number(tender.startPriceMinor))}
                        </td>
                        <td className="px-5 py-3 text-center text-[12px] text-ink-500">
                          <span title="Документов">{tender._count.documents} док.</span>
                          {' · '}
                          <span title="Позиций">{tender._count.lineItems} поз.</span>
                          {' · '}
                          <span title="Расчётов">
                            {tender._count.financialModels} расч.
                          </span>
                        </td>
                        <td className="px-5 py-3 text-ink-600">
                          {tender.submissionDeadline
                            ? new Intl.DateTimeFormat('ru-KZ', {
                                dateStyle: 'short',
                              }).format(tender.submissionDeadline)
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>
        )}
      </div>
    </>
  );
}
