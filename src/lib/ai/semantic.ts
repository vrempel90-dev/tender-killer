/** Optional interpretations of existing records. Never creates tenders, prices or suppliers. */
import { z } from 'zod';
import { callStructured } from './client';
import { COMMON_RULES, PROMPT_VERSION } from './prompts';
import { claimsNumbersGrounded, verifyQuote, type SourceDocument } from './verify';
import { AiResponseError } from './errors';

const SemanticResponse = z.object({
  explanation: z.string().min(3).max(2000),
  classification: z.enum(['MATCH', 'NO_MATCH', 'UNCERTAIN', 'CRITICAL', 'MAJOR', 'MINOR', 'INFO']),
  firstQuote: z.string().min(1).max(2000), secondQuote: z.string().min(1).max(2000),
  missingInformation: z.array(z.string().max(500)).max(10),
});

function source(id: string, text: string): SourceDocument {
  return { id, name: id, text, extractionStatus: 'SUCCEEDED', unreadablePages: [] };
}

export async function interpretSources(params: { kind: 'RADAR' | 'GUARD' | 'SOURCING'; first: string; second: string; signal?: AbortSignal }) {
  const task = params.kind === 'RADAR'
    ? 'Сопоставьте профиль компании (первый источник) с закупкой (второй). Класс MATCH, NO_MATCH или UNCERTAIN.'
    : params.kind === 'GUARD'
      ? 'Сравните старую и новую редакции документов. Объясните изменение, класс CRITICAL, MAJOR, MINOR, INFO или UNCERTAIN. Цитируйте обе редакции.'
      : 'Сравните запрошенные характеристики с предложением поставщика. Класс MATCH, NO_MATCH или UNCERTAIN. Не оценивайте и не выдумывайте цены.';
  const response = await callStructured<unknown>({ system: `${task}\n${COMMON_RULES}`,
    userContent: JSON.stringify({ firstSource: params.first, secondSource: params.second }),
    toolName: 'semantic_interpretation', toolDescription: task, inputSchema: z.toJSONSchema(SemanticResponse), signal: params.signal });
  const parsed = SemanticResponse.safeParse(response.data);
  if (!parsed.success) throw new AiResponseError('Ответ модели не соответствует схеме семантического анализа. Требует ручной проверки.');
  const result = parsed.data;
  const first = verifyQuote(result.firstQuote, [source('first', params.first)]).verified;
  const second = verifyQuote(result.secondQuote, [source('second', params.second)]).verified;
  const validClass = (params.kind === 'GUARD'
    ? ['CRITICAL', 'MAJOR', 'MINOR', 'INFO', 'UNCERTAIN'] : ['MATCH', 'NO_MATCH', 'UNCERTAIN']).includes(result.classification);
  const verified = first && second && validClass && claimsNumbersGrounded(result.explanation, result.firstQuote + ' ' + result.secondQuote);
  return { ...result, classification: verified ? result.classification : 'UNCERTAIN', quoteVerified: verified,
    needsManualReview: true, model: response.model, provider: response.provider, modelDigest: response.modelDigest,
    promptVersion: PROMPT_VERSION, tokenUsage: response.usage };
}
