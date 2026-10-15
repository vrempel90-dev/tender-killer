/**
 * Типы финансового движка TENDER KILLER.
 *
 * Денежные величины — целые числа в ТИЫН (1 ₸ = 100 тиын), поля с суффиксом
 * `Minor`. Это исключает накопление ошибок double при сложении десятков позиций.
 *
 * Поля, которые пользователь мог не заполнить, объявлены `| null`.
 * Движок НЕ подставляет вместо них выдуманные значения: он помечает показатель
 * как нерасчитываемый и возвращает запись в `missingInputs`.
 */

/** Режим налогообложения компании-поставщика. */
export type TaxRegimeCode =
  | 'GENERAL_VAT'
  | 'GENERAL_NO_VAT'
  | 'SIMPLIFIED'
  | 'RETAIL_TAX'
  | 'INDIVIDUAL_ENTREPRENEUR';

/** Трактовка введённой цены: включает НДС или нет. */
export type VatMode = 'INCLUSIVE' | 'EXCLUSIVE';

/** База налога на доход: прибыль (КПН) или оборот (упрощёнка, розничный налог). */
export type IncomeTaxBase = 'PROFIT' | 'TURNOVER';

/** Форма обеспечения. */
export type SecurityForm = 'NONE' | 'CASH_DEPOSIT' | 'BANK_GUARANTEE';

/** Налоговый контекст расчёта. Ставки приходят из конфигурации, не из кода. */
export interface TaxContextInput {
  regime: TaxRegimeCode;
  /** Плательщик НДС. Неплательщик НДС не выделяет НДС из своей цены. */
  isVatPayer: boolean;
  /**
   * Ставка НДС для СОБСТВЕННОЙ реализации, %. У неплательщика НДС = 0:
   * он не выделяет НДС из своей цены.
   */
  vatRatePercent: number;
  /**
   * Ставка НДС, по которой НДС выставляют ПОСТАВЩИКИ, %. Она не зависит от
   * статуса компании: поставщик-плательщик НДС предъявляет налог и
   * неплательщику. Для неплательщика этот НДС в зачёт не идёт и становится
   * расходом — поэтому его нужно видеть отдельной суммой, а не растворять
   * в цене закупки.
   */
  purchaseVatRatePercent: number;
  /**
   * Доля входящего НДС, принимаемая в зачёт, % (пропорциональный метод при
   * наличии освобождённых оборотов). Для неплательщика НДС всегда 0.
   */
  vatRecoverySharePercent: number;
  /** Ставка налога на доход, % (КПН / ИПН / ставка СНР). */
  incomeTaxRatePercent: number;
  /** От чего считается налог на доход. */
  incomeTaxBase: IncomeTaxBase;
  /** Налоги и отчисления с ФОТ, % от начисленного фонда оплаты труда. */
  payrollTaxPercent: number;
  /** Версия использованного налогового конфига (для прослеживаемости). */
  configVersion: string;
}

/** Простая затратная строка (услуга, доставка, накладные и т.п.). */
export interface SimpleCostLine {
  label: string;
  amountMinor: number;
  /** Сумма указана с НДС или без. */
  vatMode: VatMode;
  /** Поставщик выставляет НДС (т.е. во входящей цене есть НДС). */
  supplierChargesVat: boolean;
  /** Подтверждено документом (КП, счёт, прайс). Неподтверждённое помечается в отчёте. */
  verified: boolean;
  /** Доля предоплаты поставщику, % (для прогноза ДДС). */
  prepaymentPercent?: number;
  /** День оплаты относительно начала исполнения (для прогноза ДДС). */
  paymentDay?: number;
}

/** Товарная позиция с количеством. */
export interface ItemCostLine extends Omit<SimpleCostLine, 'amountMinor'> {
  quantity: number;
  unitCostMinor: number;
  unit?: string;
}

/** Таможенные платежи при импорте. */
export interface CustomsInput {
  isImport: boolean;
  /** Таможенная пошлина, тиын. */
  dutyMinor: number;
  /**
   * НДС на импорт, тиын. Учитывается отдельно: он платится на границе и
   * принимается в зачёт только плательщиком НДС.
   */
  importVatMinor: number;
  /** Сборы, услуги брокера, СВХ, тиын (без НДС по условию ввода). */
  feesMinor: number;
  feesVatMode: VatMode;
  feesSupplierChargesVat: boolean;
}

export interface PayrollInput {
  /** Начисленный ФОТ по проекту, тиын. НДС не содержит. */
  grossPayrollMinor: number;
  /**
   * Переопределение ставки налогов с ФОТ, %. Если null — берётся из налогового
   * контекста.
   */
  payrollTaxPercentOverride: number | null;
}

export interface CostsInput {
  items: ItemCostLine[];
  otherDirect: SimpleCostLine[];
  logistics: SimpleCostLine[];
  customs: CustomsInput;
  payroll: PayrollInput;
  subcontractors: SimpleCostLine[];
  overhead: SimpleCostLine[];
  /** Резерв на непредвиденные расходы, % от прямых и операционных затрат. */
  contingencyPercent: number;
}

export interface FinancingInput {
  /** Банковская комиссия, % от поступлений (РКО, эквайринг, переводы). */
  bankFeePercentOfRevenue: number;
  /** Фиксированные банковские расходы, тиын. */
  bankFeeFixedMinor: number;
  /**
   * Считать потребность в заёмных средствах автоматически из пикового
   * кассового разрыва.
   */
  autoFinancePeakGap: boolean;
  /** Сумма кредита, заданная вручную, тиын. */
  loanAmountMinor: number | null;
  /** Годовая ставка по кредиту, %. */
  loanAnnualRatePercent: number | null;
  /** Срок использования заёмных средств, дней. */
  loanTermDays: number | null;
  /**
   * Альтернативная стоимость собственных средств, % годовых. Применяется к
   * замороженным денежным обеспечениям: сам залог расходом НЕ является,
   * расход — только стоимость денег за время блокировки.
   */
  ownCapitalOpportunityRatePercent: number;
}

export interface SecurityInput {
  form: SecurityForm;
  /** Процент от базы (начальной цены — для заявки, суммы договора — для исполнения). */
  percentOfBase: number | null;
  /** Либо абсолютная сумма, тиын (приоритет над процентом). */
  amountMinor: number | null;
  /** Комиссия банка за гарантию, % годовых от суммы гарантии. */
  guaranteeFeePercentAnnual: number;
  /** Фиксированная комиссия за выдачу гарантии, тиын. */
  guaranteeFeeFixedMinor: number;
  /** Срок блокировки денег / действия гарантии, дней. */
  heldDays: number | null;
}

export interface ScheduleInput {
  /** Срок исполнения договора, дней. */
  contractDurationDays: number | null;
  /** Аванс заказчика, % от суммы договора. */
  advancePercent: number;
  /** День поступления аванса от начала исполнения. */
  advanceDay: number;
  /** День подписания акта выполненных работ / поставки. */
  deliveryDay: number | null;
  /** Срок поступления оплаты после подписания акта, дней. */
  paymentDelayDays: number | null;
  /** Гарантийное удержание заказчиком, % от суммы договора. */
  retentionPercent: number;
  /** Через сколько дней после акта возвращается удержание. */
  retentionReleaseDays: number | null;
  /** Доля предоплаты поставщикам, % (если у позиции не задано своё значение). */
  procurementPrepaymentPercent: number;
  /** День начала закупки. */
  procurementStartDay: number;
}

export interface WarrantyInput {
  /** Гарантийный срок, месяцев. */
  months: number | null;
  /** Резерв на гарантийные обязательства, % от выручки без НДС. */
  reservePercentOfRevenue: number;
}

export interface TargetsInput {
  /** Целевая чистая прибыль, тиын. */
  targetNetProfitMinor: number | null;
  /** Либо целевая чистая маржа, % от выручки без НДС. */
  targetNetMarginPercent: number | null;
}

export interface TenderPriceInput {
  /** Начальная (максимальная) цена закупки, тиын. */
  startPriceMinor: number | null;
  /** Планируемая цена предложения, тиын. */
  bidPriceMinor: number | null;
  /** Цена предложения указана с НДС или без. */
  bidPriceVatMode: VatMode;
  /** Начальная цена указана с НДС или без. */
  startPriceVatMode: VatMode;
  currency: string;
}

export interface FinanceInput {
  tender: TenderPriceInput;
  tax: TaxContextInput;
  costs: CostsInput;
  financing: FinancingInput;
  securities: {
    bid: SecurityInput;
    performance: SecurityInput;
  };
  schedule: ScheduleInput;
  warranty: WarrantyInput;
  targets: TargetsInput;
}

// ───────────────────────────── Результат расчёта ─────────────────────────────

/** Расшифровка показателя: что это, по какой формуле и из каких чисел. */
export interface FormulaExplanation {
  /** Машинный ключ показателя. */
  key: string;
  /** Название на русском. */
  label: string;
  /** Формула в читаемом виде. */
  formula: string;
  /** Подстановка фактических значений. */
  substitution: string;
  /** Что показатель означает и как читать. */
  meaning: string;
  /** Оговорки и ограничения расчёта. */
  caveat?: string;
}

/** Незаполненное входное поле, из-за которого показатель не считается. */
export interface MissingInput {
  field: string;
  label: string;
  /** Какие показатели недоступны без этого поля. */
  affects: string[];
}

export type WarningSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface CalcWarning {
  code: string;
  severity: WarningSeverity;
  message: string;
}

export interface RevenueBreakdown {
  /** Выручка с НДС (сумма договора к оплате заказчиком). */
  grossMinor: number;
  /** Выручка без НДС — именно она является доходом компании. */
  netMinor: number;
  /** НДС с реализации (исходящий). У неплательщика НДС = 0. */
  vatOutputMinor: number;
}

export interface CostBreakdown {
  /** Прямые затраты на товары/материалы без НДС. */
  directItemsNetMinor: number;
  /** Прочие прямые затраты без НДС. */
  otherDirectNetMinor: number;
  /** Логистика и доставка без НДС. */
  logisticsNetMinor: number;
  /** Таможенная пошлина и сборы (пошлина в зачёт не принимается). */
  customsMinor: number;
  /** Начисленный ФОТ. */
  payrollMinor: number;
  /** Налоги и отчисления с ФОТ. */
  payrollTaxesMinor: number;
  /** Субподряд без НДС. */
  subcontractorsNetMinor: number;
  /** Накладные расходы без НДС. */
  overheadNetMinor: number;
  /** Резерв на непредвиденные расходы. */
  contingencyMinor: number;
  /** Весь входящий НДС по затратам. */
  vatInputTotalMinor: number;
  /** Входящий НДС, принимаемый в зачёт. */
  vatRecoverableMinor: number;
  /**
   * Входящий НДС, который в зачёт НЕ принимается и поэтому является
   * реальным расходом (неплательщик НДС, пропорциональный зачёт).
   */
  vatNonRecoverableMinor: number;
  /** Банковские комиссии. */
  bankFeesMinor: number;
  /** Проценты по заёмным средствам. */
  financingCostMinor: number;
  /** Стоимость обеспечений: комиссии за гарантии + стоимость замороженных денег. */
  securityCostMinor: number;
  /** Резерв на гарантийные обязательства. */
  warrantyReserveMinor: number;
  /** Полная себестоимость исполнения (всё перечисленное выше, без возвратных залогов). */
  totalMinor: number;
}

export interface ProfitBreakdown {
  /** Валовая прибыль = выручка без НДС − прямые затраты. */
  grossMinor: number;
  /** Операционная прибыль = валовая − ФОТ − накладные − резервы − невозмещаемый НДС. */
  operatingMinor: number;
  /** Прибыль до налогообложения = операционная − финансовые расходы. */
  preTaxMinor: number;
  /** Налог на доход (КПН/ИПН или налог с оборота на СНР). */
  incomeTaxMinor: number;
  /** Расчётная чистая прибыль. Это НЕ денежный поток. */
  netMinor: number;
}

export interface VatSettlement {
  outputMinor: number;
  recoverableInputMinor: number;
  /** НДС к уплате в бюджет (может быть отрицательным — превышение зачёта). */
  payableMinor: number;
}

export interface MarginSet {
  /** Валовая маржа к выручке без НДС. */
  grossRatio: number | null;
  operatingRatio: number | null;
  /** Рентабельность продаж: чистая прибыль / выручка без НДС. */
  netRatio: number | null;
  /** Чистая прибыль / выручка с НДС (для сравнения с ценой договора). */
  netOnGrossRatio: number | null;
}

export interface RoiResult {
  /** Инвестированный капитал: пиковая потребность собственных средств. */
  investedCapitalMinor: number | null;
  ratio: number | null;
  /** Годовая доходность с учётом срока проекта. */
  annualizedRatio: number | null;
}

export interface BreakEvenResult {
  /** Цена предложения (с НДС), при которой чистая прибыль = 0. */
  priceMinor: number | null;
  /** Насколько текущая цена выше безубыточной, доля. */
  marginOverBreakEvenRatio: number | null;
  /** Максимально допустимое снижение от начальной цены, доля. */
  maxDiscountFromStartRatio: number | null;
  solved: boolean;
  note?: string;
}

export interface TargetPriceResult {
  priceMinor: number | null;
  basis: 'PROFIT_AMOUNT' | 'MARGIN_PERCENT' | null;
  targetNetProfitMinor: number | null;
  solved: boolean;
  note?: string;
}

export interface CashflowPeriod {
  /** Номер дня от начала исполнения. */
  day: number;
  label: string;
  inflowMinor: number;
  outflowMinor: number;
  netMinor: number;
  cumulativeMinor: number;
  /** Расшифровка движений этого дня. */
  entries: Array<{ label: string; amountMinor: number; kind: 'IN' | 'OUT' }>;
}

export interface WorkingCapitalResult {
  /** Потребность в оборотном капитале: максимум отрицательного кумулятива. */
  requirementMinor: number;
  /** Пиковый кассовый разрыв (та же величина, со знаком минус в потоке). */
  peakGapMinor: number;
  /** День, когда наступает пиковый разрыв. */
  peakGapDay: number | null;
  /** Сколько денег заморожено в обеспечениях (возвратная сумма, не расход). */
  frozenSecuritiesMinor: number;
  /** Сколько дней деньги в дефиците. */
  daysInDeficit: number;
}

export interface SensitivityRow {
  /** Изменение фактора, % (отрицательное — снижение). */
  changePercent: number;
  priceMinor: number | null;
  netProfitMinor: number | null;
  netMarginRatio: number | null;
  /** Остаётся ли сделка прибыльной. */
  isProfitable: boolean;
}

export interface SensitivityResult {
  priceDrop: SensitivityRow[];
  costIncrease: SensitivityRow[];
  /** Снижение цены, при котором прибыль становится нулевой, доля от текущей цены. */
  priceDropToZeroRatio: number | null;
  /** Рост затрат, при котором прибыль становится нулевой, доля. */
  costIncreaseToZeroRatio: number | null;
}

export interface FinanceResult {
  engineVersion: string;
  taxConfigVersion: string;
  calculatedAt: string;
  revenue: RevenueBreakdown;
  costs: CostBreakdown;
  profit: ProfitBreakdown;
  vat: VatSettlement;
  margins: MarginSet;
  roi: RoiResult;
  breakEven: BreakEvenResult;
  targetPrice: TargetPriceResult;
  workingCapital: WorkingCapitalResult;
  cashflow: {
    periods: CashflowPeriod[];
    /** Итоговый денежный поток проекта (не равен чистой прибыли). */
    netCashMinor: number;
    minCumulativeMinor: number;
    /** Разница между чистой прибылью и денежным потоком с пояснением. */
    profitVsCashDeltaMinor: number;
  };
  sensitivity: SensitivityResult;
  explanations: FormulaExplanation[];
  missingInputs: MissingInput[];
  warnings: CalcWarning[];
  /** Доля подтверждённых документами затрат в полной себестоимости. */
  verifiedCostShareRatio: number | null;
  /** Суммы, введённые без подтверждения документом. */
  unverifiedCostMinor: number;
}

/** Сценарий расчёта. */
export type ScenarioCode = 'OPTIMISTIC' | 'BASE' | 'STRESS';

export interface ScenarioAdjustment {
  code: ScenarioCode;
  label: string;
  description: string;
  /** Множитель цены предложения. */
  priceFactor: number;
  /** Множитель всех затрат. */
  costFactor: number;
  /** Дополнительная задержка оплаты, дней. */
  paymentDelayAddDays: number;
  /** Множитель резерва на непредвиденные расходы. */
  contingencyFactor: number;
}

export interface ScenarioResult {
  code: ScenarioCode;
  label: string;
  description: string;
  adjustment: ScenarioAdjustment;
  result: FinanceResult;
}
