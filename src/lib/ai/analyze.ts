/**
 * AI-анализ документов: извлечение требований и позиций, проверка
 * соответствия, анализ договора.
 *
 * Все результаты проходят через слой verify.ts: вывод модели, который нельзя
 * подтвердить текстом документа, понижается в статусе, а не публикуется
 * как факт.
 */

import { callStructured, truncateForPrompt } from './client';
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

export async function extractRequirements(params: {
  documents: SourceDocument[];
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
    if (!verification.quoteVerified) adjustedCount += 1;
    const owner = verification.quoteVerified
      ? readable.find((d) =>
          d.text
            .toLowerCase()
            .includes(req.sourceQuote.slice(0, 24).toLowerCase()),
        )
      : undefined;
    return {
      label: req.label,
      text: req.text,
      category: req.category,
      isMandatory: req.isMandatory,
      sourceQuote: req.sourceQuote,
      pageNumber: verification.pageNumber,
      quoteVerified: verification.quoteVerified,
      verificationNote: verification.note,
      documentId: owner?.id ?? null,
    };
  });

  return {
    requirements,
    meta: {
      model: response.model,
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

export async function extractLineItems(params: {
  documents: SourceDocument[];
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
    if (!verification.quoteVerified) adjustedCount += 1;
    return {
      name: item.name,
      specification: item.specification,
      unit: item.unit || 'шт',
      quantity: item.quantity,
      sourceQuote: item.sourceQuote,
      pageNumber: verification.pageNumber,
      quoteVerified: verification.quoteVerified,
      verificationNote: verification.note,
      customerUnitPriceMinor:
        item.customerUnitPrice === null
          ? null
          : Math.round(item.customerUnitPrice * 100),
    };
  });

  return {
    items,
    meta: {
      model: response.model,
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

export async function checkCompliance(params: {
  requirements: RequirementForCheck[];
  /** Документы поставщика, которыми подтверждается соответствие. */
  supplierDocuments: SourceDocument[];
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
      documents: params.supplierDocuments,
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

export async function analyzeContract(params: {
  document: SourceDocument;
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
      financeHint: (risk.financeHint ?? null) as Record<string, number | null> | null,
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

  return {
    risks,
    terms,
    meta: {
      model: response.model,
      promptVersion: PROMPT_VERSION,
      tokenUsage: response.usage,
      limitations: parsed.data.limitations ?? [],
      adjustedCount,
    },
  };
}
