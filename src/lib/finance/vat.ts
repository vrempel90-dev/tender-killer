/**
 * Работа с НДС. Самая частая ошибка тендерных расчётов — считать входящий НДС
 * автоматически возмещаемым и смешивать цены с НДС и без НДС. Здесь это
 * разделено явно.
 */

import { mulMinor } from '../money';
import type { VatMode } from './types';

export interface VatSplit {
  /** Сумма без НДС. */
  netMinor: number;
  /** Сумма НДС. */
  vatMinor: number;
  /** Сумма с НДС. */
  grossMinor: number;
}

/**
 * Разложение суммы на «без НДС» и «НДС».
 *
 * @param amountMinor  введённая сумма
 * @param mode         INCLUSIVE — сумма уже содержит НДС; EXCLUSIVE — НДС сверху
 * @param vatRatePercent ставка НДС, %
 * @param vatApplies   начисляется ли НДС вообще (поставщик-неплательщик → false)
 */
export function splitVat(
  amountMinor: number,
  mode: VatMode,
  vatRatePercent: number,
  vatApplies: boolean,
): VatSplit {
  if (!Number.isFinite(amountMinor) || amountMinor === 0) {
    return { netMinor: 0, vatMinor: 0, grossMinor: 0 };
  }
  if (!vatApplies || vatRatePercent <= 0) {
    // НДС отсутствует: сумма одновременно и «без НДС», и «итого».
    return { netMinor: amountMinor, vatMinor: 0, grossMinor: amountMinor };
  }
  const rate = vatRatePercent / 100;
  if (mode === 'INCLUSIVE') {
    // net = gross / (1 + r)
    const net = Math.round(amountMinor / (1 + rate));
    return {
      netMinor: net,
      vatMinor: amountMinor - net,
      grossMinor: amountMinor,
    };
  }
  // EXCLUSIVE: НДС начисляется сверху
  const vat = mulMinor(amountMinor, rate);
  return {
    netMinor: amountMinor,
    vatMinor: vat,
    grossMinor: amountMinor + vat,
  };
}

/**
 * Разделение входящего НДС на зачитываемую и незачитываемую части.
 *
 * Зачёт возможен ТОЛЬКО если компания — плательщик НДС. Доля зачёта может быть
 * меньше 100 % при пропорциональном методе (наличие освобождённых оборотов).
 * Незачитываемая часть — реальный расход, она попадает в себестоимость.
 */
export function splitVatInput(
  vatInputMinor: number,
  isVatPayer: boolean,
  recoverySharePercent: number,
): { recoverableMinor: number; nonRecoverableMinor: number } {
  if (vatInputMinor <= 0) {
    return { recoverableMinor: 0, nonRecoverableMinor: 0 };
  }
  if (!isVatPayer) {
    return { recoverableMinor: 0, nonRecoverableMinor: vatInputMinor };
  }
  const share = Math.min(Math.max(recoverySharePercent, 0), 100) / 100;
  const recoverable = mulMinor(vatInputMinor, share);
  return {
    recoverableMinor: recoverable,
    nonRecoverableMinor: vatInputMinor - recoverable,
  };
}
