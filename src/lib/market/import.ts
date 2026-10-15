/**
 * Импорт завершённых закупок из файлов пользователя (CSV или XLSX).
 *
 * ПРИНЦИП: платформа не генерирует данные о реальных закупках. Всё, что
 * показано в аналитике, импортировано из файла, который загрузил
 * пользователь, — обычно это выгрузка с портала государственных закупок
 * или открытые данные. Источник сохраняется вместе с каждой записью.
 */

import { toMinor } from '../money';

/** Поля, которые система умеет распознавать. */
export type MarketField =
  | 'externalNumber'
  | 'title'
  | 'customerName'
  | 'customerBin'
  | 'region'
  | 'startPrice'
  | 'finalPrice'
  | 'winnerName'
  | 'winnerBin'
  | 'participantsCount'
  | 'awardedAt'
  | 'procurementType';

export const FIELD_LABELS: Record<MarketField, string> = {
  externalNumber: 'Номер закупки / лота',
  title: 'Наименование закупки',
  customerName: 'Заказчик',
  customerBin: 'БИН заказчика',
  region: 'Регион',
  startPrice: 'Начальная цена (план)',
  finalPrice: 'Итоговая цена договора',
  winnerName: 'Победитель',
  winnerBin: 'БИН победителя',
  participantsCount: 'Количество участников',
  awardedAt: 'Дата заключения договора',
  procurementType: 'Вид процедуры',
};

/**
 * Автоматическое сопоставление колонок файла с полями.
 * Варианты названий взяты из типовых выгрузок порталов закупок.
 */
/**
 * Порядок важен: поля с БИН проверяются РАНЬШЕ одноимённых названий,
 * иначе заголовок «БИН заказчика» попадёт в поле «Заказчик».
 */
const HEADER_PATTERNS: Array<{ field: MarketField; patterns: RegExp[] }> = [
  {
    field: 'externalNumber',
    patterns: [/номер\s*(объявл|лот|закуп)/i, /^(№|No|number)$/i, /lot.?number/i],
  },
  {
    field: 'title',
    patterns: [/наименован/i, /предмет\s*закуп/i, /название/i, /^title$/i],
  },
  { field: 'customerBin', patterns: [/бин\s*заказ/i, /customer.?bin/i, /^бин$/i] },
  { field: 'winnerBin', patterns: [/бин\s*(победит|поставщ)/i, /winner.?bin/i] },
  {
    field: 'customerName',
    // Негативный просмотр вперёд: «БИН заказчика» сюда не попадает.
    patterns: [/^(?!.*бин).*заказчик/i, /^customer$/i, /^customer.?name/i, /организатор/i],
  },
  { field: 'region', patterns: [/регион/i, /область/i, /^region$/i, /место\s*поставки/i] },
  {
    field: 'startPrice',
    patterns: [
      /план(ов|ируем)[а-я]*\s*(сумма|цена|стоим)/i,
      /начальн[а-я]*\s*(цена|сумма|стоим)/i,
      /сумма\s*закуп/i,
      /start.?price/i,
      /^план$/i,
    ],
  },
  {
    field: 'finalPrice',
    patterns: [
      /итогов[а-я]*\s*(цена|сумма|стоим)/i,
      /сумма\s*договор/i,
      /цена\s*договор/i,
      /final.?price/i,
      /^факт$/i,
    ],
  },
  {
    field: 'winnerName',
    patterns: [
      /^(?!.*бин).*победител/i,
      /^(?!.*бин).*поставщик/i,
      /^winner$/i,
      /^winner.?name/i,
      /^supplier$/i,
    ],
  },
  {
    field: 'participantsCount',
    patterns: [/(кол|число)[а-я]*\s*участник/i, /участников/i, /participants/i],
  },
  {
    field: 'awardedAt',
    patterns: [/дата\s*(заключ|договор|итог)/i, /awarded/i, /^дата$/i],
  },
  {
    field: 'procurementType',
    patterns: [/(вид|способ|тип)\s*(закуп|процедур)/i, /procurement.?type/i],
  },
];

export type ColumnMapping = Partial<Record<MarketField, number>>;

/** Подбирает соответствие колонок полям по заголовкам. */
export function guessColumnMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<number>();

  for (const { field, patterns } of HEADER_PATTERNS) {
    for (let index = 0; index < headers.length; index += 1) {
      if (used.has(index)) continue;
      const header = (headers[index] ?? '').trim();
      if (header.length === 0) continue;
      if (patterns.some((pattern) => pattern.test(header))) {
        mapping[field] = index;
        used.add(index);
        break;
      }
    }
  }
  return mapping;
}

export interface ParsedMarketRow {
  externalNumber: string | null;
  title: string;
  customerName: string | null;
  customerBin: string | null;
  region: string | null;
  startPriceMinor: number | null;
  finalPriceMinor: number | null;
  winnerName: string | null;
  winnerBin: string | null;
  participantsCount: number | null;
  awardedAt: Date | null;
  procurementType: string;
}

export interface ImportParseResult {
  rows: ParsedMarketRow[];
  /** Строки, которые не удалось разобрать, с номером и причиной. */
  skipped: Array<{ rowNumber: number; reason: string }>;
  mapping: ColumnMapping;
  headers: string[];
  /** Поля, которые не нашлись в файле. */
  missingFields: MarketField[];
}

/** Обязательные поля: без них запись бессмысленна. */
const REQUIRED_FIELDS: MarketField[] = ['title'];

/**
 * Разбор табличных данных в записи закупок.
 * Непонятные значения не «исправляются»: строка пропускается с причиной
 * либо поле остаётся незаполненным.
 */
export function parseMarketRows(
  table: string[][],
  mappingOverride?: ColumnMapping,
): ImportParseResult {
  if (table.length === 0) {
    return {
      rows: [],
      skipped: [],
      mapping: {},
      headers: [],
      missingFields: REQUIRED_FIELDS,
    };
  }

  const headers = (table[0] ?? []).map((h) => h.trim());
  const mapping = mappingOverride ?? guessColumnMapping(headers);

  const missingFields = (Object.keys(FIELD_LABELS) as MarketField[]).filter(
    (field) => mapping[field] === undefined,
  );

  const rows: ParsedMarketRow[] = [];
  const skipped: Array<{ rowNumber: number; reason: string }> = [];

  for (let i = 1; i < table.length; i += 1) {
    const raw = table[i] ?? [];
    const rowNumber = i + 1;

    const get = (field: MarketField): string => {
      const index = mapping[field];
      if (index === undefined) return '';
      return (raw[index] ?? '').trim();
    };

    const title = get('title');
    if (title.length === 0) {
      // Пустые строки в конце выгрузки — обычное дело, их не считаем ошибкой.
      if (raw.every((cell) => (cell ?? '').trim().length === 0)) continue;
      skipped.push({
        rowNumber,
        reason: 'не заполнено наименование закупки',
      });
      continue;
    }

    const startPriceMinor = parseMoney(get('startPrice'));
    const finalPriceMinor = parseMoney(get('finalPrice'));
    const participants = parseInteger(get('participantsCount'));
    const awardedAt = parseDate(get('awardedAt'));

    rows.push({
      externalNumber: nullIfEmpty(get('externalNumber')),
      title,
      customerName: nullIfEmpty(get('customerName')),
      customerBin: normalizeBin(get('customerBin')),
      region: nullIfEmpty(get('region')),
      startPriceMinor,
      finalPriceMinor,
      winnerName: nullIfEmpty(get('winnerName')),
      winnerBin: normalizeBin(get('winnerBin')),
      participantsCount: participants,
      awardedAt,
      procurementType: mapProcurementType(get('procurementType')),
    });
  }

  return { rows, skipped, mapping, headers, missingFields };
}

/**
 * Разбор денежной суммы из выгрузки.
 * Поддерживает «1 234 567,89», «1,234,567.89», «1234567.89 тг».
 * Возвращает null, если значение не похоже на число.
 */
export function parseMoney(value: string): number | null {
  const cleaned = value
    .replace(/[^\d,.\-\s\u00a0]/g, '')
    .replace(/[\s\u00a0]/g, '')
    .trim();
  if (cleaned.length === 0) return null;

  let normalized = cleaned;
  const lastComma = normalized.lastIndexOf(',');
  const lastDot = normalized.lastIndexOf('.');

  if (lastComma >= 0 && lastDot >= 0) {
    // Разделитель дробной части — тот, что правее.
    if (lastComma > lastDot) {
      normalized = normalized.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = normalized.replace(/,/g, '');
    }
  } else if (lastComma >= 0) {
    const decimals = normalized.length - lastComma - 1;
    // «1,234» — это разделитель тысяч, «1,23» — дробная часть.
    normalized =
      decimals === 3
        ? normalized.replace(/,/g, '')
        : normalized.replace(',', '.');
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return toMinor(parsed);
}

function parseInteger(value: string): number | null {
  const cleaned = value.replace(/[^\d-]/g, '');
  if (cleaned.length === 0) return null;
  const parsed = Number.parseInt(cleaned, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/** Разбор даты в форматах ДД.ММ.ГГГГ, ГГГГ-ММ-ДД, ДД/ММ/ГГГГ. */
export function parseDate(value: string): Date | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  const dotted = trimmed.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (dotted) {
    const [, day, month, year] = dotted;
    const date = new Date(
      Date.UTC(Number(year), Number(month) - 1, Number(day)),
    );
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const iso = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const [, year, month, day] = iso;
    const date = new Date(
      Date.UTC(Number(year), Number(month) - 1, Number(day)),
    );
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

function nullIfEmpty(value: string): string | null {
  return value.length === 0 ? null : value;
}

function normalizeBin(value: string): string | null {
  const digits = value.replace(/\D/g, '');
  return digits.length === 12 ? digits : null;
}

/** Сопоставление вида процедуры с перечислением системы. */
export function mapProcurementType(value: string): string {
  const v = value.toLowerCase();
  if (/конкурс/.test(v)) return 'OPEN_TENDER';
  if (/ценов|зцп|запрос\s*цен/.test(v)) return 'REQUEST_FOR_QUOTATIONS';
  if (/одного\s*источник|единствен/.test(v)) return 'SINGLE_SOURCE';
  if (/аукцион/.test(v)) return 'AUCTION';
  if (/корпоратив/.test(v)) return 'CORPORATE';
  return 'OTHER';
}

/** Разбор CSV с поддержкой кавычек и разделителей «,» или «;». */
export function parseCsv(content: string): string[][] {
  const text = content.replace(/^\ufeff/, '');
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char === '\r') {
      // пропускаем: перевод строки обработается на \n
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function detectDelimiter(text: string): string {
  const sample = text.slice(0, 4000);
  const semicolons = (sample.match(/;/g) ?? []).length;
  const commas = (sample.match(/,/g) ?? []).length;
  const tabs = (sample.match(/\t/g) ?? []).length;
  if (tabs > semicolons && tabs > commas) return '\t';
  return semicolons >= commas ? ';' : ',';
}
