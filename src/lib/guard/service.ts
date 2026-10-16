/**
 * TENDER GUARD: работа с наблюдениями и редакциями.
 *
 * Здесь собирается снимок условий из того, что есть в системе: полей
 * тендера и текста технического задания из загруженного документа.
 * Автоматического доступа к порталам нет, поэтому новую редакцию приносит
 * пользователь — загружает документ или вносит сроки вручную.
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { parseSavedInput } from '../finance/from-db';
import type { FinanceInput } from '../finance/types';
import { compareSnapshots, specHash, type DetectedChange, type Snapshot } from './compare';
import { reassessRisk, type RiskReassessment } from './risk';

export interface SnapshotSource {
  /** Документ, из которого взят текст технического задания. */
  documentId: string | null;
  submissionDeadline: Date | null;
  deliveryDeadline: Date | null;
  startPriceMinor: number | null;
  specText: string | null;
  specCharCount: number | null;
  /** Почему текста задания нет — показывается пользователю. */
  specMissingReason: string | null;
}

/**
 * Текст технического задания из документа.
 *
 * Берётся из уже выполненного извлечения: GUARD не разбирает файлы сам,
 * он работает с тем, что прочитал парсер при загрузке. Если извлечение не
 * удалось, сравнение невозможно, и об этом говорится прямо.
 */
export async function readSpecFromDocument(params: {
  companyId: string;
  documentId: string;
}): Promise<{ text: string | null; reason: string | null; documentId: string | null }> {
  const document = await prisma.document.findFirst({
    // Фильтр по компании: идентификатор пришёл от клиента.
    where: { id: params.documentId, companyId: params.companyId, deletedAt: null },
    select: {
      id: true,
      originalName: true,
      extraction: { select: { status: true, text: true, charCount: true } },
    },
  });
  if (!document) {
    return { text: null, reason: 'Документ не найден', documentId: null };
  }
  const extraction = document.extraction;
  if (!extraction || extraction.status !== 'SUCCEEDED' || !extraction.text) {
    return {
      text: null,
      reason: `Из документа «${document.originalName}» не извлечён текст: `
        + 'сравнить задание не с чем. Проверьте документ вручную.',
      documentId: document.id,
    };
  }
  return { text: extraction.text, reason: null, documentId: document.id };
}

/**
 * Снимок текущих условий тендера.
 *
 * documentId — документ с техническим заданием. Если не указан, берётся
 * последний загруженный документ вида «техническая спецификация».
 */
export async function buildSnapshotSource(params: {
  companyId: string;
  tenderId: string;
  documentId?: string | null;
  overrides?: {
    submissionDeadline?: Date | null;
    deliveryDeadline?: Date | null;
    startPriceMinor?: number | null;
  };
}): Promise<SnapshotSource | null> {
  const tender = await prisma.tender.findFirst({
    where: { id: params.tenderId, companyId: params.companyId },
    select: {
      id: true,
      submissionDeadline: true,
      deliveryDeadline: true,
      startPriceMinor: true,
    },
  });
  if (!tender) return null;

  let documentId = params.documentId ?? null;
  if (documentId === null) {
    const latest = await prisma.document.findFirst({
      where: {
        companyId: params.companyId,
        tenderId: params.tenderId,
        deletedAt: null,
        kind: 'TECHNICAL_SPEC',
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    documentId = latest?.id ?? null;
  }

  let specText: string | null = null;
  let specMissingReason: string | null = null;
  if (documentId !== null) {
    const spec = await readSpecFromDocument({ companyId: params.companyId, documentId });
    specText = spec.text;
    specMissingReason = spec.reason;
    documentId = spec.documentId;
  } else {
    specMissingReason =
      'К тендеру не приложено техническое задание — изменения требований '
      + 'отслеживаться не будут.';
  }

  const overrides = params.overrides ?? {};

  return {
    documentId,
    submissionDeadline:
      overrides.submissionDeadline !== undefined
        ? overrides.submissionDeadline
        : tender.submissionDeadline,
    deliveryDeadline:
      overrides.deliveryDeadline !== undefined
        ? overrides.deliveryDeadline
        : tender.deliveryDeadline,
    startPriceMinor:
      overrides.startPriceMinor !== undefined
        ? overrides.startPriceMinor
        : tender.startPriceMinor === null
          ? null
          : Number(tender.startPriceMinor),
    specText,
    specCharCount: specText === null ? null : specText.length,
    specMissingReason,
  };
}

export function toComparable(source: {
  submissionDeadline: Date | null;
  deliveryDeadline: Date | null;
  startPriceMinor: number | bigint | null;
  specText: string | null;
}): Snapshot {
  return {
    submissionDeadline: source.submissionDeadline,
    deliveryDeadline: source.deliveryDeadline,
    startPriceMinor:
      source.startPriceMinor === null ? null : Number(source.startPriceMinor),
    specText: source.specText,
  };
}

/** Сохранённые исходные данные последнего расчёта по тендеру. */
export async function latestFinanceInput(params: {
  companyId: string;
  tenderId: string;
}): Promise<FinanceInput | null> {
  const model = await prisma.financialModel.findFirst({
    where: { tenderId: params.tenderId, tender: { companyId: params.companyId } },
    orderBy: { updatedAt: 'desc' },
    select: { inputs: true },
  });
  if (!model) return null;
  const parsed = parseSavedInput(model.inputs);
  // Если сохранённые данные не прошли проверку схемы, parseSavedInput
  // возвращает пустой ввод. Считать по нему нельзя: вызывающий покажет
  // «переоценка невозможна», а не цифры, взятые из воздуха.
  return parsed.valid ? parsed.input : null;
}

export interface RegisterRevisionResult {
  snapshotId: string;
  revision: number;
  changes: DetectedChange[];
  risk: RiskReassessment | null;
  specMissingReason: string | null;
}

/**
 * Регистрирует новую редакцию: сохраняет снимок, сравнивает с предыдущим и
 * записывает изменения вместе с переоценкой.
 */
export async function registerRevision(params: {
  tx: Prisma.TransactionClient;
  watchId: string;
  source: SnapshotSource;
  sourceKind: 'DOCUMENT' | 'MANUAL';
  capturedById: string | null;
  note: string | null;
  financeInput: FinanceInput | null;
  now?: Date;
}): Promise<RegisterRevisionResult> {
  const { tx, watchId, source } = params;

  const previous = await tx.watchSnapshot.findFirst({
    where: { watchId },
    orderBy: { revision: 'desc' },
  });

  const snapshot = await tx.watchSnapshot.create({
    data: {
      watchId,
      revision: (previous?.revision ?? 0) + 1,
      sourceKind: params.sourceKind,
      documentId: source.documentId,
      submissionDeadline: source.submissionDeadline,
      deliveryDeadline: source.deliveryDeadline,
      startPriceMinor:
        source.startPriceMinor === null ? null : BigInt(source.startPriceMinor),
      specText: source.specText,
      specHash: source.specText === null ? null : specHash(source.specText),
      specCharCount: source.specCharCount,
      note: params.note,
      capturedById: params.capturedById,
    },
  });

  // Первая редакция сравнивать не с чем: это точка отсчёта, а не «изменений нет».
  if (!previous) {
    return {
      snapshotId: snapshot.id,
      revision: snapshot.revision,
      changes: [],
      risk: null,
      specMissingReason: source.specMissingReason,
    };
  }

  const changes = compareSnapshots(
    toComparable(previous),
    toComparable(source),
    { now: params.now },
  );

  if (changes.length === 0) {
    return {
      snapshotId: snapshot.id,
      revision: snapshot.revision,
      changes: [],
      risk: null,
      specMissingReason: source.specMissingReason,
    };
  }

  const risk = reassessRisk({ input: params.financeInput, changes });

  for (const change of changes) {
    await tx.watchChange.create({
      data: {
        watchId,
        fromSnapshotId: previous.id,
        toSnapshotId: snapshot.id,
        kind: change.kind,
        severity: change.severity,
        summary: change.summary,
        detail: change.detail as Prisma.InputJsonValue,
        requiresRecalc: change.requiresRecalc,
        // Переоценка общая для редакции: одно изменение цены влияет на
        // расчёт вместе с остальными, разделять его бессмысленно.
        financialImpact: change.requiresRecalc
          ? (risk as unknown as Prisma.InputJsonValue)
          : undefined,
      },
    });
  }

  return {
    snapshotId: snapshot.id,
    revision: snapshot.revision,
    changes,
    risk,
    specMissingReason: source.specMissingReason,
  };
}
