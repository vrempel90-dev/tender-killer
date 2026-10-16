import { z } from 'zod';
import { getAiConfig } from './config';
import { getAiProvider, callStructured } from './client';
import { OllamaProvider } from './providers/ollama';

/** Admin response deliberately omits internal addresses and secrets. */
export function aiSummary() {
  const config = getAiConfig();
  const provider = getAiProvider();
  return { provider: provider.name, model: provider.model, configured: provider.name === 'ollama'
    || (!!process.env.ANTHROPIC_API_KEY && process.env.AI_EXTERNAL_TRANSFER_APPROVED === 'true'),
  limits: { timeoutMs: config.AI_TIMEOUT_MS, parallel: config.AI_MAX_PARALLEL,
    contextTokens: config.AI_CONTEXT_TOKENS, maxOutputTokens: config.AI_MAX_OUTPUT_TOKENS,
    maxDocumentChars: config.AI_MAX_DOCUMENT_CHARS, maxChunks: config.AI_MAX_CHUNKS,
    dailyCalls: config.AI_DAILY_CALL_LIMIT } };
}

export async function testAiConnection(signal?: AbortSignal) {
  const provider = getAiProvider();
  const started = Date.now();
  let installed: { digest: string; size?: number } | undefined;
  if (provider instanceof OllamaProvider) installed = await provider.inspect(AbortSignal.timeout(5000));
  const schema = z.object({ ok: z.literal(true) });
  const result = await callStructured<unknown>({ system: 'Проверка связи. Верните JSON {"ok":true}.',
    userContent: 'Подтвердите доступность структурированного ответа.', toolName: 'connection_test',
    toolDescription: 'Проверка подключения', inputSchema: z.toJSONSchema(schema), maxTokens: 256, signal });
  schema.parse(result.data);
  return { ...aiSummary(), server: 'available', modelStatus: 'installed', test: 'passed',
    durationMs: Date.now() - started, digest: installed?.digest, sizeBytes: installed?.size };
}
