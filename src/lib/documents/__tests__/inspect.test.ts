import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { inspectDocumentBytes } from '../inspect';
import { extractDocumentIsolated } from '../isolated';

const fixture = (name: string) => readFile(path.join(process.cwd(), 'src/lib/documents/__tests__/fixtures', name));
describe('document byte inspection', () => {
  it('accepts actual supported document structures', async () => {
    for (const name of ['spec.pdf', 'contract.docx', 'quote.xlsx']) {
      await expect(inspectDocumentBytes(await fixture(name), name)).resolves.toBeUndefined();
    }
  });
  it('rejects forged names and truncated headers', async () => {
    await expect(inspectDocumentBytes(Buffer.from('arbitrary'), 'a.pdf')).rejects.toMatchObject({ status: 415 });
    await expect(inspectDocumentBytes(Buffer.from('x'), 'a.xlsx')).rejects.toMatchObject({ status: 415 });
    await expect(inspectDocumentBytes(await fixture('quote.xlsx'), 'a.docx')).rejects.toMatchObject({ status: 415 });
  });
  it('rejects high expansion before workbook parsing', async () => {
    const wb = new ExcelJS.Workbook(); wb.addWorksheet('payload').getCell('A1').value = 'a'.repeat(2_000_000);
    const bytes = Buffer.from(await wb.xlsx.writeBuffer());
    await expect(inspectDocumentBytes(bytes, 'bomb.xlsx')).rejects.toThrow(/распаковки/);
  });
  it('runs a supported file in the killable parser without process secrets', async () => {
    const result = await extractDocumentIsolated({ buffer: await fixture('quote.xlsx'), originalName: 'quote.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    expect(result.status).toBe('SUCCEEDED'); expect(result.charCount).toBeGreaterThan(0);
  });
});
