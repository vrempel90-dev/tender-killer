/**
 * Извлечение данных из XLSX/XLS через exceljs.
 * Каждый лист превращается в таблицу строк и в текстовое представление,
 * пригодное для передачи в AI-анализ.
 */

export interface SheetTable {
  sheetName: string;
  rows: string[][];
}

export interface XlsxExtractionResult {
  text: string;
  tables: SheetTable[];
  warnings: string[];
  charCount: number;
  sheetCount: number;
}

/** Ограничение, чтобы один файл не съел всю память и контекст AI. */
const MAX_ROWS_PER_SHEET = 2000;
const MAX_COLS = 60;

export async function extractXlsxData(
  buffer: Buffer,
): Promise<XlsxExtractionResult> {
  const ExcelJS = (await import('exceljs')).default;

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

  const tables: SheetTable[] = [];
  const warnings: string[] = [];
  const textParts: string[] = [];

  workbook.eachSheet((worksheet) => {
    const rows: string[][] = [];
    let truncated = false;

    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber > MAX_ROWS_PER_SHEET) {
        truncated = true;
        return;
      }
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        if (colNumber > MAX_COLS) return;
        cells.push(formatCell(cell.value));
      });
      if (cells.some((c) => c.length > 0)) rows.push(cells);
    });

    if (truncated) {
      warnings.push(
        `Лист «${worksheet.name}»: прочитаны первые ${MAX_ROWS_PER_SHEET} строк, `
        + 'остальные пропущены.',
      );
    }

    if (rows.length > 0) {
      tables.push({ sheetName: worksheet.name, rows });
      textParts.push(
        `--- лист «${worksheet.name}» ---\n`
        + rows.map((r) => r.join('\t')).join('\n'),
      );
    }
  });

  if (tables.length === 0) {
    warnings.push('В файле не найдено заполненных строк.');
  }

  const text = textParts.join('\n\n');
  return {
    text,
    tables,
    warnings,
    charCount: text.length,
    sheetCount: workbook.worksheets.length,
  };
}

/** Приведение значения ячейки к строке без потери смысла. */
function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'да' : 'нет';
  if (value instanceof Date) return value.toISOString().slice(0, 10);

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    // Формула: берём вычисленный результат, а не текст формулы.
    if ('result' in obj) return formatCell(obj.result);
    if ('text' in obj) return formatCell(obj.text);
    if ('richText' in obj && Array.isArray(obj.richText)) {
      return obj.richText
        .map((part) => formatCell((part as { text?: unknown }).text))
        .join('');
    
    }
    if ('hyperlink' in obj) return formatCell(obj.hyperlink);
  }
  return String(value);
}
