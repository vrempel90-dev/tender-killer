/**
 * TENDER RADAR: разбор выгрузки объявлений о закупках.
 *
 * ПРИНЦИП: приложение не придумывает закупки и не загружает их из внешних
 * источников само. Автоматический доступ к API порталов требует законного
 * разрешения и токенов, которых у приложения нет. Поэтому единственный
 * путь появления объявления в системе — файл, который загрузил
 * пользователь (выгрузка с портала или открытые данные), и каждая запись
 * хранит ссылку на свой источник, имя файла, его контрольную сумму и дату
 * актуальности.
 *
 * Непонятные значения не «исправляются»: строка либо пропускается с
 * указанием причины, либо поле остаётся пустым. Угадывание здесь означало
 * бы выдуманные данные о реальных деньгах.
 */

import { mapProcurementType, parseDate, parseMoney } from '../market/import';

export type RadarField =
  | 'externalId'
  | 'title'
  | 'customerName'
  | 'customerBin'
  | 'price'
  | 'procurementType'
  | 'region'
  | 'deadline'
  | 'deliveryDeadline'
  | 'sourceUrl';

export const RADAR_FIELD_LABELS: Record<RadarField, string> = {
  externalId: 'Номер объявления / лота',
  title: 'Наименование закупки',
  customerName: 'Заказчик',
  customerBin: 'БИН заказчика',
  price: 'Плановая сумма',
  procurementType: 'Способ закупки',
  region: 'Регион поставки',
  deadline: 'Окончание приёма заявок',
  deliveryDeadline: 'Срок поставки',
  sourceUrl: 'Ссылка на объявление',
};

/**
 * Порядок важен: поля с БИН проверяются раньше одноимённых названий,
 * иначе заголовок «БИН заказчика» попадёт в поле «Заказчик». По той же
 * причине срок поставки проверяется раньше окончания приёма заявок.
 */
const HEADER_PATTERNS: Array<{ field: RadarField; patterns: RegExp[] }> = [
  {
    field: 'externalId',
    patterns: [
      /номер\s*(объявл|лот|закуп)/i,
      /^(№|No|number)$/i,
      /lot.?number/i,
      /announcement.?number/i,
    ],
  },
  {
    field: 'title',
    patterns: [
      /наименован/i,
      /предмет\s*закуп/i,
      /название/i,
      /^title$/i,
      /^subject$/i,
    ],
  },
  { field: 'customerBin', patterns: [/бин\s*заказ/i, /customer.?bin/i, /^бин$/i] },
  {
    field: 'customerName',
    patterns: [/^(?!.*бин).*заказчик/i, /^customer$/i, /^customer.?name/i, /организатор/i],
  },
  {
    field: 'price',
    patterns: [
      /план(ов|ируем)[а-я]*\s*(сумма|цена|стоим)/i,
      /начальн[а-я]*\s*(цена|сумма|стоим)/i,
      /сумма\s*закуп/i,
      /^сумма$/i,
      /start.?price/i,
      /^amount$/i,
    ],
  },
  {
    field: 'procurementType',
    patterns: [/(вид|способ|тип)\s*(закуп|процедур)/i, /procurement.?type/i],
  },
  {
    field: 'region',
    patterns: [/регион/i, /область/i, /^region$/i, /место\s*поставки/i],
  },
  {
    field: 'deliveryDeadline',
    patterns: [
      /срок\s*поставк/i,
      /дата\s*поставк/i,
      /срок\s*(исполн|выполн)/i,
      /delivery.?(date|deadline)/i,
    ],
  },
  {
    field: 'deadline',
    patterns: [
      /оконч[а-я]*\s*(приём|прием|подач)/i,
      /(приём|прием|подач)[а-я]*\s*(заявок|до)/i,
      /дата\s*оконч/i,
      /срок\s*подач/i,
      /deadline/i,
      /^до$/i,
    ],
  },
  {
    field: 'sourceUrl',
    patterns: [/ссылк/i, /^url$/i, /^link$/i, /адрес\s*объявл/i],
  },
];

export type RadarColumnMapping = Partial<Record<RadarField, number>>;

export function guessRadarMapping(headers: string[]): RadarColumnMapping {
  const mapping: RadarColumnMapping = {};
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

export interface ParsedOpportunity {
  externalId: string | null;
  title: string;
  customerName: string | null;
  customerBin: string | null;
  priceMinor: number | null;
  procurementType: string;
  region: string | null;
  deadline: Date | null;
  deliveryDeadline: Date | null;
  sourceUrl: string | null;
  /** Исходная строка: любое значение можно проверить по источнику. */
  raw: Record<string, string>;
}

export interface RadarParseResult {
  rows: ParsedOpportunity[];
  /** Строки, которые не удалось разобрать, с номером и причиной. */
  skipped: Array<{ rowNumber: number; reason: string }>;
  mapping: RadarColumnMapping;
  headers: string[];
  /** Поля, которых в файле не нашлось. */
  missingFields: RadarField[];
  /**
   * Предупреждения о качестве данных. Не ошибки, но пользователь должен
   * знать: по таким записям часть фильтров работать не будет.
   */
  warnings: string[];
}

/** Без наименования запись бессмысленна. */
const REQUIRED_FIELDS: RadarField[] = ['title'];

/** Ссылка принимается только http(s): остальное в выгрузке — мусор или опасно. */
function normalizeUrl(value: string): string | null {
  if (value.length === 0) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function normalizeBin(value: string): string | null {
  const digits = value.replace(/\D/g, '');
  return digits.length === 12 ? digits : null;
}

function nullIfEmpty(value: string): string | null {
  return value.length === 0 ? null : value;
}

export function parseOpportunityRows(
  table: string[][],
  mappingOverride?: RadarColumnMapping,
): RadarParseResult {
  if (table.length === 0) {
    return {
      rows: [],
      skipped: [],
      mapping: {},
      headers: [],
      missingFields: REQUIRED_FIELDS,
      warnings: ['Файл пустой'],
    };
  }

  const headers = (table[0] ?? []).map((h) => h.trim());
  const mapping = mappingOverride ?? guessRadarMapping(headers);
  const missingFields = (Object.keys(RADAR_FIELD_LABELS) as RadarField[]).filter(
    (field) => mapping[field] === undefined,
  );

  const rows: ParsedOpportunity[] = [];
  const skipped: Array<{ rowNumber: number; reason: string }> = [];
  let withoutDeadline = 0;
  let withoutPrice = 0;

  for (let i = 1; i < table.length; i += 1) {
    const cells = table[i] ?? [];
    const rowNumber = i + 1;

    const get = (field: RadarField): string => {
      const index = mapping[field];
      if (index === undefined) return '';
      return (cells[index] ?? '').trim();
    };

    const title = get('title');
    if (title.length === 0) {
      // Пустые строки в конце выгрузки — обычное дело, это не ошибка.
      if (cells.every((cell) => (cell ?? '').trim().length === 0)) continue;
      skipped.push({ rowNumber, reason: 'не заполнено наименование закупки' });
      continue;
    }

    const deadline = parseDate(get('deadline'));
    const priceMinor = parseMoney(get('price'));
    if (deadline === null) withoutDeadline += 1;
    if (priceMinor === null) withoutPrice += 1;

    // Исходная строка сохраняется целиком: это основание для проверки.
    const raw: Record<string, string> = {};
    headers.forEach((header, index) => {
      const value = (cells[index] ?? '').trim();
      if (value.length > 0) raw[header || `колонка ${index + 1}`] = value;
    });

    rows.push({
      externalId: nullIfEmpty(get('externalId')),
      title,
      customerName: nullIfEmpty(get('customerName')),
      customerBin: normalizeBin(get('customerBin')),
      priceMinor,
      procurementType: mapProcurementType(get('procurementType')),
      region: nullIfEmpty(get('region')),
      deadline,
      deliveryDeadline: parseDate(get('deliveryDeadline')),
      sourceUrl: normalizeUrl(get('sourceUrl')),
      raw,
    });
  }

  const warnings: string[] = [];
  if (mapping.deadline === undefined) {
    warnings.push(
      'В файле не найдена колонка с окончанием приёма заявок. Отбор по срокам '
      + 'для этих записей работать не будет.',
    );
  } else if (withoutDeadline > 0) {
    warnings.push(
      `У ${withoutDeadline} записей не распознан срок окончания приёма заявок: `
      + 'отбор по срокам их не учтёт.',
    );
  }
  if (mapping.price === undefined) {
    warnings.push(
      'В файле не найдена колонка с плановой суммой. Отбор по цене и передача '
      + 'в финансовый модуль потребуют ручного ввода суммы.',
    );
  } else if (withoutPrice > 0) {
    warnings.push(`У ${withoutPrice} записей не распознана плановая сумма.`);
  }
  if (mapping.externalId === undefined) {
    warnings.push(
      'В файле не найден номер объявления. Повторный импорт того же файла '
      + 'создаст записи заново: без номера сопоставить их не с чем.',
    );
  }
  if (skipped.length > 0) {
    warnings.push(`Пропущено строк: ${skipped.length}.`);
  }

  return { rows, skipped, mapping, headers, missingFields, warnings };
}
