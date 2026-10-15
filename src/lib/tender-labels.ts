/** Подписи перечислений для интерфейса. */

export const TENDER_STAGE_LABELS = {
  DRAFT: 'Черновик',
  ANALYSIS: 'Анализ',
  DECIDED_GO: 'Участвуем',
  DECIDED_NO_GO: 'Не участвуем',
  SUBMITTED: 'Заявка подана',
  WON: 'Победа',
  LOST: 'Проигран',
  ARCHIVED: 'В архиве',
} as const;

export const PROCUREMENT_TYPE_LABELS = {
  OPEN_TENDER: 'Открытый конкурс',
  REQUEST_FOR_QUOTATIONS: 'Запрос ценовых предложений',
  SINGLE_SOURCE: 'Из одного источника',
  AUCTION: 'Аукцион',
  CORPORATE: 'Корпоративная закупка',
  OTHER: 'Иное',
} as const;

export const DOCUMENT_KIND_LABELS = {
  TECHNICAL_SPEC: 'Техническая спецификация',
  CONTRACT_DRAFT: 'Проект договора',
  TENDER_NOTICE: 'Объявление о закупке',
  SUPPLIER_QUOTE: 'Коммерческое предложение',
  PRICE_LIST: 'Прайс-лист',
  OWN_CERTIFICATE: 'Наш документ (лицензия, сертификат)',
  OTHER: 'Прочее',
} as const;

export const EXTRACTION_STATUS_LABELS = {
  PENDING: 'В очереди',
  PROCESSING: 'Обрабатывается',
  SUCCEEDED: 'Текст извлечён',
  PARTIAL: 'Извлечено частично',
  FAILED: 'Не удалось прочитать',
} as const;

export const COMPLIANCE_STATUS_LABELS = {
  CONFIRMED: 'Подтверждено',
  NOT_FOUND: 'Не обнаружено',
  MISMATCH: 'Несоответствие',
  NEEDS_REVIEW: 'Требует проверки',
} as const;

export const RISK_LEVEL_LABELS = {
  CRITICAL: 'Критический',
  HIGH: 'Высокий',
  MEDIUM: 'Средний',
  LOW: 'Низкий',
  INFO: 'Информация',
} as const;

export const REQUIREMENT_CATEGORY_LABELS = {
  DOCUMENT: 'Документ',
  TECHNICAL: 'Техническая характеристика',
  QUALIFICATION: 'Квалификационное требование',
  DEADLINE: 'Срок',
  FINANCIAL: 'Финансовое условие',
  OTHER: 'Прочее',
} as const;

export const CONTRACT_RISK_CATEGORY_LABELS: Record<string, string> = {
  PAYMENT_TERMS: 'Порядок и сроки оплаты',
  ADVANCE: 'Аванс',
  DELIVERY: 'Сроки поставки и исполнения',
  PENALTY: 'Штрафы и неустойки',
  GUARANTEE: 'Гарантийные обязательства',
  SECURITY: 'Обеспечение обязательств',
  ACCEPTANCE: 'Приёмка',
  TERMINATION: 'Расторжение',
  EXTRA_COSTS: 'Дополнительные расходы',
  OTHER: 'Прочее',
};
