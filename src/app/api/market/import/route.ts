/**
 * Импорт завершённых закупок из файла пользователя (CSV или XLSX).
 *
 * Система не загружает данные из внешних источников самостоятельно:
 * подключение к API порталов требует законного доступа и токенов, которых
 * у приложения нет. Поэтому аналитика строится на том, что пользователь
 * импортировал сам, и каждая запись хранит ссылку на источник.
 */

import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/db';
import { requireWriteAccess } from '@/lib/auth/guard';
import { writeAudit } from '@/lib/audit';
import { clientIp, handleApiError, jsonError, jsonOk } from '@/lib/http';
import { extractXlsxData } from '@/lib/documents/extract-xlsx';
import { maxUploadBytes } from '@/lib/documents/storage';
import { guessColumnMapping, parseCsv, parseMarketRows } from '@/lib/market/import';

const ALLOWED_EXTENSIONS = ['.csv', '.xlsx', '.xls'];

export async function POST(request: Request) {
  try {
    const session = await requireWriteAccess();
    const form = await request.formData();
    const file = form.get('file');
    const dryRun = form.get('dryRun') === 'true';

    if (!(file instanceof File)) {
      return jsonError('Файл не передан', 400);
    }
    const lowerName = file.name.toLowerCase();
    if (!ALLOWED_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) {
      return jsonError(
        `Поддерживаются файлы ${ALLOWED_EXTENSIONS.join(', ')}. `
        + 'Выгрузите данные закупок в одном из этих форматов.',
        415,
      );
    }
    if (file.size <= 0) return jsonError('Файл пустой', 400);
    if (file.size > maxUploadBytes()) {
      return jsonError('Файл больше допустимого размера', 413);
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // ── Чтение таблицы ───────────────────────────────────────────────────
    let table: string[][];
    if (lowerName.endsWith('.csv')) {
      table = parseCsv(buffer.toString('utf8'));
    } else {
      const extraction = await extractXlsxData(buffer);
      const sheet = extraction.tables[0];
      if (!sheet) {
        return jsonError('В файле не найдено заполненных строк', 422);
      }
      table = sheet.rows;
    }

    if (table.length < 2) {
      return jsonError(
        'В файле нет строк с данными: ожидается строка заголовков и хотя бы '
        + 'одна запись.',
        422,
      );
    }

    const headers = (table[0] ?? []).map((h) => h.trim());
    const mapping = guessColumnMapping(headers);
    const parsed = parseMarketRows(table, mapping);

    if (parsed.rows.length === 0) {
      return jsonError(
        'Не удалось распознать ни одной записи. Проверьте, что в файле есть '
        + 'колонка с наименованием закупки.',
        422,
        { headers, mapping, skipped: parsed.skipped.slice(0, 20) },
      );
    }

    // Предпросмотр: показываем, что будет импортировано, без записи в БД.
    if (dryRun) {
      return jsonOk({
        dryRun: true,
        headers,
        mapping,
        missingFields: parsed.missingFields,
        totalRows: parsed.rows.length,
        skipped: parsed.skipped.slice(0, 50),
        preview: parsed.rows.slice(0, 10).map((row) => ({
          ...row,
          awardedAt: row.awardedAt?.toISOString() ?? null,
        })),
      });
    }

    const batchId = randomUUID();
    const sourceRef = file.name;

    await prisma.historicalTender.createMany({
      data: parsed.rows.map((row) => ({
        companyId: session.companyId,
        externalNumber: row.externalNumber,
        title: row.title,
        customerName: row.customerName,
        customerBin: row.customerBin,
        region: row.region,
        startPriceMinor:
          row.startPriceMinor === null ? null : BigInt(row.startPriceMinor),
        finalPriceMinor:
          row.finalPriceMinor === null ? null : BigInt(row.finalPriceMinor),
        winnerName: row.winnerName,
        winnerBin: row.winnerBin,
        participantsCount: row.participantsCount,
        awardedAt: row.awardedAt,
        procurementType:
          row.procurementType as 'OPEN_TENDER' | 'REQUEST_FOR_QUOTATIONS'
            | 'SINGLE_SOURCE' | 'AUCTION' | 'CORPORATE' | 'OTHER',
        sourceRef,
        importBatchId: batchId,
      })),
    });

    await writeAudit({
      companyId: session.companyId,
      userId: session.userId,
      action: 'HISTORY_IMPORT',
      entity: 'HistoricalTender',
      entityId: batchId,
      ipAddress: clientIp(request),
      metadata: {
        sourceRef,
        imported: parsed.rows.length,
        skipped: parsed.skipped.length,
        missingFields: parsed.missingFields,
      },
    });

    return jsonOk(
      {
        imported: parsed.rows.length,
        skipped: parsed.skipped.length,
        skippedDetails: parsed.skipped.slice(0, 50),
        missingFields: parsed.missingFields,
        batchId,
        sourceRef,
      },
      201,
    );
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await requireWriteAccess();
    const batchId = new URL(request.url).searchParams.get('batchId');
    if (!batchId) return jsonError('Не указан импорт', 400);

    const result = await prisma.historicalTender.deleteMany({
      where: { companyId: session.companyId, importBatchId: batchId },
    });

    return jsonOk({ deleted: result.count });
  } catch (error) {
    return handleApiError(error);
  }
}
