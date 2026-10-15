/**
 * Генерация PDF-отчёта по тендеру.
 *
 * Документ строится из данных отчёта без каких-либо дополнений: если блок
 * не заполнен, в PDF он помечается как отсутствующий.
 */

import PDFDocument from 'pdfkit';
import { formatMinorKzt, formatRatioAsPercent } from '../money';
import { findPdfFonts, PDF_FONT_HELP } from './fonts';
import {
  buildDecisionSummary,
  DECISION_DISCLAIMER,
  VERDICT_LABELS,
  type DecisionReportData,
} from './decision-report';
import { CONTRACT_RISK_CATEGORY_LABELS, COMPLIANCE_STATUS_LABELS, RISK_LEVEL_LABELS } from '../tender-labels';

export class PdfFontMissingError extends Error {
  constructor() {
    super(PDF_FONT_HELP);
    this.name = 'PdfFontMissingError';
  }
}

const TERM_LABELS: Record<string, { label: string; unit: string }> = {
  paymentDelayDays: { label: 'Срок оплаты после акта', unit: 'дн.' },
  advancePercent: { label: 'Аванс', unit: '%' },
  retentionPercent: { label: 'Гарантийное удержание', unit: '%' },
  deliveryDays: { label: 'Срок поставки', unit: 'дн.' },
  performanceSecurityPercent: { label: 'Обеспечение исполнения', unit: '%' },
  warrantyMonths: { label: 'Гарантийный срок', unit: 'мес.' },
  penaltyPercentPerDay: { label: 'Пеня за день просрочки', unit: '%' },
  penaltyCapPercent: { label: 'Предел неустойки', unit: '%' },
};

const INK = '#181b23';
const MUTED = '#65708b';
const LINE = '#d5d9e2';

export async function generateDecisionPdf(
  data: DecisionReportData,
): Promise<Buffer> {
  const fonts = findPdfFonts();
  if (!fonts) throw new PdfFontMissingError();

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 48, bottom: 56, left: 48, right: 48 },
    info: {
      Title: `Отчёт по тендеру: ${data.tender.title}`,
      Author: data.company.name,
      Creator: 'TENDER KILLER',
    },
  });

  doc.registerFont('body', fonts.regular);
  doc.registerFont('bold', fonts.bold);

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const summary = buildDecisionSummary(data);
  const width = doc.page.width - 96;

  // ── Титул ────────────────────────────────────────────────────────────────
  doc
    .font('bold')
    .fontSize(9)
    .fillColor(MUTED)
    .text('TENDER KILLER · ОТЧЁТ ДЛЯ ПРИНЯТИЯ РЕШЕНИЯ', { characterSpacing: 1.2 });
  doc.moveDown(0.8);
  doc.font('bold').fontSize(18).fillColor(INK).text(data.tender.title, { width });
  doc.moveDown(0.4);

  const meta = [
    data.tender.externalNumber ? `№ ${data.tender.externalNumber}` : null,
    data.tender.customerName,
    data.tender.procurementType,
  ]
    .filter(Boolean)
    .join(' · ');
  if (meta) {
    doc.font('body').fontSize(10).fillColor(MUTED).text(meta, { width });
  }
  doc.moveDown(0.3);
  doc
    .font('body')
    .fontSize(9)
    .fillColor(MUTED)
    .text(
      `${data.company.name}${data.company.bin ? `, БИН ${data.company.bin}` : ''} · `
      + `${data.company.taxRegime} · сформирован ${formatDateTime(data.generatedAt)}`,
      { width },
    );

  doc.moveDown(1);
  rule(doc, width);
  doc.moveDown(0.8);

  // ── Итоговая оценка ──────────────────────────────────────────────────────
  doc.font('bold').fontSize(13).fillColor(INK).text(summary.title, { width });
  doc.moveDown(0.3);
  doc
    .font('body')
    .fontSize(9)
    .fillColor(MUTED)
    .text(`Оценка: ${VERDICT_LABELS[summary.verdict]}`, { width });
  doc.moveDown(0.5);
  for (const reason of summary.reasons) {
    bullet(doc, reason, width);
  }

  doc.moveDown(0.8);

  // ── Финансы ──────────────────────────────────────────────────────────────
  section(doc, 'Экономика сделки', width);
  if (!data.finance) {
    doc
      .font('body')
      .fontSize(10)
      .fillColor('#b45309')
      .text(
        'Финансовый расчёт не сохранён. Экономика сделки не оценена.',
        { width },
      );
  } else {
    const f = data.finance;
    table(doc, width, [
      ['Цена предложения (с НДС)', formatMinorKzt(f.bidPriceMinor)],
      ['Начальная цена закупки', formatMinorKzt(data.tender.startPriceMinor)],
      ['Выручка без НДС', formatMinorKzt(f.revenueNetMinor)],
      ['Полная себестоимость исполнения', formatMinorKzt(f.totalCostMinor)],
      ['Валовая прибыль', formatMinorKzt(f.grossProfitMinor)],
      ['Операционная прибыль', formatMinorKzt(f.operatingProfitMinor)],
      ['Прибыль до налогообложения', formatMinorKzt(f.preTaxProfitMinor)],
      ['Налог на доход', formatMinorKzt(f.incomeTaxMinor)],
      ['РАСЧЁТНАЯ ЧИСТАЯ ПРИБЫЛЬ', formatMinorKzt(f.netProfitMinor), true],
      ['Рентабельность продаж', formatRatioAsPercent(f.netMarginRatio)],
      [
        'ROI',
        f.roiRatio === null
          ? '—'
          : `${formatRatioAsPercent(f.roiRatio)} (в годовом выражении ${formatRatioAsPercent(f.roiAnnualizedRatio)})`,
      ],
      ['Минимальная безубыточная цена', formatMinorKzt(f.breakEvenPriceMinor)],
      [
        'Запас по цене до убытка',
        f.priceDropToZeroRatio === null
          ? '—'
          : formatRatioAsPercent(f.priceDropToZeroRatio),
      ],
      [
        'Запас по росту затрат',
        f.costIncreaseToZeroRatio === null
          ? '—'
          : formatRatioAsPercent(f.costIncreaseToZeroRatio),
      ],
    ]);

    doc.moveDown(0.6);
    doc.font('bold').fontSize(10).fillColor(INK).text('Денежный поток', { width });
    doc.moveDown(0.2);
    table(doc, width, [
      [
        'Потребность в оборотном капитале',
        `${formatMinorKzt(f.workingCapitalMinor)}${f.peakGapDay !== null ? ` (пик на день ${f.peakGapDay})` : ''}`,
      ],
      ['Итоговый денежный поток проекта', formatMinorKzt(f.netCashMinor)],
      [
        'Расхождение прибыли и денежного потока',
        formatMinorKzt(f.profitVsCashDeltaMinor),
      ],
      ['НДС к уплате в бюджет', formatMinorKzt(f.vatPayableMinor)],
    ]);
    doc.moveDown(0.3);
    doc
      .font('body')
      .fontSize(8.5)
      .fillColor(MUTED)
      .text(
        'Прибыль и денежный поток не совпадают: в потоке участвуют суммы с НДС, '
        + 'возвратные обеспечения и фактические сроки платежей.',
        { width },
      );

    if (f.scenarios.length > 0) {
      doc.moveDown(0.6);
      doc.font('bold').fontSize(10).fillColor(INK).text('Сценарии', { width });
      doc.moveDown(0.2);
      table(
        doc,
        width,
        f.scenarios.map((s) => [
          s.label,
          `прибыль ${formatMinorKzt(s.netProfitMinor)}, оборотные средства ${formatMinorKzt(s.workingCapitalMinor)}`,
        ]),
      );
    }

    doc.moveDown(0.5);
    table(doc, width, [
      [
        'Затраты, подтверждённые документами',
        f.verifiedCostShareRatio === null
          ? '—'
          : formatRatioAsPercent(f.verifiedCostShareRatio),
      ],
      ['Затраты без подтверждения', formatMinorKzt(f.unverifiedCostMinor)],
      [
        'Версия расчёта',
        `движок ${f.engineVersion}, налоговый конфиг ${f.taxConfigVersion}`,
      ],
    ]);

    const warnings = f.warnings.filter((w) => w.severity !== 'INFO');
    if (warnings.length > 0) {
      doc.moveDown(0.6);
      doc
        .font('bold')
        .fontSize(10)
        .fillColor(INK)
        .text('Предупреждения расчёта', { width });
      doc.moveDown(0.2);
      for (const warning of warnings) {
        bullet(
          doc,
          `${warning.severity === 'CRITICAL' ? '[важно] ' : ''}${warning.message}`,
          width,
        );
      }
    }
  }

  // ── Проверка документов ──────────────────────────────────────────────────
  doc.moveDown(0.8);
  section(doc, 'Проверка документов заявки', width);
  if (!data.compliance) {
    doc
      .font('body')
      .fontSize(10)
      .fillColor('#b45309')
      .text('Проверка не выполнялась. Риск отклонения заявки не оценён.', { width });
  } else {
    const c = data.compliance;
    table(
      doc,
      width,
      Object.entries(COMPLIANCE_STATUS_LABELS).map(([status, label]) => [
        label,
        String(c.byStatus[status] ?? 0),
      ]),
    );
    if (c.unreadableDocuments.length > 0) {
      doc.moveDown(0.3);
      doc
        .font('body')
        .fontSize(8.5)
        .fillColor('#b45309')
        .text(
          `Не прочитано содержимое документов: ${c.unreadableDocuments.join(', ')}. `
          + 'По ним вывод об отсутствии подтверждения не делался.',
          { width },
        );
    }

    if (c.criticalFindings.length > 0) {
      doc.moveDown(0.6);
      doc
        .font('bold')
        .fontSize(10)
        .fillColor(INK)
        .text('Замечания, требующие действий', { width });
      doc.moveDown(0.3);
      for (const finding of c.criticalFindings) {
        ensureSpace(doc, 70);
        doc
          .font('bold')
          .fontSize(9)
          .fillColor(INK)
          .text(finding.requirementText, { width });
        doc
          .font('body')
          .fontSize(8.5)
          .fillColor(MUTED)
          .text(
            `${COMPLIANCE_STATUS_LABELS[finding.status as keyof typeof COMPLIANCE_STATUS_LABELS] ?? finding.status}`
            + ` · риск: ${RISK_LEVEL_LABELS[finding.riskLevel as keyof typeof RISK_LEVEL_LABELS] ?? finding.riskLevel}`
            + (finding.documentName ? ` · ${finding.documentName}` : '')
            + (finding.pageNumber !== null ? `, стр. ${finding.pageNumber}` : ''),
            { width },
          );
        if (finding.uncertaintyReason) {
          doc
            .font('body')
            .fontSize(8.5)
            .fillColor('#b45309')
            .text(finding.uncertaintyReason, { width });
        }
        doc
          .font('body')
          .fontSize(9)
          .fillColor(INK)
          .text(`Что сделать: ${finding.recommendation}`, { width });
        doc.moveDown(0.5);
      }
    }
  }

  // ── Договор ──────────────────────────────────────────────────────────────
  doc.moveDown(0.5);
  section(doc, 'Риски проекта договора', width);
  if (!data.contract) {
    doc
      .font('body')
      .fontSize(10)
      .fillColor('#b45309')
      .text('Проект договора не анализировался. Договорные риски не оценены.', {
        width,
      });
  } else {
    const ct = data.contract;
    doc
      .font('body')
      .fontSize(9)
      .fillColor(MUTED)
      .text(`Документ: ${ct.documentName}`, { width });
    doc.moveDown(0.3);

    const terms = Object.entries(TERM_LABELS)
      .map(([key, meta]) => {
        const value = ct.extractedTerms[key];
        return [
          meta.label,
          value === null || value === undefined
            ? 'не указано в договоре'
            : `${value} ${meta.unit}`,
        ] as [string, string];
      });
    table(doc, width, terms);

    doc.moveDown(0.4);
    table(doc, width, [
      [
        'Рисков по уровням',
        Object.entries(ct.risksByLevel)
          .map(
            ([level, count]) =>
              `${RISK_LEVEL_LABELS[level as keyof typeof RISK_LEVEL_LABELS] ?? level}: ${count}`,
          )
          .join(', ') || 'не выявлено',
      ],
      ['Требуют проверки юриста', String(ct.needsLawyerReview)],
    ]);

    if (ct.topRisks.length > 0) {
      doc.moveDown(0.5);
      for (const risk of ct.topRisks) {
        ensureSpace(doc, 80);
        doc.font('bold').fontSize(9).fillColor(INK).text(risk.title, { width });
        doc
          .font('body')
          .fontSize(8.5)
          .fillColor(MUTED)
          .text(
            `${CONTRACT_RISK_CATEGORY_LABELS[risk.category] ?? risk.category}`
            + ` · уровень: ${RISK_LEVEL_LABELS[risk.riskLevel as keyof typeof RISK_LEVEL_LABELS] ?? risk.riskLevel}`
            + (risk.clauseRef ? ` · пункт ${risk.clauseRef}` : ''),
            { width },
          );
        doc.font('body').fontSize(9).fillColor(INK).text(risk.explanation, { width });
        if (risk.recommendation) {
          doc
            .font('body')
            .fontSize(9)
            .fillColor(INK)
            .text(`Предложение: ${risk.recommendation}`, { width });
        }
        doc.moveDown(0.5);
      }
    }
  }

  // ── Снабжение ────────────────────────────────────────────────────────────
  doc.moveDown(0.5);
  section(doc, 'Закупочная себестоимость', width);
  table(doc, width, [
    ['Позиций в закупке', String(data.sourcing.lineItemsCount)],
    [
      'Позиций с подтверждённой ценой',
      `${data.sourcing.itemsWithConfirmedPrice} из ${data.sourcing.lineItemsCount}`,
    ],
    [
      'Подтверждённая стоимость закупки',
      formatMinorKzt(data.sourcing.confirmedPurchaseCostMinor),
    ],
    [
      'Предложений поставщиков',
      `${data.sourcing.quotesCount}, из них без документа-основания ${data.sourcing.unverifiedQuotesCount}`,
    ],
  ]);

  // ── Пробелы ──────────────────────────────────────────────────────────────
  if (data.gaps.length > 0) {
    doc.moveDown(0.8);
    section(doc, 'Чего не хватает для полноценного решения', width);
    for (const gap of data.gaps) {
      bullet(doc, gap, width);
    }
  }

  // ── Оговорка ─────────────────────────────────────────────────────────────
  doc.moveDown(1);
  rule(doc, width);
  doc.moveDown(0.4);
  doc.font('body').fontSize(8).fillColor(MUTED).text(DECISION_DISCLAIMER, { width });

  doc.end();
  return done;
}

type Doc = PDFKit.PDFDocument;

function section(doc: Doc, title: string, width: number): void {
  ensureSpace(doc, 80);
  doc.font('bold').fontSize(12).fillColor(INK).text(title, { width });
  doc.moveDown(0.35);
}

function rule(doc: Doc, width: number): void {
  const y = doc.y;
  doc
    .moveTo(doc.page.margins.left, y)
    .lineTo(doc.page.margins.left + width, y)
    .lineWidth(0.6)
    .strokeColor(LINE)
    .stroke();
}

function bullet(doc: Doc, text: string, width: number): void {
  ensureSpace(doc, 30);
  doc
    .font('body')
    .fontSize(9.5)
    .fillColor(INK)
    .text(`•  ${text}`, { width, indent: 0, lineGap: 1.5 });
  doc.moveDown(0.15);
}

/** Простая таблица «показатель — значение». */
function table(
  doc: Doc,
  width: number,
  rows: Array<[string, string] | [string, string, boolean]>,
): void {
  const labelWidth = width * 0.58;
  const valueWidth = width - labelWidth;

  for (const row of rows) {
    const [label, value, strong] = row;
    ensureSpace(doc, 24);
    const y = doc.y;
    doc
      .font(strong ? 'bold' : 'body')
      .fontSize(9.5)
      .fillColor(strong ? INK : MUTED)
      .text(label, doc.page.margins.left, y, { width: labelWidth });
    const labelBottom = doc.y;
    doc
      .font(strong ? 'bold' : 'body')
      .fontSize(9.5)
      .fillColor(INK)
      .text(value, doc.page.margins.left + labelWidth, y, {
        width: valueWidth,
        align: 'right',
      });
    doc.y = Math.max(labelBottom, doc.y);
    doc.moveDown(0.12);
  }
  // PDFKit запоминает координату x после вывода с явной позицией —
  // возвращаем курсор к левому полю, иначе следующий текст обрежется справа.
  doc.x = doc.page.margins.left;
}

/** Перенос на новую страницу, если места не хватает. */
function ensureSpace(doc: Doc, needed: number): void {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + needed > bottom) doc.addPage();
}

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('ru-KZ', {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(new Date(iso));
}
