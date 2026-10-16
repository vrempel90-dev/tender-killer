/** Shared authenticated AI boundary. Provider failures never select another provider. */
import { RequestError } from '../security/request';
import { getAiConfig } from './config';
import { AiResponseError } from './errors';
import { AnthropicProvider } from './providers/anthropic';
import { OllamaProvider } from './providers/ollama';
import type { AIProvider, StructuredCallParams, StructuredCallResult } from './provider';

export { AiNotConfiguredError, AiResponseError } from './errors';
export { getAiClient } from './providers/anthropic';
export type { AIProvider, TokenUsage, StructuredCallParams, StructuredCallResult } from './provider';

export function getAiProvider(): AIProvider {
  return getAiConfig().AI_PROVIDER === 'ollama'
    ? new OllamaProvider(getAiConfig()) : new AnthropicProvider();
}
export function getAiModel(): string { return getAiProvider().model; }

export function assertSafeAiInput(text: string): void {
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:sk-ant-|sk-proj-)[A-Za-z0-9_-]{16,}/i.test(text)) {
    throw new AiResponseError('В тексте обнаружен возможный секрет. Удалите его до AI-анализа.');
  }
  if (/(?:ignore|disregard) (?:all |the )?(?:previous|system) instructions|игнориру[йя](?:те)? (?:все |предыдущие |системные )*(?:инструкции|правила)|<\|(?:im_start|system|assistant)\|>/i.test(text)) {
    throw new AiResponseError('В документе обнаружены возможные инструкции для модели. Требует ручной проверки.');
  }
}

export async function callStructured<T>(params: StructuredCallParams): Promise<StructuredCallResult<T>> {
  const config = getAiConfig();
  const provider = getAiProvider();
  // Preserve the explicit external-transfer gate before any network activity.
  if (provider.name === 'anthropic') {
    const { getAiClient } = await import('./providers/anthropic');
    getAiClient();
  }
  assertSafeAiInput(params.userContent);
  const bytes = Buffer.byteLength(params.system + params.userContent + JSON.stringify(params.inputSchema), 'utf8');
  const output = provider.name === 'ollama' ? Math.min(params.maxTokens ?? config.AI_MAX_OUTPUT_TOKENS, config.AI_MAX_OUTPUT_TOKENS) : (params.maxTokens ?? 8000);
  // One UTF-8 byte per token is a conservative upper bound. Do not let Ollama
  // silently drop the front of a prompt when its context is exhausted.
  if (bytes > 500_000 || (provider.name === 'ollama' && bytes + output + 1024 > config.AI_CONTEXT_TOKENS)) {
    throw new AiResponseError('Текст превышает контекст AI. Разделите документ на фрагменты; анализ не выполнен.');
  }
  const [{ requireWriteAccess }, { consumeQuota, acquireAiLease }] = await Promise.all([
    import('../auth/guard'), import('../security/quota'),
  ]);
  const session = await requireWriteAccess();
  const reserved = bytes + output + 1024;
  await consumeQuota('ai-daily-calls', session.companyId, config.AI_DAILY_CALL_LIMIT, 86400);
  await consumeQuota('ai-platform-tokens', 'platform', config.AI_DAILY_TOKEN_BUDGET, 86400, reserved);
  await consumeQuota('ai-company-tokens', session.companyId, config.AI_COMPANY_DAILY_TOKEN_BUDGET, 86400, reserved);
  const release = await acquireAiLease(session.companyId, {
    parallel: config.AI_MAX_PARALLEL, timeoutMs: config.AI_TIMEOUT_MS,
    queueTimeoutMs: config.AI_QUEUE_TIMEOUT_MS, signal: params.signal,
  });
  const deadline = AbortSignal.timeout(config.AI_TIMEOUT_MS);
  const signal = params.signal ? AbortSignal.any([params.signal, deadline]) : deadline;
  try {
    return await provider.generate<T>(params, signal);
  } catch (error) {
    if (signal.aborted) throw new AiResponseError('AI-запрос прерван или превышено время генерации. Требует ручной проверки.');
    if (error instanceof AiResponseError || error instanceof RequestError) throw error;
    const { AiNotConfiguredError } = await import('./errors');
    if (error instanceof AiNotConfiguredError) throw error;
    throw new AiResponseError('AI-провайдер не выполнил запрос. Требует ручной проверки.');
  } finally { await release(); }
}

/**
 * Ограничение объёма текста, передаваемого модели.
 * Берётся начало и конец документа: требования обычно в начале,
 * перечень приложений и подписи — в конце.
 */
export function truncateForPrompt(
  text: string,
  maxChars = 120_000,
): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  const head = Math.floor(maxChars * 0.7);
  const tail = maxChars - head;
  return {
    text:
      text.slice(0, head)
      + `\n\n[…пропущено ${text.length - maxChars} символов середины документа…]\n\n`
      + text.slice(text.length - tail),
    truncated: true,
  };
}
