import { z } from 'zod';
import { AiNotConfiguredError } from './errors';

export const AiConfigSchema = z.object({
  AI_PROVIDER: z.enum(['ollama', 'anthropic']).default('ollama'),
  OLLAMA_BASE_URL: z.string().default('http://127.0.0.1:11434'),
  OLLAMA_MODEL: z.enum(['qwen3:8b', 'qwen3:4b']).default('qwen3:8b'),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600_000).default(180_000),
  AI_QUEUE_TIMEOUT_MS: z.coerce.number().int().min(0).max(30_000).default(10_000),
  AI_MAX_PARALLEL: z.coerce.number().int().min(1).max(4).default(1),
  AI_CONTEXT_TOKENS: z.coerce.number().int().min(8192).max(32768).default(16384),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(8192).default(2048),
  AI_CHUNK_CHARS: z.coerce.number().int().min(256).max(12_000).default(2500),
  AI_MAX_DOCUMENT_CHARS: z.coerce.number().int().min(1000).max(2_000_000).default(250_000),
  AI_MAX_CHUNKS: z.coerce.number().int().min(1).max(100).default(40),
  AI_DAILY_CALL_LIMIT: z.coerce.number().int().min(1).max(1000).default(100),
  AI_DAILY_TOKEN_BUDGET: z.coerce.number().int().min(1).max(1_000_000_000).default(2_000_000),
  AI_COMPANY_DAILY_TOKEN_BUDGET: z.coerce.number().int().min(1).max(1_000_000_000).default(500_000),
});
export type AiConfig = z.infer<typeof AiConfigSchema>;

export function getAiConfig(): AiConfig {
  const parsed = AiConfigSchema.safeParse(process.env);
  if (!parsed.success) throw new AiNotConfiguredError('Некорректная серверная конфигурация AI. Обратитесь к администратору.');
  return parsed.data;
}

/** Only fixed local destinations. No DNS resolution, redirects or public hosts. */
export function trustedOllamaUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new AiNotConfiguredError(); }
  const allowedHosts = ['127.0.0.1', 'localhost', '[::1]', 'ollama'];
  if (url.protocol !== 'http:' || !allowedHosts.includes(url.hostname)
    || url.port !== '11434' || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash) {
    throw new AiNotConfiguredError('Ollama: разрешён только локальный сервер на порту 11434. Проверьте серверную конфигурацию.');
  }
  // localhost is pinned to a loopback address rather than resolved using DNS.
  if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
  return url;
}
