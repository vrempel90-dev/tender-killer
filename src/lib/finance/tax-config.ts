/**
 * Налоговые ставки и нормативы Республики Казахстан — КОНФИГУРАЦИЯ, не константы.
 *
 * Правило проекта: ни одна ставка не используется в расчётах без указания
 * источника и даты, с которой норма действует. Значения ниже — это значения
 * ПО УМОЛЧАНИЮ для нового пользователя; они перезаписываются записями в таблице
 * `tax_rate_configs` (см. prisma/seed.ts и раздел «Настройки» в интерфейсе).
 *
 * ⚠️ Поле `needsVerification: true` означает: значение взято из обзорных
 * публикаций, а не из официального текста нормы, и до сверки с первоисточником
 * помечается в интерфейсе как требующее подтверждения.
 */

import type { IncomeTaxBase, TaxContextInput, TaxRegimeCode } from './types';

export interface TaxRateDefinition {
  key: string;
  label: string;
  ratePercent: number;
  sourceTitle: string;
  sourceUrl: string | null;
  /** Дата, с которой норма действует (ISO). */
  effectiveFrom: string;
  effectiveTo: string | null;
  notes?: string;
  /** Значение не сверено с официальным текстом нормы. */
  needsVerification?: boolean;
}

/** Версия набора ставок. Меняется при любой правке значений ниже. */
export const TAX_CONFIG_VERSION = '2026.01-KZ';

/**
 * Источник основной массы ставок: Налоговый кодекс Республики Казахстан
 * (Кодекс РК от 18 июля 2025 года № 214-VIII), действует с 1 января 2026 года.
 */
const NK_RK_2026 = 'Налоговый кодекс РК от 18.07.2025 № 214-VIII (действует с 01.01.2026)';
const NK_RK_2026_URL = 'https://adilet.zan.kz/rus/docs/K2500000214';

export const DEFAULT_TAX_RATES: TaxRateDefinition[] = [
  {
    key: 'VAT_STANDARD',
    label: 'НДС, стандартная ставка',
    ratePercent: 16,
    sourceTitle: `${NK_RK_2026}, раздел об НДС`,
    sourceUrl: NK_RK_2026_URL,
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    notes:
      'С 01.01.2026 ставка повышена с 12 % до 16 %. До 31.12.2025 действовала ставка 12 %.',
  },
  {
    key: 'VAT_SOCIAL_SPHERE',
    label: 'НДС, льготная ставка (медицинские товары и услуги)',
    ratePercent: 5,
    sourceTitle: `${NK_RK_2026}, льготные ставки НДС`,
    sourceUrl: NK_RK_2026_URL,
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-12-31',
    notes: 'С 2027 года льготная ставка по этим операциям составит 10 %.',
    needsVerification: true,
  },
  {
    key: 'VAT_REGISTRATION_THRESHOLD_MCI',
    label: 'Порог обязательной постановки на учёт по НДС, МРП',
    ratePercent: 10_000,
    sourceTitle: `${NK_RK_2026}, постановка на регистрационный учёт по НДС`,
    sourceUrl: NK_RK_2026_URL,
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    notes:
      'Порог снижен с 20 000 МРП до 10 000 МРП. При МРП 4 325 ₸ это 43 250 000 ₸ оборота. '
      + 'Значение указано в МРП, а не в процентах.',
  },
  {
    key: 'MCI_MONTHLY_CALC_INDEX_KZT',
    label: 'Месячный расчётный показатель (МРП), ₸',
    ratePercent: 4_325,
    sourceTitle: 'Закон РК о республиканском бюджете на 2026–2028 годы',
    sourceUrl: 'https://adilet.zan.kz/rus/docs/Z2500000001',
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-12-31',
    notes: 'Указано в тенге, а не в процентах. Используется для расчёта порогов и пошлин.',
    needsVerification: true,
  },
  {
    key: 'CIT_STANDARD',
    label: 'КПН, стандартная ставка',
    ratePercent: 20,
    sourceTitle: `${NK_RK_2026}, ст. 313 п. 1`,
    sourceUrl: NK_RK_2026_URL,
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    notes: 'Налогооблагаемый доход облагается по ставке 20 %, если ст. 313 п. 2 не установлено иное.',
  },
  {
    key: 'CIT_BANKS_GAMBLING',
    label: 'КПН для банков и игорного бизнеса',
    ratePercent: 25,
    sourceTitle: `${NK_RK_2026}, ст. 313 п. 2`,
    sourceUrl: NK_RK_2026_URL,
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    notes:
      'Повышенная ставка для банков (кроме дохода от кредитования субъектов '
      + 'предпринимательства), казино, игровых залов, тотализаторов и букмекеров.',
  },
  {
    key: 'SIMPLIFIED_DECLARATION_RATE',
    label: 'Налог по упрощённой декларации (СНР)',
    ratePercent: 4,
    sourceTitle: `${NK_RK_2026}, специальный налоговый режим на основе упрощённой декларации`,
    sourceUrl: NK_RK_2026_URL,
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    notes:
      'Считается от ОБОРОТА (дохода), а не от прибыли. Местные представительные органы '
      + 'вправе корректировать ставку в пределах ±50 %. Применяющий СНР не является '
      + 'плательщиком НДС по внутренним оборотам.',
    needsVerification: true,
  },
  {
    key: 'RETAIL_TAX_RATE',
    label: 'Розничный налог',
    ratePercent: 4,
    sourceTitle: `${NK_RK_2026}, специальный налоговый режим розничного налога`,
    sourceUrl: NK_RK_2026_URL,
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    notes: 'Считается от оборота. Ставку необходимо сверить с действующей редакцией кодекса.',
    needsVerification: true,
  },
  {
    key: 'PAYROLL_TOTAL_EMPLOYER_BURDEN',
    label: 'Совокупная нагрузка на ФОТ (взносы и отчисления работодателя)',
    ratePercent: 24,
    sourceTitle:
      'Расчётная оценка: социальный налог, социальные отчисления, ОПВР, ВОСМС, ООСМС '
      + 'по законодательству РК',
    sourceUrl: null,
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    notes:
      'ОРИЕНТИР, а не норма. Фактическая нагрузка зависит от вида выплат, лимитов по '
      + 'доходу и статуса работника. Обязательно уточните у своего бухгалтера и '
      + 'замените значение в настройках.',
    needsVerification: true,
  },
  {
    key: 'PROCUREMENT_BID_SECURITY_PERCENT',
    label: 'Обеспечение заявки на участие (конкурс, аукцион)',
    ratePercent: 1,
    sourceTitle: 'Закон РК «О государственных закупках», обеспечение заявки',
    sourceUrl: 'https://adilet.zan.kz/rus/docs/Z1500000434',
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    notes:
      '1 % от суммы, выделенной для приобретения ТРУ. Для запроса ценовых предложений '
      + 'размер может отличаться — сверяйте с условиями конкретной закупки. '
      + 'Обеспечение ВОЗВРАТНОЕ: расходом является только стоимость денег или комиссия банка.',
  },
  {
    key: 'PROCUREMENT_PERFORMANCE_SECURITY_PERCENT',
    label: 'Обеспечение исполнения договора о госзакупках',
    ratePercent: 3,
    sourceTitle: 'Закон РК «О государственных закупках», обеспечение исполнения договора',
    sourceUrl: 'https://adilet.zan.kz/rus/docs/Z1500000434',
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    notes:
      '3 % от общей суммы договора. Обеспечение ВОЗВРАТНОЕ. По отдельным видам закупок '
      + 'размер может отличаться — сверяйте с условиями закупки.',
  },
];

/** Налоговый режим → как считается налог на доход. */
export const INCOME_TAX_BASE_BY_REGIME: Record<TaxRegimeCode, IncomeTaxBase> = {
  GENERAL_VAT: 'PROFIT',
  GENERAL_NO_VAT: 'PROFIT',
  SIMPLIFIED: 'TURNOVER',
  RETAIL_TAX: 'TURNOVER',
  INDIVIDUAL_ENTREPRENEUR: 'PROFIT',
};

/** Ключ ставки налога на доход для режима. */
export const INCOME_TAX_RATE_KEY_BY_REGIME: Record<TaxRegimeCode, string> = {
  GENERAL_VAT: 'CIT_STANDARD',
  GENERAL_NO_VAT: 'CIT_STANDARD',
  SIMPLIFIED: 'SIMPLIFIED_DECLARATION_RATE',
  RETAIL_TAX: 'RETAIL_TAX_RATE',
  INDIVIDUAL_ENTREPRENEUR: 'CIT_STANDARD',
};

/** Может ли компания на этом режиме быть плательщиком НДС по внутренним оборотам. */
export const CAN_BE_VAT_PAYER: Record<TaxRegimeCode, boolean> = {
  GENERAL_VAT: true,
  GENERAL_NO_VAT: false,
  // Применяющий СНР не подлежит постановке на учёт по НДС (регистрация возможна
  // только в общеустановленном порядке).
  SIMPLIFIED: false,
  RETAIL_TAX: false,
  INDIVIDUAL_ENTREPRENEUR: true,
};

export const TAX_REGIME_LABELS: Record<TaxRegimeCode, string> = {
  GENERAL_VAT: 'Общеустановленный режим, плательщик НДС',
  GENERAL_NO_VAT: 'Общеустановленный режим, не плательщик НДС',
  SIMPLIFIED: 'Упрощённая декларация (СНР)',
  RETAIL_TAX: 'Розничный налог (СНР)',
  INDIVIDUAL_ENTREPRENEUR: 'ИП, общеустановленный режим',
};

function findRate(rates: TaxRateDefinition[], key: string): TaxRateDefinition | undefined {
  return rates.find((r) => r.key === key);
}

/**
 * Собирает налоговый контекст расчёта для режима компании из набора ставок.
 * Если нужной ставки в наборе нет — выбрасывает ошибку, а НЕ подставляет
 * «разумное» значение: выдуманные ставки в финансовом расчёте недопустимы.
 */
export function buildTaxContext(params: {
  regime: TaxRegimeCode;
  isVatPayer: boolean;
  rates?: TaxRateDefinition[];
  /** Доля зачёта входящего НДС, % (пропорциональный метод). */
  vatRecoverySharePercent?: number;
  configVersion?: string;
}): TaxContextInput {
  const rates = params.rates ?? DEFAULT_TAX_RATES;
  const regime = params.regime;

  const canBeVatPayer = CAN_BE_VAT_PAYER[regime];
  const isVatPayer = params.isVatPayer && canBeVatPayer;

  const vatRate = findRate(rates, 'VAT_STANDARD');
  if (!vatRate) {
    throw new Error('В налоговой конфигурации отсутствует ставка VAT_STANDARD');
  }

  const incomeKey = INCOME_TAX_RATE_KEY_BY_REGIME[regime];
  const incomeRate = findRate(rates, incomeKey);
  if (!incomeRate) {
    throw new Error(`В налоговой конфигурации отсутствует ставка ${incomeKey}`);
  }

  const payrollRate = findRate(rates, 'PAYROLL_TOTAL_EMPLOYER_BURDEN');
  if (!payrollRate) {
    throw new Error(
      'В налоговой конфигурации отсутствует ставка PAYROLL_TOTAL_EMPLOYER_BURDEN',
    );
  }

  return {
    regime,
    isVatPayer,
    vatRatePercent: isVatPayer ? vatRate.ratePercent : 0,
    // Поставщики выставляют НДС по стандартной ставке независимо от того,
    // является ли покупатель плательщиком НДС.
    purchaseVatRatePercent: vatRate.ratePercent,
    vatRecoverySharePercent: isVatPayer ? (params.vatRecoverySharePercent ?? 100) : 0,
    incomeTaxRatePercent: incomeRate.ratePercent,
    incomeTaxBase: INCOME_TAX_BASE_BY_REGIME[regime],
    payrollTaxPercent: payrollRate.ratePercent,
    configVersion: params.configVersion ?? TAX_CONFIG_VERSION,
  };
}

/** Ставки, которые требуют сверки с первоисточником. */
export function getUnverifiedRates(
  rates: TaxRateDefinition[] = DEFAULT_TAX_RATES,
): TaxRateDefinition[] {
  return rates.filter((r) => r.needsVerification === true);
}
