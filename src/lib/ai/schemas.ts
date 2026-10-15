/**
 * Схемы структурированных ответов модели и их валидация.
 *
 * Схема инструмента (JSON Schema) задаёт форму ответа для модели,
 * zod-схема проверяет его на нашей стороне. Дублирование намеренное:
 * доверять форме ответа без проверки нельзя.
 */

import { z } from 'zod';

// ───────────────────────── Извлечение требований ────────────────────────────

export const RequirementCategoryEnum = z.enum([
  'DOCUMENT',
  'TECHNICAL',
  'QUALIFICATION',
  'DEADLINE',
  'FINANCIAL',
  'OTHER',
]);

export const ExtractedRequirementSchema = z.object({
  label: z.string().min(1).max(300),
  text: z.string().min(3).max(4000),
  category: RequirementCategoryEnum,
  isMandatory: z.boolean(),
  /** Дословная цитата из документа. Проверяется поиском в тексте. */
  sourceQuote: z.string().min(1).max(2000),
  /** Номер страницы по версии модели. Перепроверяется поиском цитаты. */
  pageNumber: z.number().int().min(1).max(10_000).nullable(),
});

export const RequirementsResponseSchema = z.object({
  requirements: z.array(ExtractedRequirementSchema).max(300),
  /** Пояснение модели, если извлечь удалось не всё. */
  limitations: z.array(z.string().max(1000)).max(20).optional().default([]),
});

export const REQUIREMENTS_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    requirements: {
      type: 'array',
      description: 'Список требований закупки, извлечённых из документа',
      items: {
        type: 'object',
        properties: {
          label: {
            type: 'string',
            description: 'Короткое название требования, до 120 символов',
          },
          text: {
            type: 'string',
            description:
              'Формулировка требования своими словами, но без добавления условий, которых нет в документе',
          },
          category: {
            type: 'string',
            enum: ['DOCUMENT', 'TECHNICAL', 'QUALIFICATION', 'DEADLINE', 'FINANCIAL', 'OTHER'],
            description:
              'DOCUMENT — требуется представить документ; TECHNICAL — техническая характеристика; QUALIFICATION — квалификационное требование; DEADLINE — срок; FINANCIAL — финансовое условие (обеспечение, оплата); OTHER — иное',
          },
          isMandatory: {
            type: 'boolean',
            description:
              'true, если требование обязательное; false, если желательное или оценочное',
          },
          sourceQuote: {
            type: 'string',
            description:
              'ДОСЛОВНАЯ цитата из документа, подтверждающая требование. Копируйте текст точно, не перефразируйте. Минимум 12 символов.',
          },
          pageNumber: {
            type: ['integer', 'null'],
            description:
              'Номер страницы из маркера «--- стр. N ---», в котором находится цитата. null, если маркеров нет.',
          },
        },
        required: ['label', 'text', 'category', 'isMandatory', 'sourceQuote', 'pageNumber'],
      },
    },
    limitations: {
      type: 'array',
      description:
        'Что помешало извлечь требования полностью: пропущенные страницы, нечитаемые фрагменты, неоднозначные формулировки',
      items: { type: 'string' },
    },
  },
  required: ['requirements'],
} as const;

// ───────────────────────── Извлечение позиций ТЗ ────────────────────────────

export const ExtractedLineItemSchema = z.object({
  name: z.string().min(1).max(500),
  specification: z.string().max(4000).nullable(),
  unit: z.string().max(32),
  quantity: z.number().min(0).max(1e9),
  sourceQuote: z.string().min(1).max(2000),
  pageNumber: z.number().int().min(1).max(10_000).nullable(),
  /** Цена за единицу по объявлению, если указана в документе, в тенге. */
  customerUnitPrice: z.number().min(0).max(1e13).nullable(),
});

export const LineItemsResponseSchema = z.object({
  items: z.array(ExtractedLineItemSchema).max(500),
  limitations: z.array(z.string().max(1000)).max(20).optional().default([]),
});

export const LINE_ITEMS_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      description: 'Товарные позиции из технической спецификации',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Наименование позиции как в документе' },
          specification: {
            type: ['string', 'null'],
            description: 'Технические характеристики, требуемые заказчиком',
          },
          unit: { type: 'string', description: 'Единица измерения: шт, кг, м, компл и т.п.' },
          quantity: {
            type: 'number',
            description: 'Количество. Если в документе не указано, укажите 0 и отметьте это в limitations.',
          },
          sourceQuote: {
            type: 'string',
            description: 'ДОСЛОВНАЯ цитата из документа с этой позицией',
          },
          pageNumber: {
            type: ['integer', 'null'],
            description: 'Номер страницы из маркера «--- стр. N ---»',
          },
          customerUnitPrice: {
            type: ['number', 'null'],
            description:
              'Цена за единицу в тенге, если она указана в документе закупки. null, если цены нет. НЕ ОЦЕНИВАЙТЕ цену сами.',
          },
        },
        required: ['name', 'specification', 'unit', 'quantity', 'sourceQuote', 'pageNumber', 'customerUnitPrice'],
      },
    },
    limitations: {
      type: 'array',
      description: 'Что не удалось извлечь или где данные неполные',
      items: { type: 'string' },
    },
  },
  required: ['items'],
} as const;

// ───────────────────────── Проверка соответствия ────────────────────────────

export const ComplianceStatusEnum = z.enum([
  'CONFIRMED',
  'NOT_FOUND',
  'MISMATCH',
  'NEEDS_REVIEW',
]);

export const RiskLevelEnum = z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']);

export const ComplianceFindingSchema = z.object({
  requirementIndex: z.number().int().min(0),
  status: ComplianceStatusEnum,
  riskLevel: RiskLevelEnum,
  /** Имя документа поставщика, в котором найдено подтверждение. */
  evidenceDocumentName: z.string().max(400).nullable(),
  evidenceQuote: z.string().max(2000).nullable(),
  evidencePageNumber: z.number().int().min(1).max(10_000).nullable(),
  recommendation: z.string().min(3).max(2000),
  /** Почему вывод неоднозначен (обязательно для NEEDS_REVIEW). */
  uncertaintyReason: z.string().max(1000).nullable(),
});

export const ComplianceResponseSchema = z.object({
  findings: z.array(ComplianceFindingSchema).max(300),
  limitations: z.array(z.string().max(1000)).max(20).optional().default([]),
});

export const COMPLIANCE_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      description: 'Результат сопоставления каждого требования с документами поставщика',
      items: {
        type: 'object',
        properties: {
          requirementIndex: {
            type: 'integer',
            description: 'Номер требования из списка, переданного в запросе (начиная с 0)',
          },
          status: {
            type: 'string',
            enum: ['CONFIRMED', 'NOT_FOUND', 'MISMATCH', 'NEEDS_REVIEW'],
            description:
              'CONFIRMED — подтверждение найдено в документах поставщика; NOT_FOUND — в ПРОЧИТАННЫХ документах подтверждения нет; MISMATCH — документ есть, но его содержание противоречит требованию; NEEDS_REVIEW — вывод сделать нельзя (документ не прочитан, формулировка неоднозначна, нужна проверка человеком). Если содержимое документа не было прочитано, ставьте NEEDS_REVIEW, а НЕ NOT_FOUND.',
          },
          riskLevel: {
            type: 'string',
            enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'],
            description:
              'CRITICAL — без этого заявка будет отклонена; HIGH — высокий риск отклонения; MEDIUM — требует устранения; LOW — незначительно; INFO — замечание к сведению',
          },
          evidenceDocumentName: {
            type: ['string', 'null'],
            description: 'Имя документа поставщика, где найдено подтверждение. null, если не найдено.',
          },
          evidenceQuote: {
            type: ['string', 'null'],
            description: 'ДОСЛОВНАЯ цитата из документа поставщика. null, если подтверждения нет.',
          },
          evidencePageNumber: {
            type: ['integer', 'null'],
            description: 'Номер страницы документа поставщика с цитатой',
          },
          recommendation: {
            type: 'string',
            description:
              'Конкретное действие: что подготовить, исправить или уточнить. Без общих фраз.',
          },
          uncertaintyReason: {
            type: ['string', 'null'],
            description:
              'Обязательно для статуса NEEDS_REVIEW: почему вывод сделать нельзя.',
          },
        },
        required: [
          'requirementIndex',
          'status',
          'riskLevel',
          'evidenceDocumentName',
          'evidenceQuote',
          'evidencePageNumber',
          'recommendation',
          'uncertaintyReason',
        ],
      },
    },
    limitations: {
      type: 'array',
      description: 'Ограничения проверки: какие документы не прочитаны, что осталось непроверенным',
      items: { type: 'string' },
    },
  },
  required: ['findings'],
} as const;

// ───────────────────────── Анализ договора ──────────────────────────────────

export const ContractRiskCategoryEnum = z.enum([
  'PAYMENT_TERMS',
  'ADVANCE',
  'DELIVERY',
  'PENALTY',
  'GUARANTEE',
  'SECURITY',
  'ACCEPTANCE',
  'TERMINATION',
  'EXTRA_COSTS',
  'OTHER',
]);

export const ContractRiskSchema = z.object({
  category: ContractRiskCategoryEnum,
  title: z.string().min(3).max(300),
  clauseRef: z.string().max(100).nullable(),
  sourceQuote: z.string().min(1).max(2000),
  pageNumber: z.number().int().min(1).max(10_000).nullable(),
  riskLevel: RiskLevelEnum,
  explanation: z.string().min(3).max(3000),
  recommendation: z.string().max(2000).nullable(),
  needsLawyerReview: z.boolean(),
  /**
   * Числовые параметры, которые можно перенести в финансовую модель.
   * Модель заполняет только то, что прямо написано в договоре.
   */
  financeHint: z
    .object({
      paymentDelayDays: z.number().int().min(0).max(3650).nullable().optional(),
      advancePercent: z.number().min(0).max(100).nullable().optional(),
      retentionPercent: z.number().min(0).max(100).nullable().optional(),
      penaltyPercentPerDay: z.number().min(0).max(100).nullable().optional(),
      penaltyCapPercent: z.number().min(0).max(100).nullable().optional(),
      performanceSecurityPercent: z.number().min(0).max(100).nullable().optional(),
      warrantyMonths: z.number().int().min(0).max(600).nullable().optional(),
      deliveryDays: z.number().int().min(0).max(3650).nullable().optional(),
    })
    .nullable()
    .optional(),
});

export const ContractResponseSchema = z.object({
  risks: z.array(ContractRiskSchema).max(200),
  /** Сводка извлечённых условий для переноса в финмодель. */
  extractedTerms: z
    .object({
      paymentDelayDays: z.number().int().min(0).max(3650).nullable(),
      advancePercent: z.number().min(0).max(100).nullable(),
      retentionPercent: z.number().min(0).max(100).nullable(),
      deliveryDays: z.number().int().min(0).max(3650).nullable(),
      performanceSecurityPercent: z.number().min(0).max(100).nullable(),
      warrantyMonths: z.number().int().min(0).max(600).nullable(),
      penaltyPercentPerDay: z.number().min(0).max(100).nullable(),
      penaltyCapPercent: z.number().min(0).max(100).nullable(),
    })
    .partial()
    .optional(),
  limitations: z.array(z.string().max(1000)).max(20).optional().default([]),
});

export const CONTRACT_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    risks: {
      type: 'array',
      description: 'Риски, выявленные в проекте договора',
      items: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            enum: [
              'PAYMENT_TERMS', 'ADVANCE', 'DELIVERY', 'PENALTY', 'GUARANTEE',
              'SECURITY', 'ACCEPTANCE', 'TERMINATION', 'EXTRA_COSTS', 'OTHER',
            ],
            description: 'Раздел договора, к которому относится риск',
          },
          title: { type: 'string', description: 'Краткая формулировка риска' },
          clauseRef: {
            type: ['string', 'null'],
            description: 'Номер пункта договора, например «2.3» или «5.1»',
          },
          sourceQuote: {
            type: 'string',
            description: 'ДОСЛОВНАЯ цитата пункта договора. Копируйте точно.',
          },
          pageNumber: {
            type: ['integer', 'null'],
            description: 'Номер страницы из маркера «--- стр. N ---»',
          },
          riskLevel: {
            type: 'string',
            enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'],
            description:
              'CRITICAL — угроза существенных убытков или невозможности исполнения; HIGH — значительный риск; MEDIUM — требует внимания; LOW — незначительно; INFO — к сведению',
          },
          explanation: {
            type: 'string',
            description: 'Чем именно это условие опасно для поставщика. Конкретно, по сути.',
          },
          recommendation: {
            type: ['string', 'null'],
            description: 'Что предложить изменить или как подстраховаться',
          },
          needsLawyerReview: {
            type: 'boolean',
            description:
              'true, если условие юридически неоднозначно и требует оценки юриста',
          },
          financeHint: {
            type: ['object', 'null'],
            description:
              'Числовые параметры из этого пункта для финансовой модели. Заполняйте ТОЛЬКО то, что прямо написано в договоре. Не оценивайте.',
            properties: {
              paymentDelayDays: { type: ['integer', 'null'] },
              advancePercent: { type: ['number', 'null'] },
              retentionPercent: { type: ['number', 'null'] },
              penaltyPercentPerDay: { type: ['number', 'null'] },
              penaltyCapPercent: { type: ['number', 'null'] },
              performanceSecurityPercent: { type: ['number', 'null'] },
              warrantyMonths: { type: ['integer', 'null'] },
              deliveryDays: { type: ['integer', 'null'] },
            },
          },
        },
        required: [
          'category', 'title', 'clauseRef', 'sourceQuote', 'pageNumber',
          'riskLevel', 'explanation', 'recommendation', 'needsLawyerReview',
        ],
      },
    },
    extractedTerms: {
      type: 'object',
      description:
        'Сводка числовых условий договора для переноса в финансовую модель. Только прямо указанные в договоре значения, иначе null.',
      properties: {
        paymentDelayDays: {
          type: ['integer', 'null'],
          description: 'Срок оплаты после подписания акта, в днях',
        },
        advancePercent: { type: ['number', 'null'], description: 'Размер аванса, %' },
        retentionPercent: {
          type: ['number', 'null'],
          description: 'Гарантийное удержание заказчика, %',
        },
        deliveryDays: {
          type: ['integer', 'null'],
          description: 'Срок поставки или выполнения работ, в днях',
        },
        performanceSecurityPercent: {
          type: ['number', 'null'],
          description: 'Обеспечение исполнения договора, %',
        },
        warrantyMonths: {
          type: ['integer', 'null'],
          description: 'Гарантийный срок, в месяцах',
        },
        penaltyPercentPerDay: {
          type: ['number', 'null'],
          description: 'Пеня за день просрочки, %',
        },
        penaltyCapPercent: {
          type: ['number', 'null'],
          description: 'Предельный размер неустойки, % от суммы договора',
        },
      },
    },
    limitations: {
      type: 'array',
      description: 'Что не удалось проанализировать и почему',
      items: { type: 'string' },
    },
  },
  required: ['risks'],
} as const;
