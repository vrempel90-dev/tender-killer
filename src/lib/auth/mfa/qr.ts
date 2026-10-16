/**
 * QR-код для подключения второго фактора.
 *
 * Рендерится на сервере в виде SVG-пути: клиенту уходит только строка
 * координат, библиотека генерации в браузер не попадает, а разметку
 * собирает React — вставки готового HTML нет.
 */

import qrcode from 'qrcode-generator';

export interface QrPath {
  /** Сторона матрицы в модулях, включая отступ (quiet zone). */
  size: number;
  /** Значение атрибута d для <path>. */
  path: string;
}

/** Обязательный по стандарту отступ вокруг кода — 4 модуля. */
const QUIET_ZONE = 4;

/** Матрица модулей без отступа. true — тёмный модуль. */
export function qrModules(data: string): boolean[][] {
  if (data.length === 0) {
    throw new Error('Нечего кодировать в QR');
  }
  // Тип 0 — автоподбор версии; уровень коррекции M: баланс плотности
  // и устойчивости к повреждениям при печати.
  const code = qrcode(0, 'M');
  code.addData(data, 'Byte');
  code.make();

  const count = code.getModuleCount();
  const rows: boolean[][] = [];
  for (let row = 0; row < count; row += 1) {
    const cells: boolean[] = [];
    for (let col = 0; col < count; col += 1) {
      cells.push(code.isDark(row, col));
    }
    rows.push(cells);
  }
  return rows;
}

/**
 * Собирает путь из горизонтальных серий тёмных модулей: это заметно
 * короче, чем прямоугольник на каждый модуль.
 */
export function renderQrPath(data: string): QrPath {
  const modules = qrModules(data);
  const count = modules.length;
  const segments: string[] = [];

  for (let row = 0; row < count; row += 1) {
    const cells = modules[row]!;
    let runStart: number | null = null;
    for (let col = 0; col <= count; col += 1) {
      const dark = col < count && cells[col] === true;
      if (dark && runStart === null) {
        runStart = col;
      } else if (!dark && runStart !== null) {
        const x = runStart + QUIET_ZONE;
        const y = row + QUIET_ZONE;
        segments.push(`M${x} ${y}h${col - runStart}v1h-${col - runStart}z`);
        runStart = null;
      }
    }
  }

  return { size: count + QUIET_ZONE * 2, path: segments.join('') };
}
