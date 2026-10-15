/**
 * TENDER RADAR: сопоставление закупки с профилем компании.
 *
 * Оценка считается правилами, а не моделью. Причина простая: пользователь
 * должен видеть, ПОЧЕМУ закупка показана или отсеяна, и иметь возможность
 * не согласиться. Поэтому каждая проверка возвращает причину с её вкладом,
 * а итог складывается из них арифметически.
 *
 * Отдельно различаются два исхода:
 *  - blockers — закупка не подходит (участие невозможно или запрещено
 *    профилем). Такие не «понижаются в рейтинге», а исключаются;
 *  - reasons — вклад в оценку соответствия, положительный и отрицательный.
 *
 * Оценка — не вероятность победы и не рекомендация. Это мера совпадения
 * закупки с тем, что компания про себя указала.
 */

export interface MatchProfile {
  keywords: string[];
  excludedKeywords: string[];
  regions: string[];
  procurementTypes: string[];
  minPriceMinor: number | null;
  maxPriceMinor: number | null;
  minDeliveryDays: number | null;
  excludedCustomerBins: string[];
  preferredCustomerBins: string[];
  minDaysToDeadline: number | null;
}

export interface MatchCandidate {
  title: string;
  customerBin: string | null;
  priceMinor: number | null;
  procurementType: string;
  region: string | null;
  deadline: Date | null;
  deliveryDeadline: Date | null;
}

export type MatchReasonCode =
  | 'KEYWORD_HIT'
  | 'NO_KEYWORD_HIT'
  | 'REGION_HIT'
  | 'REGION_OTHER'
  | 'PRICE_IN_RANGE'
  | 'PRICE_UNKNOWN'
  | 'TYPE_ALLOWED'
  | 'PREFERRED_CUSTOMER'
  | 'DEADLINE_COMFORTABLE'
  | 'DEADLINE_TIGHT'
  | 'DEADLINE_UNKNOWN'
  | 'DELIVERY_TIGHT'
  | 'DELIVERY_UNKNOWN';

export type MatchBlockerCode =
  | 'EXCLUDED_KEYWORD'
  | 'EXCLUDED_CUSTOMER'
  | 'PRICE_BELOW_MIN'
  | 'PRICE_ABOVE_MAX'
  | 'TYPE_NOT_ALLOWED'
  | 'REGION_NOT_ALLOWED'
  | 'DEADLINE_PASSED'
  | 'DEADLINE_TOO_SOON'
  | 'DELIVERY_TOO_SHORT';

export interface MatchReason {
  code: MatchReasonCode;
  /** Вклад в оценку: может быть отрицательным. */
  weight: number;
  /** Текст для пользователя — объясняет конкретный вклад. */
  detail: string;
}

export interface MatchBlocker {
  code: MatchBlockerCode;
  detail: string;
}

export interface MatchResult {
  /** 0–100. Имеет смысл только при пустом blockers. */
  score: number;
  suitable: boolean;
  reasons: MatchReason[];
  blockers: MatchBlocker[];
  /** Ключевые слова профиля, найденные в наименовании. */
  matchedKeywords: string[];
}

/**
 * Вклад проверок в оценку. Сумма положительных вкладов равна 100, поэтому
 * оценка читается как процент совпадения, а не как абстрактные баллы.
 */
const WEIGHTS = {
  keyword: 45,
  region: 15,
  price: 15,
  type: 10,
  preferredCustomer: 10,
  deadline: 5,
} as const;

const DAY_MS = 86_400_000;

function normalize(value: string): string {
  // Приведение к нижнему регистру и схлопывание пробелов: в выгрузках
  // наименования приходят с разным форматированием и переносами.
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Слова строки без знаков препинания. */
function tokenize(value: string): string[] {
  return normalize(value)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0);
}

/**
 * Основа слова для сравнения по словоформам.
 *
 * В выгрузках предмет закупки стоит в родительном падеже («поставка
 * кабеля»), а в профиле компания пишет слово в именительном («кабель»).
 * Прямое сравнение подстрок такие пары не находит: «кабеля» не содержит
 * «кабель». Отсечение двух последних букв с сохранением минимум четырёх
 * решает практически все случаи русской словоизменительной морфологии и,
 * в отличие от полноценного стеммера, не требует словаря и предсказуемо.
 */
function stem(word: string): string {
  return word.slice(0, Math.max(4, word.length - 2));
}

/** Совпадает ли слово профиля с каким-нибудь словом строки. */
function tokenMatches(haystack: string[], needle: string): boolean {
  const root = stem(needle);
  return haystack.some(
    (token) => token.startsWith(root) || needle.startsWith(stem(token)),
  );
}

/**
 * Совпадает ли выражение профиля (возможно, из нескольких слов) со
 * строкой. Для словосочетания требуются все его слова — иначе
 * «монтаж систем видеонаблюдения» совпадал бы с любым монтажом.
 */
function phraseMatches(text: string, phrase: string): boolean {
  const words = tokenize(phrase);
  if (words.length === 0) return false;
  const tokens = tokenize(text);
  return words.every((word) => tokenMatches(tokens, word));
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

function formatMoney(minor: number): string {
  return `${(minor / 100).toLocaleString('ru-KZ', { maximumFractionDigits: 0 })} ₸`;
}

/**
 * Считает соответствие закупки профилю.
 *
 * now передаётся явно: оценка зависит от текущей даты (сроки), и в тестах
 * это должно быть воспроизводимо.
 */
export function matchOpportunity(
  profile: MatchProfile,
  candidate: MatchCandidate,
  now: Date = new Date(),
): MatchResult {
  const reasons: MatchReason[] = [];
  const blockers: MatchBlocker[] = [];

  // ── Запрещающие проверки ────────────────────────────────────────────────

  const excluded = profile.excludedKeywords.filter(
    (phrase) => phrase.trim().length > 0 && phraseMatches(candidate.title, phrase),
  );
  if (excluded.length > 0) {
    blockers.push({
      code: 'EXCLUDED_KEYWORD',
      detail: `В наименовании есть исключённое слово: ${excluded.join(', ')}`,
    });
  }

  if (
    candidate.customerBin !== null
    && profile.excludedCustomerBins.includes(candidate.customerBin)
  ) {
    blockers.push({
      code: 'EXCLUDED_CUSTOMER',
      detail: `Заказчик ${candidate.customerBin} в списке исключённых`,
    });
  }

  if (candidate.priceMinor !== null) {
    if (profile.minPriceMinor !== null && candidate.priceMinor < profile.minPriceMinor) {
      blockers.push({
        code: 'PRICE_BELOW_MIN',
        detail: `Сумма ${formatMoney(candidate.priceMinor)} ниже минимальной `
          + `${formatMoney(profile.minPriceMinor)}`,
      });
    }
    if (profile.maxPriceMinor !== null && candidate.priceMinor > profile.maxPriceMinor) {
      blockers.push({
        code: 'PRICE_ABOVE_MAX',
        detail: `Сумма ${formatMoney(candidate.priceMinor)} выше максимальной `
          + `${formatMoney(profile.maxPriceMinor)}`,
      });
    }
  }

  if (
    profile.procurementTypes.length > 0
    && !profile.procurementTypes.includes(candidate.procurementType)
  ) {
    blockers.push({
      code: 'TYPE_NOT_ALLOWED',
      detail: 'Способ закупки не входит в список допустимых в профиле',
    });
  }

  if (candidate.deadline !== null) {
    const days = daysBetween(now, candidate.deadline);
    if (days < 0) {
      blockers.push({
        code: 'DEADLINE_PASSED',
        detail: `Приём заявок закончился ${-days} дн. назад`,
      });
    } else if (profile.minDaysToDeadline !== null && days < profile.minDaysToDeadline) {
      blockers.push({
        code: 'DEADLINE_TOO_SOON',
        detail: `До окончания приёма ${days} дн., профиль требует не менее `
          + `${profile.minDaysToDeadline}`,
      });
    }
  }

  if (
    candidate.deliveryDeadline !== null
    && profile.minDeliveryDays !== null
  ) {
    const days = daysBetween(now, candidate.deliveryDeadline);
    if (days < profile.minDeliveryDays) {
      blockers.push({
        code: 'DELIVERY_TOO_SHORT',
        detail: `На поставку остаётся ${days} дн., профиль требует не менее `
          + `${profile.minDeliveryDays}`,
      });
    }
  }

  // ── Вклад в оценку ──────────────────────────────────────────────────────

  const keywords = profile.keywords.filter((word) => word.trim().length > 0);
  const matchedKeywords = keywords.filter((phrase) =>
    phraseMatches(candidate.title, phrase));
  if (keywords.length === 0) {
    // Профиль не заполнен: совпадение по предмету неизвестно, а не полное.
    reasons.push({
      code: 'NO_KEYWORD_HIT',
      weight: 0,
      detail: 'В профиле не указано, что поставляет компания — отбор по предмету не выполнялся',
    });
  } else if (matchedKeywords.length > 0) {
    // Несколько совпадений надёжнее одного, но вклад ограничен: иначе
    // длинное наименование с повторами перевешивало бы всё остальное.
    const share = Math.min(1, matchedKeywords.length / 2);
    reasons.push({
      code: 'KEYWORD_HIT',
      weight: Math.round(WEIGHTS.keyword * (0.6 + 0.4 * share)),
      detail: `Совпадение по предмету: ${matchedKeywords.join(', ')}`,
    });
  } else {
    reasons.push({
      code: 'NO_KEYWORD_HIT',
      weight: 0,
      detail: 'Наименование не содержит ни одного ключевого слова профиля',
    });
  }

  if (profile.regions.length === 0) {
    reasons.push({
      code: 'REGION_HIT',
      weight: WEIGHTS.region,
      detail: 'Профиль не ограничивает регионы',
    });
  } else if (candidate.region === null) {
    reasons.push({
      code: 'REGION_OTHER',
      weight: 0,
      detail: 'Регион в выгрузке не указан — проверьте по объявлению',
    });
  } else {
    const region = candidate.region;
    const hit = profile.regions.some((item) => phraseMatches(region, item));
    reasons.push(
      hit
        ? {
          code: 'REGION_HIT',
          weight: WEIGHTS.region,
          detail: `Регион подходит: ${candidate.region}`,
        }
        : {
          code: 'REGION_OTHER',
          weight: 0,
          detail: `Регион вне профиля: ${candidate.region}`,
        },
    );
  }

  if (candidate.priceMinor === null) {
    reasons.push({
      code: 'PRICE_UNKNOWN',
      weight: 0,
      detail: 'Плановая сумма в выгрузке не указана',
    });
  } else {
    reasons.push({
      code: 'PRICE_IN_RANGE',
      weight: WEIGHTS.price,
      detail: `Сумма в допустимых границах: ${formatMoney(candidate.priceMinor)}`,
    });
  }

  if (profile.procurementTypes.length > 0) {
    reasons.push({
      code: 'TYPE_ALLOWED',
      weight: WEIGHTS.type,
      detail: 'Способ закупки допустим профилем',
    });
  } else {
    reasons.push({
      code: 'TYPE_ALLOWED',
      weight: WEIGHTS.type,
      detail: 'Профиль не ограничивает способ закупки',
    });
  }

  if (
    candidate.customerBin !== null
    && profile.preferredCustomerBins.includes(candidate.customerBin)
  ) {
    reasons.push({
      code: 'PREFERRED_CUSTOMER',
      weight: WEIGHTS.preferredCustomer,
      detail: `Знакомый заказчик: ${candidate.customerBin}`,
    });
  }

  if (candidate.deadline === null) {
    reasons.push({
      code: 'DEADLINE_UNKNOWN',
      weight: 0,
      detail: 'Срок окончания приёма заявок в выгрузке не указан',
    });
  } else {
    const days = daysBetween(now, candidate.deadline);
    reasons.push(
      days >= 7
        ? {
          code: 'DEADLINE_COMFORTABLE',
          weight: WEIGHTS.deadline,
          detail: `До окончания приёма ${days} дн.`,
        }
        : {
          code: 'DEADLINE_TIGHT',
          weight: 0,
          detail: `До окончания приёма ${days} дн. — срок сжатый`,
        },
    );
  }

  if (candidate.deliveryDeadline === null) {
    reasons.push({
      code: 'DELIVERY_UNKNOWN',
      weight: 0,
      detail: 'Срок поставки в выгрузке не указан',
    });
  } else if (daysBetween(now, candidate.deliveryDeadline) < 14) {
    reasons.push({
      code: 'DELIVERY_TIGHT',
      weight: 0,
      detail: `На поставку остаётся ${daysBetween(now, candidate.deliveryDeadline)} дн.`,
    });
  }

  const score = Math.max(
    0,
    Math.min(100, reasons.reduce((sum, reason) => sum + reason.weight, 0)),
  );

  return {
    score,
    suitable: blockers.length === 0,
    reasons,
    blockers,
    matchedKeywords,
  };
}

/** Короткая словесная оценка — чтобы число не выглядело точнее, чем оно есть. */
export function scoreLabel(score: number): 'ВЫСОКОЕ' | 'СРЕДНЕЕ' | 'НИЗКОЕ' {
  if (score >= 70) return 'ВЫСОКОЕ';
  if (score >= 40) return 'СРЕДНЕЕ';
  return 'НИЗКОЕ';
}
