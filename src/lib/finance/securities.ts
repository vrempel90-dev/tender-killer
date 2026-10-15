/**
 * Обеспечение заявки и обеспечение исполнения договора.
 *
 * КРИТИЧНО: обеспечение — ВОЗВРАТНАЯ сумма, а не расход.
 *  • денежный залог → замораживает оборотные средства; расходом является только
 *    стоимость этих денег за срок блокировки (альтернативная доходность или
 *    процент по кредиту, которым залог профинансирован);
 *  • банковская гарантия → деньги не блокируются, расход = комиссия банка.
 */

import { mulMinor, percentOf } from '../money';
import type { SecurityInput } from './types';

export interface SecurityComputation {
  /** Сумма обеспечения, тиын (возвратная). */
  amountMinor: number;
  /** Сколько денег реально заморожено (только для денежного залога). */
  frozenCashMinor: number;
  /** Расход периода: комиссия за гарантию или стоимость замороженных денег. */
  costMinor: number;
  /** Срок блокировки/действия, дней. */
  heldDays: number;
  /** Расшифровка для интерфейса. */
  explanation: string;
}

const DAYS_IN_YEAR = 365;

/**
 * @param security             параметры обеспечения
 * @param baseMinor            база для процента (начальная цена или сумма договора)
 * @param ownCapitalRatePercent альтернативная стоимость собственных средств, % годовых
 */
export function computeSecurity(
  security: SecurityInput,
  baseMinor: number | null,
  ownCapitalRatePercent: number,
): SecurityComputation {
  if (security.form === 'NONE') {
    return {
      amountMinor: 0,
      frozenCashMinor: 0,
      costMinor: 0,
      heldDays: 0,
      explanation: 'Обеспечение не требуется.',
    };
  }

  let amountMinor = 0;
  if (security.amountMinor !== null && security.amountMinor > 0) {
    amountMinor = security.amountMinor;
  } else if (security.percentOfBase !== null && baseMinor !== null) {
    amountMinor = percentOf(baseMinor, security.percentOfBase);
  }

  const heldDays = security.heldDays ?? 0;

  if (security.form === 'CASH_DEPOSIT') {
    const cost = mulMinor(
      amountMinor,
      (ownCapitalRatePercent / 100) * (heldDays / DAYS_IN_YEAR),
    );
    return {
      amountMinor,
      frozenCashMinor: amountMinor,
      costMinor: cost,
      heldDays,
      explanation:
        `Денежный залог ${amountMinor / 100} ₸ заморожен на ${heldDays} дн. `
        + 'Сама сумма возвращается и расходом не является. '
        + `Расход — стоимость денег: сумма × ${ownCapitalRatePercent} % годовых × ${heldDays}/365.`,
    };
  }

  // BANK_GUARANTEE
  const feeVariable = mulMinor(
    amountMinor,
    (security.guaranteeFeePercentAnnual / 100) * (heldDays / DAYS_IN_YEAR),
  );
  const cost = feeVariable + security.guaranteeFeeFixedMinor;
  return {
    amountMinor,
    frozenCashMinor: 0,
    costMinor: cost,
    heldDays,
    explanation:
      `Банковская гарантия на ${amountMinor / 100} ₸, срок ${heldDays} дн. `
      + `Расход = ${security.guaranteeFeePercentAnnual} % годовых × ${heldDays}/365 `
      + 'от суммы гарантии + фиксированная комиссия. '
      + 'Собственные деньги не блокируются (если банк не требует покрытия).',
  };
}
