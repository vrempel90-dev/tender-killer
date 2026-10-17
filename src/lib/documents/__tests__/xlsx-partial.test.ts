import { expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { extractDocument } from '../extract';
it.each(['row', 'column'])('reports XLSX %s truncation as PARTIAL with a warning', async direction => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Synthetic');
  sheet.getCell('A1').value = 'Visible requirement';
  sheet.getCell(direction === 'row' ? 2001 : 1, direction === 'column' ? 61 : 1).value = 'Omitted requirement';
  const outcome = await extractDocument({ buffer: Buffer.from(await workbook.xlsx.writeBuffer()), originalName: 'synthetic.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  expect(outcome.status).toBe('PARTIAL');
  expect(outcome.warnings.join(' ')).toContain('пропущена');
  expect(outcome.text).toContain('Visible requirement');
  expect(outcome.text).not.toContain('Omitted requirement');
});
