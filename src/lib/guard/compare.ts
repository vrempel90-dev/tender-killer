/**
 * TENDER GUARD: сравнение двух редакций условий закупки.
 *
 * Ограничение, которое важно понимать: приложение не узнаёт об изменении
 * само. Автоматического доступа к порталам нет, поэтому новую редакцию
 * приносит пользователь — загружает документ или вносит новые сроки.
 * GUARD фиксирует редакции, сравнивает их и говорит, что именно
 * изменилось и чем это грозит расчёту.
 *
 * Сравнение — чистые функции без обращения к БД: правило значимости
 * изменений должно проверяться тестами и быть одинаковым везде.
 */

import { createHash } from 'node:crypto';

export type ChangeSeverity = 'CRITICAL' | 'MAJOR' | 'MINOR' | 'INFO';

export type ChangeKind =
  | 'SUBMISSION_DEADLINE_MOVED'
  | 'DELIVERY_DEADLINE_MOVED'
  | 'START_PRICE_CHANGED'
  | 'SPEC_CHANGED'
  | 'DOCUMENT_REPLACED'
  | 'DOCUMENT_ADDED'
  | 'PROCUREMENT_CANCELLED'
  | 'OTHER';

export interface Snapshot {
  submissionDeadline: Date | null;
  deliveryDeadline: Date | null;
  startPriceMinor: number | null;
  /** Нормализованный текст технического задания. */
  specText: string | null;
}

export interface SpecDiff {
  /** Доля совпадения текстов, 0–1. */
  similarity: number;
  addedLines: string[];
  removedLines: string[];
  addedCount: number;
  removedCount: number;
}

export interface DetectedChange {
  kind: ChangeKind;
  severity: ChangeSeverity;
  summary: string;
  detail: Record<string, unknown>;
  /** Нужно ли пересчитать финансовую модель. */
  requiresRecalc: boolean;
}

const DAY_MS = 86_400_000;

/** Отпечаток текста задания: по нему видно, менялся ли он вообще. */
export function specHash(text: string): string {
  return createHash('sha256').update(normalizeSpec(text)).digest('hex');
}

/**
 * Приведение текста к сравнимому виду.
 *
 * Между редакциями меняется вёрстка: переносы, двойные пробелы, номера
 * страниц, вставленные парсером. Без нормализации каждая перезагрузка
 * одного и того же документа выглядела бы как изменение задания.
 */
export function normalizeSpec(text: string): string {
  return text
    .replace(/---\s*стр\.\s*\d+\s*---/gi, '\n')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\u00a0]+/g, ' ')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n')
    .toLowerCase();
}

/** Содержательные строки текста задания. */
function specLines(text: string): string[] {
  return normalizeSpec(text)
    .split('\n')
    // Строки короче трёх символов — нумерация и мусор парсера.
    .filter((line) => line.length >= 3);
}

/** Сколько содержательных требований в тексте задания. */
export function countSpecLines(text: string): number {
  return specLines(text).length;
}

/**
 * Различия текста задания по строкам.
 *
 * Сравнение по множествам строк, а не посимвольный diff: техническое
 * задание — это перечень требований, и важно, какие требования появились
 * или исчезли, а не как переставлены слова.
 */
export function diffSpec(before: string, after: string): SpecDiff {
  const beforeLines = specLines(before);
  const afterLines = specLines(after);
  const beforeSet = new Set(beforeLines);
  const afterSet = new Set(afterLines);

  const added = afterLines.filter((line) => !beforeSet.has(line));
  const removed = beforeLines.filter((line) => !afterSet.has(line));

  const union = new Set([...beforeSet, ...afterSet]);
  let common = 0;
  for (const line of beforeSet) if (afterSet.has(line)) common += 1;
  const similarity = union.size === 0 ? 1 : common / union.size;

  return {
    similarity,
    // Наружу отдаём ограниченный набор: иначе в журнал уедет весь документ.
    addedLines: added.slice(0, 20),
    removedLines: removed.slice(0, 20),
    addedCount: added.length,
    removedCount: removed.length,
  };
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function formatMoney(minor: number): string {
  return `${(minor / 100).toLocaleString('ru-KZ', { maximumFractionDigits: 0 })} ₸`;
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

/**
 * Значимость сдвига срока подачи.
 *
 * Перенос назад (срок стал раньше) опаснее переноса вперёд: времени на
 * подготовку становится меньше, а заявка может просто не успеть.
 */
function deadlineSeverity(shiftDays: number, daysLeftAfter: number): ChangeSeverity {
  if (shiftDays < 0) {
    // Срок сдвинут на более раннюю дату.
    if (daysLeftAfter <= 0) return 'CRITICAL';
    if (daysLeftAfter <= 3 || shiftDays <= -7) return 'CRITICAL';
    return 'MAJOR';
  }
  return shiftDays >= 7 ? 'MINOR' : 'INFO';
}

export interface CompareOptions {
  /** Текущий момент: от него считается остаток времени до срока. */
  now?: Date;
  /**
   * Порог значимости изменения цены, доля. По умолчанию 1%: меньшие
   * расхождения обычно вызваны переоформлением документов.
   */
  priceThreshold?: number;
  /**
   * Совпадение, ниже которого задание считается переписанным. По
   * умолчанию 0,7.
   */
  specCriticalSimilarity?: number;
  /**
   * Доля изменённых требований, с которой изменение считается
   * существенным. По умолчанию 3%.
   */
  specMajorRatio?: number;
  /**
   * Количество изменённых требований, с которого изменение считается
   * существенным независимо от доли. По умолчанию 3: в длинном задании
   * три новых требования — это уже другой объём работ.
   */
  specMajorLines?: number;
}

/**
 * Сравнивает две редакции и возвращает перечень изменений.
 *
 * Пустой перечень означает, что контролируемые условия не изменились —
 * это отдельный и нормальный результат, а не отсутствие проверки.
 */
export function compareSnapshots(
  before: Snapshot,
  after: Snapshot,
  options: CompareOptions = {},
): DetectedChange[] {
  const now = options.now ?? new Date();
  const priceThreshold = options.priceThreshold ?? 0.01;
  const specCritical = options.specCriticalSimilarity ?? 0.7;
  const specMajorRatio = options.specMajorRatio ?? 0.03;
  const specMajorLines = options.specMajorLines ?? 3;
  const changes: DetectedChange[] = [];

  // ── Срок подачи заявки ──────────────────────────────────────────────────
  if (
    before.submissionDeadline !== null
    && after.submissionDeadline !== null
    && before.submissionDeadline.getTime() !== after.submissionDeadline.getTime()
  ) {
    const shift = daysBetween(before.submissionDeadline, after.submissionDeadline);
    const daysLeft = daysBetween(now, after.submissionDeadline);
    changes.push({
      kind: 'SUBMISSION_DEADLINE_MOVED',
      severity: deadlineSeverity(shift, daysLeft),
      summary: shift < 0
        ? `Срок подачи заявки сдвинут на ${-shift} дн. раньше: до ${formatDate(after.submissionDeadline)}`
        : `Срок подачи заявки продлён на ${shift} дн.: до ${formatDate(after.submissionDeadline)}`,
      detail: {
        before: formatDate(before.submissionDeadline),
        after: formatDate(after.submissionDeadline),
        shiftDays: shift,
        daysLeft,
      },
      // Срок подачи сам по себе не меняет экономику сделки.
      requiresRecalc: false,
    });
  } else if (before.submissionDeadline === null && after.submissionDeadline !== null) {
    changes.push({
      kind: 'SUBMISSION_DEADLINE_MOVED',
      severity: 'MAJOR',
      summary: `Появился срок подачи заявки: ${formatDate(after.submissionDeadline)}`,
      detail: { before: null, after: formatDate(after.submissionDeadline) },
      requiresRecalc: false,
    });
  }

  // ── Срок поставки ───────────────────────────────────────────────────────
  if (
    before.deliveryDeadline !== null
    && after.deliveryDeadline !== null
    && before.deliveryDeadline.getTime() !== after.deliveryDeadline.getTime()
  ) {
    const shift = daysBetween(before.deliveryDeadline, after.deliveryDeadline);
    changes.push({
      kind: 'DELIVERY_DEADLINE_MOVED',
      severity: shift < 0 ? 'CRITICAL' : 'MAJOR',
      summary: shift < 0
        ? `Срок поставки сокращён на ${-shift} дн.: до ${formatDate(after.deliveryDeadline)}`
        : `Срок поставки продлён на ${shift} дн.: до ${formatDate(after.deliveryDeadline)}`,
      detail: {
        before: formatDate(before.deliveryDeadline),
        after: formatDate(after.deliveryDeadline),
        shiftDays: shift,
      },
      // Срок поставки меняет график платежей и потребность в оборотных
      // средствах, поэтому расчёт устаревает.
      requiresRecalc: true,
    });
  } else if (before.deliveryDeadline === null && after.deliveryDeadline !== null) {
    changes.push({
      kind: 'DELIVERY_DEADLINE_MOVED',
      severity: 'MAJOR',
      summary: `Появился срок поставки: ${formatDate(after.deliveryDeadline)}`,
      detail: { before: null, after: formatDate(after.deliveryDeadline) },
      requiresRecalc: true,
    });
  }

  // ── Начальная цена ──────────────────────────────────────────────────────
  if (
    before.startPriceMinor !== null
    && after.startPriceMinor !== null
    && before.startPriceMinor !== after.startPriceMinor
  ) {
    const delta = after.startPriceMinor - before.startPriceMinor;
    const ratio = before.startPriceMinor === 0
      ? 1
      : Math.abs(delta) / before.startPriceMinor;
    const significant = ratio >= priceThreshold;
    changes.push({
      kind: 'START_PRICE_CHANGED',
      severity: significant ? (delta < 0 ? 'CRITICAL' : 'MAJOR') : 'MINOR',
      summary: `Начальная цена ${delta < 0 ? 'снижена' : 'повышена'} на `
        + `${formatMoney(Math.abs(delta))} (${(ratio * 100).toFixed(1)}%): `
        + `${formatMoney(before.startPriceMinor)} → ${formatMoney(after.startPriceMinor)}`,
      detail: {
        beforeMinor: before.startPriceMinor,
        afterMinor: after.startPriceMinor,
        deltaMinor: delta,
        ratio,
      },
      requiresRecalc: significant,
    });
  } else if (before.startPriceMinor === null && after.startPriceMinor !== null) {
    changes.push({
      kind: 'START_PRICE_CHANGED',
      severity: 'MAJOR',
      summary: `Появилась начальная цена: ${formatMoney(after.startPriceMinor)}`,
      detail: { beforeMinor: null, afterMinor: after.startPriceMinor },
      requiresRecalc: true,
    });
  }

  // ── Техническое задание ─────────────────────────────────────────────────
  if (before.specText !== null && after.specText !== null) {
    const diff = diffSpec(before.specText, after.specText);
    const changedLines = diff.addedCount + diff.removedCount;
    // Любое появившееся или исчезнувшее требование — это изменение.
    // Порога «почти одинаково» здесь нет намеренно: он прятал бы реальные
    // правки. Величину выражает значимость, а не факт.
    if (changedLines > 0) {
      const baseLines = Math.max(1, countSpecLines(before.specText));
      const ratio = changedLines / baseLines;
      // Переписанное задание может означать другой предмет закупки.
      const severity: ChangeSeverity = diff.similarity < specCritical
        ? 'CRITICAL'
        : ratio >= specMajorRatio || changedLines >= specMajorLines
          ? 'MAJOR'
          : 'MINOR';
      changes.push({
        kind: 'SPEC_CHANGED',
        severity,
        summary: `Техническое задание изменено: совпадение `
          + `${(diff.similarity * 100).toFixed(0)}%, добавлено требований `
          + `${diff.addedCount}, удалено ${diff.removedCount}`,
        detail: {
          similarity: diff.similarity,
          addedCount: diff.addedCount,
          removedCount: diff.removedCount,
          changedRatio: ratio,
          addedLines: diff.addedLines,
          removedLines: diff.removedLines,
        },
        // Изменение состава требований меняет состав затрат.
        requiresRecalc: severity !== 'MINOR',
      });
    }
  } else if (before.specText === null && after.specText !== null) {
    changes.push({
      kind: 'DOCUMENT_ADDED',
      severity: 'INFO',
      summary: 'Добавлено техническое задание: сравнивать пока не с чем',
      detail: { charCount: after.specText.length },
      requiresRecalc: false,
    });
  } else if (before.specText !== null && after.specText === null) {
    // Пропавший текст — это не «задание не менялось»: сравнение невозможно.
    changes.push({
      kind: 'DOCUMENT_REPLACED',
      severity: 'MAJOR',
      summary: 'В новой редакции нет текста технического задания — '
        + 'сравнение невозможно, проверьте документ вручную',
      detail: { reason: 'spec text missing in new revision' },
      requiresRecalc: false,
    });
  }

  return changes;
}

/** Наивысшая значимость в перечне — для сводки по наблюдению. */
export function highestSeverity(changes: DetectedChange[]): ChangeSeverity | null {
  const order: ChangeSeverity[] = ['CRITICAL', 'MAJOR', 'MINOR', 'INFO'];
  for (const severity of order) {
    if (changes.some((change) => change.severity === severity)) return severity;
  }
  return null;
}

export const SEVERITY_LABELS: Record<ChangeSeverity, string> = {
  CRITICAL: 'Критично',
  MAJOR: 'Существенно',
  MINOR: 'Незначительно',
  INFO: 'Для истории',
};

export const CHANGE_KIND_LABELS: Record<ChangeKind, string> = {
  SUBMISSION_DEADLINE_MOVED: 'Срок подачи заявки',
  DELIVERY_DEADLINE_MOVED: 'Срок поставки',
  START_PRICE_CHANGED: 'Начальная цена',
  SPEC_CHANGED: 'Техническое задание',
  DOCUMENT_REPLACED: 'Документ заменён',
  DOCUMENT_ADDED: 'Документ добавлен',
  PROCUREMENT_CANCELLED: 'Закупка отменена',
  OTHER: 'Иное',
};
