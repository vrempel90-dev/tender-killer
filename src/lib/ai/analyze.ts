/**
 * AI-анализ документов: извлечение требований и позиций, проверка
 * соответствия, анализ договора.
 *
 * Все результаты проходят через слой verify.ts: вывод модели, который нельзя
 * подтвердить текстом документа, понижается в статусе, а не публикуется
 * как факт.
 */

import { callStructured, truncateForPrompt } from './client';
import { planChunks, coverageLimitations } from './chunks';
import { runChunkedJob } from './jobs';
import { numberInQuote, claimsNumbersGrounded, verifyQuote } from './verify';
import Decimal from 'decimal.js';
import {
  COMPLIANCE_TOOL_SCHEMA,
  ComplianceResponseSchema,
  CONTRACT_TOOL_SCHEMA,
  ContractResponseSchema,
  LINE_ITEMS_TOOL_SCHEMA,
  LineItemsResponseSchema,
  REQUIREMENTS_TOOL_SCHEMA,
  RequirementsResponseSchema,
} from './schemas';
import {
  COMPLIANCE_SYSTEM,
  CONTRACT_SYSTEM,
  LINE_ITEMS_SYSTEM,
  PROMPT_VERSION,
  REQUIREMENTS_SYSTEM,
} from './prompts';
import {
  verifyComplianceFinding,
  verifyExtractionQuote,
  type SourceDocument,
} from './verify';
import { AiResponseError } from './client';

/** Описание состояния документа для модели: что прочитано, а что нет. */
function describeDocument(doc: SourceDocument): string {
  const parts = [`Документ: «${doc.name}»`];
  if (doc.extractionStatus === 'FAILED' || doc.text.length === 0) {
    parts.push(
      'ВНИМАНИЕ: содержимое этого документа прочитать НЕ удалось. '
      + 'Не делайте выводов о его содержании.',
    );
    return parts.join('\n');
  }
  if (doc.extractionStatus === 'PARTIAL' && doc.unreadablePages.length > 0) {
    parts.push(
      `ВНИМАНИЕ: страницы без текстового слоя (не прочитаны): `
      + `${doc.unreadablePages.join(', ')}. `
      + 'Их содержимое неизвестно — не делайте выводов об отсутствии данных.',
    );
  }
  return parts.join('\n');
}

function buildDocumentsBlock(documents: SourceDocument[], maxChars: number): string {
  const blocks: string[] = [];
  const perDoc = Math.floor(maxChars / Math.max(1, documents.length));

  for (const doc of documents) {
    const header = describeDocument(doc);
    if (doc.text.length === 0) {
      blocks.push(`${header}\n[содержимое недоступно]`);
      continue;
    }
    const { text, truncated } = truncateForPrompt(doc.text, perDoc);
    blocks.push(
      `${header}${truncated ? '\nВНИМАНИЕ: текст документа сокращён для анализа.' : ''}`
      + `\n--- начало документа «${doc.name}» ---\n${text}\n--- конец документа «${doc.name}» ---`,
    );
  }
  return blocks.join('\n\n');
}

export interface AnalysisMeta {
  model: string;
  provider?: 'ollama' | 'anthropic';
  modelDigest?: string;
  promptVersion: string;
  tokenUsage: { inputTokens: number; outputTokens: number };
  /** Ограничения, о которых сообщила модель. */
  limitations: string[];
  /** Сколько выводов было скорректировано постобработкой. */
  adjustedCount: number;
}

// ─────────────────────── Извлечение требований ──────────────────────────────

export interface ExtractedRequirementResult {
  label: string;
  text: string;
  category: 'DOCUMENT' | 'TECHNICAL' | 'QUALIFICATION' | 'DEADLINE' | 'FINANCIAL' | 'OTHER';
  isMandatory: boolean;
  sourceQuote: string;
  /** Номер страницы, установленный поиском цитаты, а не словами модели. */
  pageNumber: number | null;
  quoteVerified: boolean;
  verificationNote: string | null;
  documentId: string | null;
}

export async function extractRequirementsChunk(params: {
  documents: SourceDocument[];
  signal?: AbortSignal;
}): Promise<{ requirements: ExtractedRequirementResult[]; meta: AnalysisMeta }> {
  const readable = params.documents.filter((d) => d.text.length > 0);
  if (readable.length === 0) {
    throw new AiResponseError(
      'Ни один документ не прочитан: извлекать требования не из чего. '
      + 'Загрузите документ с текстовым слоем.',
    );
  }

  const userContent = [
    'Извлеките все требования закупки из следующих документов.',
    '',
    buildDocumentsBlock(readable, 120_000),
  ].join('\n');

  const response = await callStructured<unknown>({
    system: REQUIREMENTS_SYSTEM,
    userContent,
    toolName: 'save_requirements',
    toolDescription:
      'Сохранить список требований закупки, извлечённых из документации',
    inputSchema: REQUIREMENTS_TOOL_SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 16_000,
    signal: params.signal,
  });

  const parsed = RequirementsResponseSchema.safeParse(response.data);
  if (!parsed.success) {
    throw new AiResponseError(
      `Ответ модели не соответствует ожидаемой структуре: ${parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.')} — ${i.message}`)
        .join('; ')}`,
      response.data,
    );
  }

  let adjustedCount = 0;
  const requirements = parsed.data.requirements.map((req) => {
    const verification = verifyExtractionQuote(req.sourceQuote, readable);
    if (!claimsNumbersGrounded(req.text + ' ' + req.label, req.sourceQuote)) {
      verification.quoteVerified = false; verification.note = 'Числа в требовании не подтверждены цитатой. Требует ручной проверки.';
    }
    if (!verification.quoteVerified) adjustedCount += 1;
    const ownerId = verification.quoteVerified ? verifyQuote(req.sourceQuote, readable).documentId : null;
    return {
      label: req.label,
      text: req.text,
      category: req.category,
      isMandatory: req.isMandatory,
      sourceQuote: req.sourceQuote,
      pageNumber: verification.pageNumber,
      quoteVerified: verification.quoteVerified,
      verificationNote: verification.note,
      documentId: ownerId,
    };
  });

  return {
    requirements,
    meta: {
      model: response.model,
      provider: response.provider,
      modelDigest: response.modelDigest,
      promptVersion: PROMPT_VERSION,
      tokenUsage: response.usage,
      limitations: parsed.data.limitations ?? [],
      adjustedCount,
    },
  };
}

// ───────────────────────── Извлечение позиций ───────────────────────────────

export interface ExtractedLineItemResult {
  name: string;
  specification: string | null;
  unit: string;
  quantity: number;
  sourceQuote: string;
  pageNumber: number | null;
  quoteVerified: boolean;
  verificationNote: string | null;
  /** Цена заказчика в тиын, если она указана в документе. */
  customerUnitPriceMinor: number | null;
}

export async function extractLineItemsChunk(params: {
  documents: SourceDocument[];
  signal?: AbortSignal;
}): Promise<{ items: ExtractedLineItemResult[]; meta: AnalysisMeta }> {
  const readable = params.documents.filter((d) => d.text.length > 0);
  if (readable.length === 0) {
    throw new AiResponseError(
      'Ни один документ не прочитан: извлекать позиции не из чего.',
    );
  }

  const userContent = [
    'Извлеките товарные позиции из технической спецификации.',
    '',
    buildDocumentsBlock(readable, 120_000),
  ].join('\n');

  const response = await callStructured<unknown>({
    system: LINE_ITEMS_SYSTEM,
    userContent,
    toolName: 'save_line_items',
    toolDescription: 'Сохранить товарные позиции из технической спецификации',
    inputSchema: LINE_ITEMS_TOOL_SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 16_000,
    signal: params.signal,
  });

  const parsed = LineItemsResponseSchema.safeParse(response.data);
  if (!parsed.success) {
    throw new AiResponseError(
      `Ответ модели не соответствует ожидаемой структуре: ${parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.')} — ${i.message}`)
        .join('; ')}`,
      response.data,
    );
  }

  let adjustedCount = 0;
  const items = parsed.data.items.map((item) => {
    const verification = verifyExtractionQuote(item.sourceQuote, readable);
    const quantityVerified = verification.quoteVerified && numberInQuote(item.quantity, item.sourceQuote);
    const priceVerified = verification.quoteVerified && item.customerUnitPrice !== null && numberInQuote(item.customerUnitPrice, item.sourceQuote);
    if (!quantityVerified || (item.customerUnitPrice !== null && !priceVerified)
      || !claimsNumbersGrounded(item.name + ' ' + (item.specification ?? ''), item.sourceQuote)) {
      verification.quoteVerified = false; verification.note = 'Числовые значения не подтверждены цитатой. Требует ручной проверки.';
    }
    if (!verification.quoteVerified) adjustedCount += 1;
    return {
      name: item.name,
      specification: item.specification,
      unit: item.unit || 'шт',
      quantity: quantityVerified ? item.quantity : 0,
      sourceQuote: item.sourceQuote,
      pageNumber: verification.pageNumber,
      quoteVerified: verification.quoteVerified,
      verificationNote: verification.note,
      customerUnitPriceMinor:
        !priceVerified || item.customerUnitPrice === null
          ? null
          : (() => { const minor = new Decimal(item.customerUnitPrice).times(100).toDecimalPlaces(0).toNumber(); return Number.isSafeInteger(minor) ? minor : null; })(),
    };
  });

  return {
    items,
    meta: {
      model: response.model,
      provider: response.provider,
      modelDigest: response.modelDigest,
      promptVersion: PROMPT_VERSION,
      tokenUsage: response.usage,
      limitations: parsed.data.limitations ?? [],
      adjustedCount,
    },
  };
}

// ───────────────────── Проверка соответствия документов ─────────────────────

export interface RequirementForCheck {
  id: string;
  label: string;
  text: string;
  category: string;
  isMandatory: boolean;
}

export interface ComplianceFindingResult {
  requirementId: string;
  requirementText: string;
  status: 'CONFIRMED' | 'NOT_FOUND' | 'MISMATCH' | 'NEEDS_REVIEW';
  riskLevel: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  documentId: string | null;
  documentName: string | null;
  pageNumber: number | null;
  evidenceQuote: string | null;
  recommendation: string;
  uncertaintyReason: string | null;
  adjustedByVerification: boolean;
  adjustmentNote: string | null;
}

export async function checkComplianceChunk(params: {
  requirements: RequirementForCheck[];
  /** Документы поставщика, которыми подтверждается соответствие. */
  supplierDocuments: SourceDocument[];
  signal?: AbortSignal;
}): Promise<{
  findings: ComplianceFindingResult[];
  meta: AnalysisMeta;
  unreadableDocuments: string[];
}> {
  if (params.requirements.length === 0) {
    throw new AiResponseError(
      'Список требований пуст: сначала извлеките требования из документации '
      + 'закупки и подтвердите их.',
    );
  }

  const requirementsList = params.requirements
    .map(
      (r, index) =>
        `[${index}] (${r.category}, ${r.isMandatory ? 'обязательное' : 'необязательное'}) `
        + `${r.label}: ${r.text}`,
    )
    .join('\n');

  const userContent = [
    'ТРЕБОВАНИЯ ЗАКУПКИ:',
    requirementsList,
    '',
    'ДОКУМЕНТЫ ПОСТАВЩИКА:',
    params.supplierDocuments.length === 0
      ? '[документы не загружены]'
      : buildDocumentsBlock(params.supplierDocuments, 110_000),
    '',
    'Для каждого требования по его номеру определите статус соответствия.',
  ].join('\n');

  const response = await callStructured<unknown>({
    system: COMPLIANCE_SYSTEM,
    userContent,
    toolName: 'save_compliance_findings',
    toolDescription: 'Сохранить результат проверки соответствия требованиям',
    inputSchema: COMPLIANCE_TOOL_SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 16_000,
    signal: params.signal,
  });

  const parsed = ComplianceResponseSchema.safeParse(response.data);
  if (!parsed.success) {
    throw new AiResponseError(
      `Ответ модели не соответствует ожидаемой структуре: ${parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.')} — ${i.message}`)
        .join('; ')}`,
      response.data,
    );
  }

  let adjustedCount = 0;
  const findings: ComplianceFindingResult[] = [];

  for (const raw of parsed.data.findings) {
    const requirement = params.requirements[raw.requirementIndex];
    if (!requirement) continue; // модель указала несуществующий номер

    const verified = verifyComplianceFinding({
      status: raw.status,
      evidenceQuote: raw.evidenceQuote,
      uncertaintyReason: raw.uncertaintyReason,
      documents: params.supplierDocuments.map(doc => ({ ...doc,
        analysisTruncated: doc.analysisTruncated || doc.text.length > Math.floor(110_000 / Math.max(1, params.supplierDocuments.length)) })),
    });
    if (verified.adjusted) adjustedCount += 1;

    findings.push({
      requirementId: requirement.id,
      requirementText: `${requirement.label}: ${requirement.text}`,
      status: verified.status,
      // Для скорректированных выводов риск не понижаем: неизвестность
      // не безопаснее отсутствия.
      riskLevel: raw.riskLevel,
      documentId: verified.documentId,
      documentName: verified.documentName ?? raw.evidenceDocumentName,
      pageNumber: verified.pageNumber,
      evidenceQuote: verified.evidenceQuote,
      recommendation: raw.recommendation,
      uncertaintyReason: verified.uncertaintyReason,
      adjustedByVerification: verified.adjusted,
      adjustmentNote: verified.adjustmentNote,
    });
  }

  // Требования, по которым модель не дала вывода, не должны потеряться.
  const covered = new Set(findings.map((f) => f.requirementId));
  for (const requirement of params.requirements) {
    if (covered.has(requirement.id)) continue;
    findings.push({
      requirementId: requirement.id,
      requirementText: `${requirement.label}: ${requirement.text}`,
      status: 'NEEDS_REVIEW',
      riskLevel: requirement.isMandatory ? 'HIGH' : 'MEDIUM',
      documentId: null,
      documentName: null,
      pageNumber: null,
      evidenceQuote: null,
      recommendation:
        'Проверьте это требование вручную: автоматическая проверка не дала по '
        + 'нему результата.',
      uncertaintyReason:
        'Модель не вернула вывод по этому требованию. Оно не проверено.',
      adjustedByVerification: true,
      adjustmentNote: 'Требование добавлено как непроверенное',
    });
    adjustedCount += 1;
  }

  const unreadableDocuments = params.supplierDocuments
    .filter((d) => d.text.length === 0 || d.extractionStatus === 'FAILED')
    .map((d) => d.name);

  return {
    findings,
    meta: {
      model: response.model,
      provider: response.provider,
      modelDigest: response.modelDigest,
      promptVersion: PROMPT_VERSION,
      tokenUsage: response.usage,
      limitations: parsed.data.limitations ?? [],
      adjustedCount,
    },
    unreadableDocuments,
  };
}

// ────────────────────────── Анализ договора ─────────────────────────────────

export interface ContractRiskResult {
  category: string;
  title: string;
  clauseRef: string | null;
  sourceQuote: string;
  pageNumber: number | null;
  quoteVerified: boolean;
  riskLevel: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  explanation: string;
  recommendation: string | null;
  needsLawyerReview: boolean;
  financeHint: Record<string, number | null> | null;
}

export interface ContractTerms {
  paymentDelayDays: number | null;
  advancePercent: number | null;
  retentionPercent: number | null;
  deliveryDays: number | null;
  performanceSecurityPercent: number | null;
  warrantyMonths: number | null;
  penaltyPercentPerDay: number | null;
  penaltyCapPercent: number | null;
}

export async function analyzeContractChunk(params: {
  document: SourceDocument;
  signal?: AbortSignal;
}): Promise<{
  risks: ContractRiskResult[];
  terms: ContractTerms;
  meta: AnalysisMeta;
}> {
  if (params.document.text.length === 0) {
    throw new AiResponseError(
      `Содержимое документа «${params.document.name}» не прочитано: `
      + 'анализировать нечего. Загрузите договор с текстовым слоем.',
    );
  }

  const userContent = [
    'Проанализируйте проект договора со стороны поставщика.',
    '',
    buildDocumentsBlock([params.document], 130_000),
  ].join('\n');

  const response = await callStructured<unknown>({
    system: CONTRACT_SYSTEM,
    userContent,
    toolName: 'save_contract_analysis',
    toolDescription: 'Сохранить риски и условия проекта договора',
    inputSchema: CONTRACT_TOOL_SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 16_000,
    signal: params.signal,
  });

  const parsed = ContractResponseSchema.safeParse(response.data);
  if (!parsed.success) {
    throw new AiResponseError(
      `Ответ модели не соответствует ожидаемой структуре: ${parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.')} — ${i.message}`)
        .join('; ')}`,
      response.data,
    );
  }

  let adjustedCount = 0;
  const risks = parsed.data.risks.map((risk) => {
    const verification = verifyExtractionQuote(risk.sourceQuote, [params.document]);
    if (!claimsNumbersGrounded(risk.title + ' ' + risk.explanation, risk.sourceQuote)) {
      verification.quoteVerified = false; verification.note = 'Числовой вывод не подтверждён цитатой.';
    }
    if (!verification.quoteVerified) adjustedCount += 1;
    return {
      category: risk.category,
      title: risk.title,
      clauseRef: risk.clauseRef,
      sourceQuote: risk.sourceQuote,
      pageNumber: verification.pageNumber,
      quoteVerified: verification.quoteVerified,
      riskLevel: risk.riskLevel,
      explanation: risk.explanation,
      recommendation: risk.recommendation,
      // Непроверяемая цитата — повод показать риск юристу, а не скрыть его.
      needsLawyerReview: risk.needsLawyerReview || !verification.quoteVerified,
      financeHint: verification.quoteVerified && risk.financeHint
        ? Object.fromEntries(Object.entries(risk.financeHint).map(([key, value]) => [key, typeof value === 'number' && numberInQuote(value, risk.sourceQuote) ? value : null])) : null,
    };
  });

  const t = parsed.data.extractedTerms ?? {};
  const terms: ContractTerms = {
    paymentDelayDays: t.paymentDelayDays ?? null,
    advancePercent: t.advancePercent ?? null,
    retentionPercent: t.retentionPercent ?? null,
    deliveryDays: t.deliveryDays ?? null,
    performanceSecurityPercent: t.performanceSecurityPercent ?? null,
    warrantyMonths: t.warrantyMonths ?? null,
    penaltyPercentPerDay: t.penaltyPercentPerDay ?? null,
    penaltyCapPercent: t.penaltyCapPercent ?? null,
  };
  // Every numeric term needs both a verified clause quote and a matching explicit
  // numeric hint. This establishes traceability, not a legal interpretation.
  for (const key of Object.keys(terms) as Array<keyof ContractTerms>) {
    const value = terms[key];
    if (value === null) continue;
    const grounded = risks.some(r => r.quoteVerified && r.financeHint?.[key] === value
      && numberInQuote(value, r.sourceQuote));
    if (!grounded) { terms[key] = null; adjustedCount++; }
  }

  return {
    risks,
    terms,
    meta: {
      model: response.model,
      provider: response.provider,
      modelDigest: response.modelDigest,
      promptVersion: PROMPT_VERSION,
      tokenUsage: response.usage,
      limitations: parsed.data.limitations ?? [],
      adjustedCount,
    },
  };
}


function mergeMeta(results: Array<{ meta: AnalysisMeta }>, documents: SourceDocument[]): AnalysisMeta {
  const meta = results[0]?.meta;
  if (!meta) throw new AiResponseError('Нет результатов анализа.');
  return { ...meta,
    tokenUsage: results.reduce((sum, r) => ({ inputTokens: sum.inputTokens + r.meta.tokenUsage.inputTokens, outputTokens: sum.outputTokens + r.meta.tokenUsage.outputTokens }), { inputTokens: 0, outputTokens: 0 }),
    adjustedCount: results.reduce((sum, r) => sum + r.meta.adjustedCount, 0),
    limitations: [...new Set([...results.flatMap(r => r.meta.limitations), ...coverageLimitations(documents, results.length)])],
  };
}
function dedupe<T>(values: T[], key: (value: T) => string): T[] {
  return [...new Map(values.map(value => [key(value), value])).values()];
}

export async function extractRequirements(params: { documents: SourceDocument[]; signal?: AbortSignal }) {
  if (!params.documents.some(d => d.text.length)) return extractRequirementsChunk(params);
  const chunks = planChunks(params.documents, REQUIREMENTS_SYSTEM, REQUIREMENTS_TOOL_SCHEMA);
  const results = await runChunkedJob('REQUIREMENTS', params.documents, chunks,
    (documents, signal) => extractRequirementsChunk({ documents, signal }), params.signal);
  const requirements = dedupe(results.flatMap(r => r.requirements), r => r.sourceQuote + r.text);
  for (const req of requirements) req.pageNumber = verifyQuote(req.sourceQuote, params.documents).pageNumber;
  return { requirements, meta: mergeMeta(results, params.documents) };
}

export async function extractLineItems(params: { documents: SourceDocument[]; signal?: AbortSignal }) {
  if (!params.documents.some(d => d.text.length)) return extractLineItemsChunk(params);
  const chunks = planChunks(params.documents, LINE_ITEMS_SYSTEM, LINE_ITEMS_TOOL_SCHEMA);
  const results = await runChunkedJob('LINE_ITEMS', params.documents, chunks,
    (documents, signal) => extractLineItemsChunk({ documents, signal }), params.signal);
  // Do not merge distinct repeated rows merely because their product names match.
  const items = dedupe(results.flatMap(r => r.items), r => r.sourceQuote + r.name + r.quantity);
  for (const item of items) item.pageNumber = verifyQuote(item.sourceQuote, params.documents).pageNumber;
  return { items, meta: mergeMeta(results, params.documents) };
}

export async function analyzeContract(params: { document: SourceDocument; signal?: AbortSignal }) {
  if (!params.document.text.length) return analyzeContractChunk(params);
  const chunks = planChunks([params.document], CONTRACT_SYSTEM, CONTRACT_TOOL_SCHEMA);
  const results = await runChunkedJob('CONTRACT', [params.document], chunks,
    (documents, signal) => { if (!documents[0]) throw new AiResponseError('Нет фрагмента договора.'); return analyzeContractChunk({ document: documents[0], signal }); }, params.signal);
  const meta = mergeMeta(results, [params.document]);
  const risks = dedupe(results.flatMap(r => r.risks), r => r.category + r.sourceQuote);
  for (const risk of risks) risk.pageNumber = verifyQuote(risk.sourceQuote, [params.document]).pageNumber;
  const first = results[0];
  if (!first) throw new AiResponseError('Нет результатов анализа.');
  const terms = { ...first.terms };
  for (const key of Object.keys(terms) as Array<keyof ContractTerms>) {
    const values = [...new Set(results.map(r => r.terms[key]).filter(v => v !== null))];
    terms[key] = values.length === 1 ? (values[0] ?? null) : null;
    if (values.length > 1) { meta.adjustedCount++; meta.limitations.push(`Разные значения ${key} в фрагментах. Требует ручной проверки.`); }
  }
  return { risks, terms, meta };
}

export async function checkCompliance(params: { requirements: RequirementForCheck[]; supplierDocuments: SourceDocument[]; signal?: AbortSignal }) {
  if (!params.requirements.length) return checkComplianceChunk(params);
  const extra = params.requirements.map(r => `${r.label}: ${r.text}`).join('\n');
  const chunks = planChunks(params.supplierDocuments, COMPLIANCE_SYSTEM, COMPLIANCE_TOOL_SCHEMA, extra);
  const results = await runChunkedJob('COMPLIANCE', params.supplierDocuments, chunks,
    (documents, signal) => checkComplianceChunk({ requirements: params.requirements, supplierDocuments: documents, signal }), params.signal);
  const meta = mergeMeta(results, params.supplierDocuments);
  const findings = params.requirements.map(req => {
    const all = results.flatMap(r => r.findings).filter(f => f.requirementId === req.id);
    const evidence = all.filter(f => f.status === 'CONFIRMED' || f.status === 'MISMATCH');
    const statuses = new Set(evidence.map(f => f.status));
    const selected = evidence[0] ?? all[0];
    if (!selected) throw new AiResponseError('Модель не вернула вывод по требованию.');
    const originalComplete = params.supplierDocuments.every(d => d.extractionStatus === 'SUCCEEDED' && d.text.length > 0);
    if (statuses.size > 1 || (!originalComplete && selected.status === 'NOT_FOUND')
      || (chunks.length > 1 && !evidence.length)) {
      meta.adjustedCount++;
      return { ...selected, status: 'NEEDS_REVIEW' as const, uncertaintyReason: 'Выводы фрагментов неполны или противоречивы. Требует ручной проверки.', adjustedByVerification: true };
    }
    return { ...selected, pageNumber: selected.evidenceQuote ? verifyQuote(selected.evidenceQuote, params.supplierDocuments).pageNumber : null };
  });
  return { findings, meta, unreadableDocuments: params.supplierDocuments.filter(d => !d.text.length || d.extractionStatus === 'FAILED').map(d => d.name) };
}
