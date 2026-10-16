import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { canWrite } from '@/lib/auth/guard';
import { requirePageSession } from '@/lib/auth/page-guard';
import { toMajor } from '@/lib/money';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusNotice } from '@/components/ui/status-notice';
import { TenderEditForm } from './edit-form';

export const metadata: Metadata = { title: 'Изменение тендера' };

export default async function EditTenderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requirePageSession();
  const { id } = await params;

  if (!canWrite(session.role)) {
    return (
      <>
        <PageHeader
          title="Изменение тендера"
          description="Изменение данных доступно аналитику и выше."
        />
        <div className="flex-1 px-5 py-5 sm:px-7">
          <StatusNotice severity="INFO" title="Недостаточно прав">
            У роли «Наблюдатель» нет прав на изменение и удаление тендеров.
          </StatusNotice>
        </div>
      </>
    );
  }

  const tender = await prisma.tender.findFirst({
    where: { id, companyId: session.companyId },
  });
  if (!tender) notFound();

  return (
    <>
      <PageHeader title="Изменение тендера" description={tender.title} />
      <div className="flex-1 px-5 py-5 sm:px-7">
        <div className="max-w-3xl">
          <Card>
            <CardHeader>
              <CardTitle>Данные закупки</CardTitle>
            </CardHeader>
            <CardBody>
              <TenderEditForm
                tender={{
                  id: tender.id,
                  title: tender.title,
                  externalNumber: tender.externalNumber ?? '',
                  sourceUrl: tender.sourceUrl ?? '',
                  customerName: tender.customerName ?? '',
                  customerBin: tender.customerBin ?? '',
                  procurementType: tender.procurementType,
                  startPrice:
                    tender.startPriceMinor === null
                      ? ''
                      : String(toMajor(Number(tender.startPriceMinor))),
                  submissionDeadline:
                    tender.submissionDeadline?.toISOString().slice(0, 10) ?? '',
                  deliveryDeadline:
                    tender.deliveryDeadline?.toISOString().slice(0, 10) ?? '',
                  region: tender.region ?? '',
                  notes: tender.notes ?? '',
                }}
              />
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
