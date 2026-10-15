import path from 'node:path';
import { fromBuffer, type Entry } from 'yauzl';
import { RequestError } from '../security/request';

const invalid = (message: string) => new RequestError(message, 415);

/** Fully drain each entry before any Office parser receives the archive. */
export async function inspectOfficeArchive(buffer: Buffer, kind: 'docx' | 'xlsx'): Promise<void> {
  return new Promise((resolve, reject) => {
    fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true, autoClose: true }, (error, zip) => {
      if (error || !zip) { reject(invalid('Повреждённый ZIP-контейнер Office')); return; }
      let count = 0, expanded = 0;
      let main = false, contentTypes = '';
      const names = new Set<string>();
      const fail = (reason: string) => { zip.close(); reject(invalid(reason)); };
      zip.on('error', () => fail('Повреждённый ZIP-контейнер Office'));
      zip.on('entry', (entry: Entry) => {
        count++;
        const name = entry.fileName;
        if (count > 2000 || names.has(name) || name.includes('\\') || name.startsWith('/')
          || name.split('/').includes('..') || (entry.generalPurposeBitFlag & 1)
          || /(?:vbaProject|embeddings\/|\.exe$|\.js$|\.ps1$)/i.test(name)) {
          fail('Архив содержит запрещённые, зашифрованные или повторные элементы'); return;
        }
        names.add(name);
        expanded += entry.uncompressedSize;
        if (expanded > 52_428_800 || entry.uncompressedSize > 20_971_520
          || (entry.uncompressedSize > 1_048_576 && entry.uncompressedSize / Math.max(1, entry.compressedSize) > 200)) {
          fail('Превышен лимит распаковки архива'); return;
        }
        if (name === (kind === 'docx' ? 'word/document.xml' : 'xl/workbook.xml')) main = true;
        if (name.endsWith('/')) { zip.readEntry(); return; }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) { fail('Не удалось проверить архив'); return; }
          let actual = 0;
          stream.on('data', (chunk: Buffer) => {
            actual += chunk.length;
            if (actual > entry.uncompressedSize || actual > 20_971_520) {
              stream.destroy(); fail('Фактическая распаковка превышает лимит'); return;
            }
            if (name === '[Content_Types].xml') {
              if (actual > 262_144) { stream.destroy(); fail('Слишком большой Content_Types'); return; }
              contentTypes += chunk.toString('utf8');
            }
          });
          stream.on('error', () => fail('Некорректное содержимое ZIP'));
          stream.on('end', () => { if (actual !== entry.uncompressedSize) fail('Размер ZIP-элемента не совпадает'); else zip.readEntry(); });
        });
      });
      zip.on('end', () => {
        const expected = kind === 'docx' ? 'wordprocessingml.document.main+xml' : 'spreadsheetml.sheet.main+xml';
        if (!main || !contentTypes.includes(expected) || /macroEnabled/i.test(contentTypes)) {
          reject(invalid('Содержимое не соответствует формату Office или содержит макросы'));
        } else resolve();
      });
      zip.readEntry();
    });
  });
}

export async function inspectDocumentBytes(buffer: Buffer, originalName: string): Promise<void> {
  const ext = path.extname(originalName).toLowerCase();
  if (ext === '.pdf') {
    if (!buffer.subarray(0, 8).toString('ascii').startsWith('%PDF-')) throw invalid('Сигнатура PDF не совпадает');
    return;
  }
  if (ext === '.docx' || ext === '.xlsx') {
    if (buffer.length < 4 || buffer.readUInt32LE(0) !== 0x04034b50) throw invalid('Сигнатура Office не совпадает');
    await inspectOfficeArchive(buffer, ext === '.docx' ? 'docx' : 'xlsx');
    return;
  }
  throw invalid('Поддерживаются PDF, DOCX и XLSX; старый XLS необходимо пересохранить в XLSX');
}
