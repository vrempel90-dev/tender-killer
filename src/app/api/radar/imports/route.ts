/**
 * TENDER RADAR: импорт объявлений о закупках из файла пользователя.
 *
 * Приложение не загружает объявления из внешних источников само:
 * автоматический доступ к API порталов требует законного разрешения и
 * токенов, которых у приложения нет. Поэтому закупки появляются только
 * так — из выгрузки, которую загрузил пользователь. Вместе с записями
 * сохраняются источник, имя файла, его контрольная сумма и дата
 * актуальности данных.
 *
 * Дата актуальности спрашивается у пользователя и не угадывается: в
 * выгрузке её обычно нет, а показать закупку как «свежую», не зная этого,
 * значит ввести в заблуждение.
 */

import { z } from 'zod';
import { prisma, dbTransaction } from '@/lib/db';
import { requireSession, requireWriteAccess } from '@/lib/auth/guard';
import { writeAudit } from '@/lib/audit';
import { clientIp, handleApiError, jsonError, jsonOk } from '@/lib/http';
import { readUploadForm } from '@/lib/security/request';
import { extractSpreadsheetIsolated as extractXlsxData } from '@/lib/documents/isolated';
import { inspectDocumentBytes } from '@/lib/documents/inspect';
import { scanDocument } from '@/lib/documents/scanner';
import { acquireParserLease, consumeQuota } from '@/lib/security/quota';
import { maxUploadBytes, sha256 } from '@/lib/documents/storage';
import { parseCsv } from '@/lib/market/import';
import { parseOpportunityRows, type RadarColumnMapping } from '@/lib/radar/import';
import type { ProcurementTypeValue } from '@/lib/radar/filters';

const ALLOWED_EXTENSIONS = ['.csv', '.xlsx'];

const MetaSchema = z.object({
  sourceName: z.string().trim().min(3, 'Укажите источник данных').max(200),
  sourceUrl: z.string().trim().url('Некорректная ссылка').max(500).optional(),
  /** Дата, на которую данные актуальны. */
  actualAt: z.string().datetime('Укажите дату актуальности данных'),
});

export async function GET() {
  try {
    const session = await requireSession();
    const imports = await prisma.procurementImport.findMany({
      where: { companyId: session.companyId },
      orderBy: { importedAt: 'desc' },
      take: 100,
      select: {
        id: true,
        sourceName: true,
        sourceUrl: true,
        fileName: true,
        actualAt: true,
        rowsTotal: true,
        rowsImported: true,
        rowsRejected: true,
        warnings: true,
        importedAt: true,
        _count: { select: { opportunities: true } },
      },
    });
    return jsonOk(imports);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  let release: (() => Promise<void>) | undefined;
  try {
    const session = await requireWriteAccess();
    release = await acquireParserLease(session.companyId);
    await consumeQuota('radar-import', session.companyId, 20, 3600);

    const form = await readUploadForm(request, maxUploadBytes());
    const file = form.get('file');
    const dryRun = form.get('dryRun') === 'true';
    const meta = MetaSchema.parse({
      sourceName: String(form.get('sourceName') ?? ''),
      sourceUrl: form.get('sourceUrl') ? String(form.get('sourceUrl')) : undefined,
      actualAt: String(form.get('actualAt') ?? ''),
    });

    const actualAt = new Date(meta.actualAt);
    // Данные не могут быть актуальны на будущую дату: это опечатка.
    if (actualAt.getTime() > Date.now() + 86_400_000) {
      return jsonError('Дата актуальности данных находится в будущем', 422);
    }

    if (!(file instanceof File)) return jsonError('Файл не передан', 400);
    const lowerName = file.name.toLowerCase();
    if (!ALLOWED_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) {
      return jsonError(
        `Поддерживаются файлы ${ALLOWED_EXTENSIONS.join(', ')}. `
        + 'Выгрузите объявления в одном из этих форматов.',
        415,
      );
    }
    if (file.size <= 0) return jsonError('Файл пустой', 400);
    if (file.size > maxUploadBytes()) {
      return jsonError('Файл больше допустимого размера', 413);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    await scanDocument(buffer);
    if (!lowerName.endsWith('.csv')) await inspectDocumentBytes(buffer, file.name);

    let table: string[][];
    if (lowerName.endsWith('.csv')) {
      table = parseCsv(buffer.toString('utf8'));
    } else {
      const extraction = await extractXlsxData(buffer);
      const sheet = extraction.tables[0];
      if (!sheet) return jsonError('В файле не найдено заполненных строк', 422);
      table = sheet.rows;
    }

    if (table.length < 2) {
      return jsonError(
        'В файле нет строк с данными: ожидается строка заголовков и хотя бы '
        + 'одно объявление.',
        422,
      );
    }

    const mappingRaw = form.get('mapping');
    let mappingOverride: RadarColumnMapping | undefined;
    if (typeof mappingRaw === 'string' && mappingRaw.length > 0) {
      // Пользователь может поправить сопоставление колонок, если заголовки
      // в выгрузке нетиповые.
      mappingOverride = JSON.parse(mappingRaw) as RadarColumnMapping;
    }

    const parsed = parseOpportunityRows(table, mappingOverride);

    if (parsed.rows.length === 0) {
      return jsonError(
        'Не удалось распознать ни одного объявления. Проверьте, что в файле '
        + 'есть колонка с наименованием закупки.',
        422,
        {
          headers: parsed.headers,
          mapping: parsed.mapping,
          skipped: parsed.skipped.slice(0, 20),
        },
      );
    }

    if (dryRun) {
      return jsonOk({
        dryRun: true,
        headers: parsed.headers,
        mapping: parsed.mapping,
        missingFields: parsed.missingFields,
        warnings: parsed.warnings,
        totalRows: parsed.rows.length,
        skipped: parsed.skipped.slice(0, 50),
        preview: parsed.rows.slice(0, 10).map((row) => ({
          ...row,
          deadline: row.deadline?.toISOString() ?? null,
          deliveryDeadline: row.deliveryDeadline?.toISOString() ?? null,
        })),
      });
    }

    // Повторы внутри одного файла по номеру объявления: уникальный индекс
    // не даст их вставить, поэтому отсекаем заранее и говорим об этом.
    const seen = new Set<string>();
    const unique = parsed.rows.filter((row) => {
      if (row.externalId === null) return true;
      if (seen.has(row.externalId)) return false;
      seen.add(row.externalId);
      return true;
    });
    const duplicatesInFile = parsed.rows.length - unique.length;

    const result = await dbTransaction(async (tx) => {
      const batch = await tx.procurementImport.create({
        data: {
          companyId: session.companyId,
          sourceName: meta.sourceName,
          sourceUrl: meta.sourceUrl ?? null,
          fileName: file.name,
          fileSha256: sha256(buffer),
          actualAt,
          rowsTotal: table.length - 1,
          rowsImported: unique.length,
          rowsRejected: parsed.skipped.length + duplicatesInFile,
          warnings: duplicatesInFile > 0
            ? [...parsed.warnings, `Повторов номера объявления внутри файла: ${duplicatesInFile}.`]
            : parsed.warnings,
          importedById: session.userId,
        },
      });

      await tx.procurementOpportunity.createMany({
        data: unique.map((row) => ({
          companyId: session.companyId,
          importId: batch.id,
          externalId: row.externalId,
          title: row.title,
          customerName: row.customerName,
          customerBin: row.customerBin,
          priceMinor: row.priceMinor === null ? null : BigInt(row.priceMinor),
          procurementType: row.procurementType as ProcurementTypeValue,
          region: row.region,
          deadline: row.deadline,
          deliveryDeadline: row.deliveryDeadline,
          sourceUrl: row.sourceUrl,
          raw: row.raw,
        })),
      });

      return batch;
    });

    await writeAudit({
      companyId: session.companyId,
      userId: session.userId,
      action: 'RADAR_IMPORT',
      entity: 'ProcurementImport',
      entityId: result.id,
      ipAddress: clientIp(request),
      metadata: {
        sourceName: meta.sourceName,
        fileName: file.name,
        imported: unique.length,
        rejected: parsed.skipped.length + duplicatesInFile,
      },
    });

    return jsonOk(
      {
        importId: result.id,
        imported: unique.length,
        rejected: parsed.skipped.length + duplicatesInFile,
        skipped: parsed.skipped.slice(0, 50),
        warnings: result.warnings,
        actualAt: result.actualAt,
      },
      201,
    );
  } catch (error) {
    return handleApiError(error);
  } finally {
    if (release) {
      await release().catch(() =>
        console.error(JSON.stringify({ event: 'parser_lease_release_failed' })));
    }
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await requireWriteAccess();
    const importId = new URL(request.url).searchParams.get('importId');
    if (!importId) return jsonError('Не указан импорт', 400);

    // Проверка принадлежности компании: идентификатор пришёл от клиента.
    const batch = await prisma.procurementImport.findFirst({
      where: { id: importId, companyId: session.companyId },
      select: { id: true, fileName: true, _count: { select: { opportunities: true } } },
    });
    if (!batch) return jsonError('Импорт не найден', 404);

    // Объявления, переданные в финансовый модуль, уже связаны с тендером.
    // Их удаление оставило бы тендер без основания — поэтому отказываем.
    const transferred = await prisma.procurementOpportunity.count({
      where: { importId: batch.id, tenderId: { not: null } },
    });
    if (transferred > 0) {
      return jsonError(
        `Нельзя удалить импорт: ${transferred} объявлений переданы в расчёт. `
        + 'Удалите соответствующие тендеры или оставьте импорт как основание.',
        409,
      );
    }

    await prisma.procurementImport.delete({ where: { id: batch.id } });

    await writeAudit({
      companyId: session.companyId,
      userId: session.userId,
      action: 'RADAR_IMPORT_DELETE',
      entity: 'ProcurementImport',
      entityId: batch.id,
      ipAddress: clientIp(request),
      metadata: { fileName: batch.fileName, removed: batch._count.opportunities },
    });

    return jsonOk({ deleted: batch._count.opportunities });
  } catch (error) {
    return handleApiError(error);
  }
}
