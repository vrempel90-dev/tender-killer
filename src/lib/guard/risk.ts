/**
 * TENDER GUARD: переоценка финансовых последствий изменения.
 *
 * Переоценка выполняется тем же расчётным ядром, что и обычный расчёт
 * (src/lib/finance/engine.ts): подставляются новые условия, модель
 * считается заново, и показывается разница. Никаких отдельных «оценок на
 * глаз» здесь нет — иначе цифры в предупреждении расходились бы с цифрами
 * в финансовом модуле.
 *
 * Чего переоценка НЕ делает: не придумывает новые затраты. Изменение
 * технического задания меняет состав работ, но во сколько это обойдётся,
 * знает только человек. Поэтому такое изменение помечается как требующее
 * ручного пересмотра, а не пересчитывается с выдуманными цифрами.
 */

import { calculateFinance } from '../finance/engine';
import type { FinanceInput, FinanceResult } from '../finance/types';
import type { DetectedChange } from './compare';

export type RiskVerdict =
  /** Переоценка невозможна: нет расчёта или нет данных. */
  | 'NOT_POSSIBLE'
  /** Изменения не влияют на расчёт. */
  | 'NO_FINANCIAL_EFFECT'
  /** Расчёт остаётся прибыльным, но прибыль изменилась. */
  | 'PROFIT_CHANGED'
  /** Прибыль стала отрицательной. */
  | 'NOW_LOSS'
  /** Изменение нельзя оценить автоматически, нужен ручной пересмотр. */
  | 'NEEDS_MANUAL_REVIEW';

export interface RiskFigures {
  netMinor: number;
  netRatio: number | null;
  minCumulativeMinor: number;
  bidPriceMinor: number | null;
}

export interface RiskReassessment {
  verdict: RiskVerdict;
  /** Что именно подставлено в расчёт. */
  applied: string[];
  /** Что осталось на человека. */
  manual: string[];
  before: RiskFigures | null;
  after: RiskFigures | null;
  deltaNetMinor: number | null;
  /** Предложение больше не может быть подано по прежней цене. */
  bidExceedsNewStartPrice: boolean;
  notes: string[];
}

function figures(result: FinanceResult, input: FinanceInput): RiskFigures {
  return {
    netMinor: result.profit.netMinor,
    netRatio: result.margins.netRatio,
    minCumulativeMinor: result.cashflow.minCumulativeMinor,
    bidPriceMinor: input.tender.bidPriceMinor,
  };
}

function formatMoney(minor: number): string {
  return `${(minor / 100).toLocaleString('ru-KZ', { maximumFractionDigits: 0 })} ₸`;
}

/**
 * Пересчитывает модель с учётом изменений.
 *
 * input — сохранённые исходные данные расчёта. Если расчёта нет,
 * переоценка невозможна, и об этом говорится прямо: показывать «всё в
 * порядке» там, где просто нечего считать, нельзя.
 */
export function reassessRisk(params: {
  input: FinanceInput | null;
  changes: DetectedChange[];
}): RiskReassessment {
  const { input, changes } = params;
  const applied: string[] = [];
  const manual: string[] = [];
  const notes: string[] = [];

  if (input === null) {
    return {
      verdict: 'NOT_POSSIBLE',
      applied: [],
      manual: changes.map((change) => change.summary),
      before: null,
      after: null,
      deltaNetMinor: null,
      bidExceedsNewStartPrice: false,
      notes: [
        'Финансовый расчёт по этому тендеру ещё не сохранён — переоценивать нечего. '
        + 'Выполните расчёт, и следующее изменение будет оценено автоматически.',
      ],
    };
  }

  // Копия исходных данных: исходный расчёт остаётся как был.
  const updated: FinanceInput = structuredClone(input);
  let changedInputs = false;
  let bidExceedsNewStartPrice = false;

  for (const change of changes) {
    switch (change.kind) {
      case 'START_PRICE_CHANGED': {
        const afterMinor = change.detail.afterMinor;
        if (typeof afterMinor !== 'number') break;
        updated.tender.startPriceMinor = afterMinor;
        applied.push(`начальная цена → ${formatMoney(afterMinor)}`);
        changedInputs = true;

        const bid = updated.tender.bidPriceMinor;
        if (bid !== null && bid > afterMinor) {
          // Предложение выше новой начальной цены подать нельзя. Считаем
          // по новой начальной цене, но говорим об этом прямо: это уже не
          // «та же заявка», а другое ценовое решение.
          bidExceedsNewStartPrice = true;
          updated.tender.bidPriceMinor = afterMinor;
          applied.push(
            `цена предложения ограничена новой начальной ценой: `
            + `${formatMoney(bid)} → ${formatMoney(afterMinor)}`,
          );
          notes.push(
            'Прежняя цена предложения выше новой начальной цены, подать её нельзя. '
            + 'Расчёт сделан по новой начальной цене — решение о цене нужно принять заново.',
          );
        }
        break;
      }

      case 'DELIVERY_DEADLINE_MOVED': {
        const shift = change.detail.shiftDays;
        if (typeof shift !== 'number' || shift === 0) break;
        const duration = updated.schedule.contractDurationDays;
        const delivery = updated.schedule.deliveryDay;
        if (duration !== null) {
          // Срок исполнения сдвигается на то же число дней, но не ниже дня
          // поставки: отрицательный срок расчётом не является.
          const next = Math.max(1, duration + shift);
          updated.schedule.contractDurationDays = next;
          applied.push(`срок исполнения договора → ${next} дн.`);
          changedInputs = true;
        }
        if (delivery !== null) {
          const next = Math.max(1, delivery + shift);
          updated.schedule.deliveryDay = next;
          applied.push(`день подписания акта → ${next}`);
          changedInputs = true;
        }
        if (duration === null && delivery === null) {
          manual.push(
            'Срок поставки изменился, но в расчёте не заданы срок исполнения и '
            + 'день акта — график платежей нужно задать вручную.',
          );
        }
        break;
      }

      case 'SPEC_CHANGED': {
        // Во сколько обойдутся новые требования, автоматика не знает.
        manual.push(
          `${change.summary}. Состав затрат нужно пересмотреть вручную: `
          + 'во сколько обойдутся новые требования, расчёт сам определить не может.',
        );
        break;
      }

      case 'SUBMISSION_DEADLINE_MOVED':
        // Срок подачи не входит в расчёт экономики сделки.
        break;

      default:
        manual.push(change.summary);
        break;
    }
  }

  if (!changedInputs) {
    const base = calculateFinance(input, { skipSensitivity: true });
    return {
      verdict: manual.length > 0 ? 'NEEDS_MANUAL_REVIEW' : 'NO_FINANCIAL_EFFECT',
      applied,
      manual,
      before: figures(base, input),
      after: null,
      deltaNetMinor: null,
      bidExceedsNewStartPrice,
      notes: manual.length > 0
        ? notes
        : [...notes, 'Изменения не затрагивают исходные данные расчёта.'],
    };
  }

  const beforeResult = calculateFinance(input, { skipSensitivity: true });
  const afterResult = calculateFinance(updated, { skipSensitivity: true });
  const before = figures(beforeResult, input);
  const after = figures(afterResult, updated);
  const delta = after.netMinor - before.netMinor;

  if (after.netMinor < 0 && before.netMinor >= 0) {
    notes.push(
      `После изменений расчёт уходит в убыток: ${formatMoney(before.netMinor)} → `
      + `${formatMoney(after.netMinor)}.`,
    );
  } else if (delta !== 0) {
    notes.push(
      `Расчётная чистая прибыль ${delta < 0 ? 'уменьшается' : 'увеличивается'} на `
      + `${formatMoney(Math.abs(delta))}: ${formatMoney(before.netMinor)} → `
      + `${formatMoney(after.netMinor)}.`,
    );
  }

  if (after.minCumulativeMinor < before.minCumulativeMinor) {
    notes.push(
      `Максимальная просадка денежного потока растёт: `
      + `${formatMoney(before.minCumulativeMinor)} → `
      + `${formatMoney(after.minCumulativeMinor)}. Потребность в оборотных средствах выше.`,
    );
  }

  // Переоценка выполнена по сохранённым данным: затраты остались прежними.
  notes.push(
    'Переоценка выполнена по ранее сохранённым затратам. Если изменились '
    + 'требования, проверьте состав затрат.',
  );

  const verdict: RiskVerdict = after.netMinor < 0
    ? 'NOW_LOSS'
    : manual.length > 0
      ? 'NEEDS_MANUAL_REVIEW'
      : delta === 0
        ? 'NO_FINANCIAL_EFFECT'
        : 'PROFIT_CHANGED';

  return {
    verdict,
    applied,
    manual,
    before,
    after,
    deltaNetMinor: delta,
    bidExceedsNewStartPrice,
    notes,
  };
}

export const VERDICT_LABELS: Record<RiskVerdict, string> = {
  NOT_POSSIBLE: 'Переоценка невозможна',
  NO_FINANCIAL_EFFECT: 'На расчёт не влияет',
  PROFIT_CHANGED: 'Прибыль изменилась',
  NOW_LOSS: 'Расчёт уходит в убыток',
  NEEDS_MANUAL_REVIEW: 'Нужен ручной пересмотр',
};
