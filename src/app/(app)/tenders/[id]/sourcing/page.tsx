import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { canWrite } from '@/lib/auth/guard';
import { requirePageSession } from '@/lib/auth/page-guard';
import { isAiConfigured } from '@/lib/env';
import { PageHeader } from '@/components/layout/page-header';
import {
  SourcingPanel,
  type LineItemView,
  type QuoteView,
} from '@/components/sourcing/sourcing-panel';
import { evaluateQuote, type QuoteOption } from '@/lib/sourcing/compare';
import { selectedPriceForFinance } from '@/lib/sourcing/to-finance';
import type { PickableDocument } from '@/components/compliance/document-picker';

export const metadata: Metadata = { title: 'AI-Снабженец' };

/** Логистика здесь не распределяется: она вводится в финансовом модуле. */
const NO_LOGISTICS = { perUnitMinor: 0, flatMinor: 0, customsPercent: 0 };

export default async function SourcingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requirePageSession();
  const { id } = await params;

  const tender = await prisma.tender.findFirst({
    where: { id, companyId: session.companyId },
    include: {
      lineItems: {
        orderBy: { position: 'asc' },
        include: { selectedQuoteItem: { include: { quote: true } } },
      },
      supplierQuotes: {
        orderBy: { createdAt: 'desc' },
        include: { items: true, document: { select: { originalName: true } } },
      },
      documents: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        include: {
          extraction: {
            select: { status: true, charCount: true, unreadablePages: true },
          },
        },
      },
    },
  });

  if (!tender) notFound();

  const now = new Date();

  const quotes: QuoteView[] = tender.supplierQuotes.map((quote) => ({
    id: quote.id,
    supplierName: quote.supplierName,
    supplierBin: quote.supplierBin,
    verification: quote.verification,
    currency: quote.currency,
    fxRate: quote.fxRate === null ? null : Number(quote.fxRate),
    pricesIncludeVat: quote.pricesIncludeVat,
    validUntil: quote.validUntil?.toISOString() ?? null,
    deliveryDays: quote.deliveryDays,
    documentName: quote.document?.originalName ?? null,
    items: quote.items.map((item) => {
      const option: QuoteOption = {
        quoteItemId: item.id,
        quoteId: quote.id,
        supplierName: quote.supplierName,
        verified: quote.verification === 'VERIFIED',
        unitPriceMinor: Number(item.unitPriceMinor),
        currency: quote.currency,
        fxRate: quote.fxRate === null ? null : Number(quote.fxRate),
        pricesIncludeVat: quote.pricesIncludeVat,
        quantity: Number(item.quantity),
        specMatch: item.specMatch as QuoteOption['specMatch'],
        specMatchNote: item.specMatchNote,
        leadTimeDays: item.leadTimeDays,
        validUntil: quote.validUntil,
      };
      const evaluation = evaluateQuote(option, NO_LOGISTICS, now);
      return {
        id: item.id,
        name: item.name,
        unit: item.unit,
        quantity: Number(item.quantity),
        unitPriceMinor: Number(item.unitPriceMinor),
        unitPriceKztMinor: evaluation.unitPriceKztMinor,
        landedUnitCostMinor: evaluation.landedUnitCostMinor,
        specMatch: item.specMatch,
        specMatchNote: item.specMatchNote,
        leadTimeDays: item.leadTimeDays,
        lineItemId: item.lineItemId,
        issues: evaluation.issues,
        isSelectedForLineItem: tender.lineItems.some(
          (li) => li.selectedQuoteItemId === item.id,
        ),
      };
    }),
  }));

  const lineItems: LineItemView[] = tender.lineItems.map((item) => {
    const selected = item.selectedQuoteItem;
    const selectedUnitCostMinor = selectedPriceForFinance(selected, now).unitCostMinor;
    return {
      id: item.id,
      position: item.position,
      name: item.name,
      specification: item.specification,
      unit: item.unit,
      quantity: Number(item.quantity),
      confirmedByUser: item.confirmedByUser,
      origin: item.origin,
      pageNumber: item.pageNumber,
      selectedQuoteItemId: item.selectedQuoteItemId,
      selectedUnitCostMinor,
      selectedSupplierName: selected?.quote.supplierName ?? null,
      optionsCount: quotes.reduce(
        (sum, q) => sum + q.items.filter((qi) => qi.lineItemId === item.id).length,
        0,
      ),
    };
  });

  const specDocuments: PickableDocument[] = tender.documents
    .filter((d) => ['TECHNICAL_SPEC', 'TENDER_NOTICE', 'OTHER'].includes(d.kind))
    .map((d) => ({
      id: d.id,
      originalName: d.originalName,
      kind: d.kind,
      extractionStatus: d.extraction?.status ?? null,
      charCount: d.extraction?.charCount ?? null,
      unreadablePagesCount: d.extraction?.unreadablePages.length ?? 0,
    }));

  const quoteDocuments = tender.documents
    .filter((d) => ['SUPPLIER_QUOTE', 'PRICE_LIST', 'OTHER'].includes(d.kind))
    .map((d) => ({ id: d.id, originalName: d.originalName }));

  return (
    <>
      <PageHeader
        title="AI-Снабженец"
        description={`${tender.title} · шаг 4 из 7`}
      />
      <div className="flex-1 px-5 py-5 sm:px-7">
        <SourcingPanel
          tenderId={tender.id}
          lineItems={lineItems}
          quotes={quotes}
          specDocuments={specDocuments}
          quoteDocuments={quoteDocuments}
          aiConfigured={isAiConfigured()}
          canEdit={canWrite(session.role)}
          financeHref={`/tenders/${tender.id}/finance`}
        />
      </div>
    </>
  );
}
