import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import {
  ArrowRight,
  Banknote,
  BadgeCheck,
  FileSearch,
  FileText,
  PackageSearch,
  TrendingUp,
  Upload,
} from 'lucide-react';
import { prisma } from '@/lib/db';
import { requireSession } from '@/lib/auth/guard';
import { isAiConfigured } from '@/lib/env';
import { formatMinorKzt } from '@/lib/money';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { PROCUREMENT_TYPE_LABELS } from '@/lib/tender-labels';
import { StageSelector } from './stage-selector';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const session = await requireSession();
  const { id } = await params;
  const tender = await prisma.tender.findFirst({
    where: { id, companyId: session.companyId },
    select: { title: true },
  });
  return { title: tender?.title ?? 'Тендер' };
}

export default async function TenderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;

  const tender = await prisma.tender.findFirst({
    where: { id, companyId: session.companyId },
    include: {
      documents: {
        where: { deletedAt: null },
        include: { extraction: { select: { status: true, pageCount: true } } },
        orderBy: { createdAt: 'desc' },
      },
      requirements: { select: { id: true, confirmedByUser: true } },
      lineItems: { select: { id: true, selectedQuoteItemId: true } },
      financialModels: {
        orderBy: { updatedAt: 'desc' },
        take: 1,
        select: { id: true, name: true, result: true, updatedAt: true },
      },
      complianceRuns: {
        orderBy: { startedAt: 'desc' },
        take: 1,
        select: { id: true, startedAt: true, status: true },
      },
      contractAnalyses: {
        orderBy: { startedAt: 'desc' },
        take: 1,
        select: { id: true, startedAt: true, status: true },
      },
      supplierQuotes: { select: { id: true } },
    },
  });

  if (!tender) notFound();

  const savedResult = tender.financialModels[0]?.result as
    | { profit?: { netMinor?: number } }
    | undefined;
  const netProfitMinor = savedResult?.profit?.netMinor ?? null;

  const steps = [
    {
      number: 1,
      title: 'Карточка создана',
      done: true,
      href: `/tenders/${tender.id}/edit`,
      hint: 'Данные закупки',
      icon: FileText,
    },
    {
      number: 2,
      title: 'Документы загружены',
      done: tender.documents.length > 0,
      href: `/tenders/${tender.id}/documents`,
      hint: `${tender.documents.length} документов`,
      icon: Upload,
    },
    {
      number: 3,
      title: 'Требования и позиции извлечены',
      done: tender.requirements.length > 0 || tender.lineItems.length > 0,
      href: `/tenders/${tender.id}/requirements`,
      hint: `${tender.requirements.length} требований, ${tender.lineItems.length} позиций`,
      icon: BadgeCheck,
      blocked: !isAiConfigured(),
    },
    {
      number: 4,
      title: 'Цены поставщиков добавлены',
      done: tender.supplierQuotes.length > 0,
      href: `/tenders/${tender.id}/sourcing`,
      hint: `${tender.supplierQuotes.length} предложений`,
      icon: PackageSearch,
    },
    {
      number: 5,
      title: 'Экономика рассчитана',
      done: tender.financialModels.length > 0,
      href: `/tenders/${tender.id}/finance`,
      hint:
        netProfitMinor === null
          ? 'Расчёта нет'
          : `Прибыль ${formatMinorKzt(netProfitMinor)}`,
      icon: Banknote,
    },
    {
      number: 6,
      title: 'Документы заявки проверены',
      done: tender.complianceRuns.length > 0,
      href: `/tenders/${tender.id}/compliance`,
      hint:
        tender.complianceRuns.length > 0
          ? 'Проверка выполнена'
          : 'Проверки не было',
      icon: BadgeCheck,
      blocked: !isAiConfigured(),
    },
    {
      number: 7,
      title: 'Риски договора оценены',
      done: tender.contractAnalyses.length > 0,
      href: `/tenders/${tender.id}/contract`,
      hint:
        tender.contractAnalyses.length > 0 ? 'Анализ выполнен' : 'Анализа не было',
      icon: FileSearch,
      blocked: !isAiConfigured(),
    },
  ];

  const completed = steps.filter((s) => s.done).length;

  return (
    <>
      <PageHeader
        title={tender.title}
        description={[
          tender.customerName,
          tender.externalNumber ? `№ ${tender.externalNumber}` : null,
          PROCUREMENT_TYPE_LABELS[tender.procurementType],
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <>
            <ButtonLink
              href={`/tenders/${tender.id}/finance`}
              variant="outline"
            >
              <Banknote className="size-4" aria-hidden />
              Экономика
            </ButtonLink>
            <ButtonLink
              href={`/tenders/${tender.id}/pricing`}
              variant="outline"
            >
              <TrendingUp className="size-4" aria-hidden />
              Ценовая стратегия
            </ButtonLink>
            <ButtonLink href={`/tenders/${tender.id}/report`}>
              Отчёт по тендеру
            </ButtonLink>
          </>
        }
      />

      <div className="flex-1 space-y-5 px-5 py-5 sm:px-7">
        <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Рабочий процесс: шаг {completed} из {steps.length}</CardTitle>
              <CardDescription>
                Каждый шаг добавляет данные в расчёт. Шаги, помеченные как
                недоступные, требуют настройки AI-ключа.
              </CardDescription>
            </CardHeader>
            <CardBody className="space-y-2">
              {steps.map((step) => {
                const Icon = step.icon;
                return (
                  <Link
                    key={step.number}
                    href={step.href}
                    className="flex items-center gap-3 rounded-lg border border-ink-100 px-3.5 py-3 transition-colors hover:border-ink-300 hover:bg-ink-50/60"
                  >
                    <span
                      className={
                        step.done
                          ? 'flex size-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[12px] font-semibold text-emerald-700'
                          : 'flex size-7 shrink-0 items-center justify-center rounded-full bg-ink-100 text-[12px] font-semibold text-ink-500'
                      }
                    >
                      {step.number}
                    </span>
                    <Icon className="size-4 shrink-0 text-ink-400" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] font-medium text-ink-900">
                        {step.title}
                      </p>
                      <p className="text-[12px] text-ink-400">{step.hint}</p>
                    </div>
                    {step.blocked ? (
                      <Badge tone="caution">нужен ключ AI</Badge>
                    ) : step.done ? (
                      <Badge tone="positive">готово</Badge>
                    ) : (
                      <ArrowRight className="size-4 shrink-0 text-ink-300" aria-hidden />
                    )}
                  </Link>
                );
              })}
            </CardBody>
          </Card>

          <div className="space-y-5">
            <Card>
              <CardHeader>
                <CardTitle>Параметры закупки</CardTitle>
              </CardHeader>
              <CardBody className="space-y-2.5 text-[13px]">
                <Row label="Стадия">
                  <StageSelector
                    tenderId={tender.id}
                    stage={tender.stage}
                    canEdit={session.role !== 'VIEWER'}
                  />
                </Row>
                <Row label="Начальная цена">
                  <span className="tabular font-medium text-ink-900">
                    {tender.startPriceMinor === null
                      ? 'не указана'
                      : formatMinorKzt(Number(tender.startPriceMinor))}
                  </span>
                </Row>
                <Row label="Срок подачи">
                  {tender.submissionDeadline
                    ? new Intl.DateTimeFormat('ru-KZ', { dateStyle: 'long' }).format(
                        tender.submissionDeadline,
                      )
                    : 'не указан'}
                </Row>
                <Row label="Срок исполнения">
                  {tender.deliveryDeadline
                    ? new Intl.DateTimeFormat('ru-KZ', { dateStyle: 'long' }).format(
                        tender.deliveryDeadline,
                      )
                    : 'не указан'}
                </Row>
                <Row label="Регион">{tender.region ?? 'не указан'}</Row>
                <Row label="БИН заказчика">{tender.customerBin ?? 'не указан'}</Row>
                {tender.sourceUrl ? (
                  <Row label="Объявление">
                    <a
                      href={tender.sourceUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="font-medium text-brand-600 hover:text-brand-700"
                    >
                      Открыть источник
                    </a>
                  </Row>
                ) : null}
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Документы</CardTitle>
              </CardHeader>
              <CardBody className="space-y-2">
                {tender.documents.length === 0 ? (
                  <p className="text-[13px] text-ink-400">
                    Документы не загружены.
                  </p>
                ) : (
                  tender.documents.slice(0, 6).map((doc) => (
                    <div
                      key={doc.id}
                      className="flex items-center justify-between gap-2 text-[13px]"
                    >
                      <span className="min-w-0 truncate text-ink-700">
                        {doc.originalName}
                      </span>
                      <Badge
                        tone={
                          doc.extraction?.status === 'SUCCEEDED'
                            ? 'positive'
                            : doc.extraction?.status === 'FAILED'
                              ? 'negative'
                              : 'neutral'
                        }
                      >
                        {doc.extraction?.status === 'SUCCEEDED'
                          ? `${doc.extraction.pageCount ?? '?'} стр.`
                          : (doc.extraction?.status ?? 'не обработан')}
                      </Badge>
                    </div>
                  ))
                )}
                <Link
                  href={`/tenders/${tender.id}/documents`}
                  className="mt-1 inline-block text-[13px] font-medium text-brand-600 hover:text-brand-700"
                >
                  Управление документами
                </Link>
              </CardBody>
            </Card>

            {tender.notes ? (
              <Card>
                <CardHeader>
                  <CardTitle>Примечания</CardTitle>
                </CardHeader>
                <CardBody>
                  <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink-600">
                    {tender.notes}
                  </p>
                </CardBody>
              </Card>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-ink-50 pb-2 last:border-0 last:pb-0">
      <span className="text-ink-500">{label}</span>
      <span className="text-right text-ink-800">{children}</span>
    </div>
  );
}
