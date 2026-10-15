import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { requireSession } from '@/lib/auth/guard';
import { canWrite } from '@/lib/auth/guard';
import { PageHeader } from '@/components/layout/page-header';
import { StatusNotice } from '@/components/ui/status-notice';
import { FinanceCalculator } from '@/components/finance/calculator';
import {
  buildInitialInput,
  parseSavedInput,
} from '@/lib/finance/from-db';
import { TAX_CONFIG_VERSION } from '@/lib/finance/tax-config';
import { getCompanyTaxRates } from '@/lib/finance/company-tax';
import { toRateDefinitions } from '@/lib/finance/from-db';
import { selectedPriceForFinance } from '@/lib/sourcing/to-finance';

export const metadata: Metadata = { title: 'Экономика тендера' };

export default async function TenderFinancePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;

  const [tender, company, rateRows] = await Promise.all([
    prisma.tender.findFirst({
      where: { id, companyId: session.companyId },
      include: {
        lineItems: {
          orderBy: { position: 'asc' },
          include: { selectedQuoteItem: { include: { quote: true } } },
        },
        financialModels: { orderBy: { updatedAt: 'desc' }, take: 1 },
      },
    }),
    prisma.company.findUnique({
      where: { id: session.companyId },
      select: { taxRegime: true, isVatPayer: true },
    }),
    getCompanyTaxRates(session.companyId),
  ]);

  if (!tender || !company) notFound();

  const rates = toRateDefinitions(rateRows);
  const savedModel = tender.financialModels[0];

  let initialInput;
  let restoreFailed = false;
  if (savedModel) {
    const { input, valid } = parseSavedInput(savedModel.inputs);
    initialInput = input;
    restoreFailed = !valid;
  }
  if (!initialInput) {
    initialInput = buildInitialInput({
      regime: company.taxRegime,
      isVatPayer: company.isVatPayer,
      startPriceMinor:
        tender.startPriceMinor === null ? null : Number(tender.startPriceMinor),
      rates,
      configVersion: rates.length > 0 ? TAX_CONFIG_VERSION : undefined,
      lineItems: tender.lineItems.map((item) => ({
        name: item.name,
        quantity: Number(item.quantity),
        ...selectedPriceForFinance(item.selectedQuoteItem),
        unit: item.unit,

      })),
    });
  }

  return (
    <>
      <PageHeader
        title="Экономика тендера"
        description={tender.title}
      />
      <div className="flex-1 space-y-4 px-5 py-5 sm:px-7">
        {restoreFailed ? (
          <StatusNotice severity="WARNING" title="Сохранённый расчёт не восстановлен">
            Структура сохранённых данных не соответствует текущей версии движка.
            Открыт новый расчёт — старый не удалён и остался в истории.
          </StatusNotice>
        ) : null}
        <FinanceCalculator
          tenderId={tender.id}
          initialInput={initialInput}
          initialModelId={savedModel?.id ?? null}
          initialName={savedModel?.name ?? 'Базовый расчёт'}
          canSave={canWrite(session.role)}
        />
      </div>
    </>
  );
}
