import { z } from 'zod';
import { trustedOllamaUrl, type AiConfig } from '../config';
import { AiNotConfiguredError, AiResponseError } from '../errors';
import type { AIProvider, StructuredCallParams, StructuredCallResult } from '../provider';

const Tags = z.object({ models: z.array(z.object({ name: z.string(), digest: z.string(), size: z.number().optional() })).max(1000) });
const Chat = z.object({
  model: z.string(), done: z.literal(true), done_reason: z.literal('stop'),
  message: z.object({ role: z.literal('assistant'), content: z.string().max(1_000_000) }),
  prompt_eval_count: z.number().int().nonnegative(), eval_count: z.number().int().nonnegative(),
});

export class OllamaProvider implements AIProvider {
  readonly name = 'ollama' as const;
  readonly model: string;
  private readonly base: URL;
  constructor(private readonly config: AiConfig) {
    this.base = trustedOllamaUrl(config.OLLAMA_BASE_URL);
    this.model = config.OLLAMA_MODEL;
  }

  private async request(path: '/api/tags' | '/api/show' | '/api/chat', signal: AbortSignal, body?: object): Promise<unknown> {
    try {
      const response = await fetch(new URL(path, this.base), {
        method: body ? 'POST' : 'GET', redirect: 'error', cache: 'no-store', signal,
        headers: { 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (response.status === 404 && path !== '/api/tags') {
        throw new AiNotConfiguredError(`Модель ${this.model} не установлена. Администратору: ollama pull ${this.model}.`);
      }
      if (!response.ok) throw new AiResponseError('Ollama отклонила запрос. Проверьте модель и доступные ресурсы.');
      // Limit the actual stream, including chunked responses with no Content-Length.
      const reader = response.body?.getReader();
      if (!reader) throw new AiResponseError('Пустой ответ Ollama.');
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 2_000_000) { await reader.cancel(); throw new AiResponseError('Ответ Ollama превысил допустимый размер.'); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw new AiResponseError('Ollama вернула некорректный JSON. Анализ не сохранён как успешный.'); }
    } catch (error) {
      if (signal.aborted) throw new AiResponseError('AI-запрос прерван или превышено время генерации. Требует ручной проверки.');
      if (error instanceof AiResponseError || error instanceof AiNotConfiguredError) throw error;
      throw new AiNotConfiguredError('Локальный AI-сервер недоступен. Обратитесь к администратору.');
    }
  }

  async inspect(signal: AbortSignal): Promise<{ digest: string; size?: number }> {
    const tags = Tags.safeParse(await this.request('/api/tags', signal));
    if (!tags.success) throw new AiResponseError('Некорректный ответ списка моделей Ollama.');
    const installed = tags.data.models.find(m => m.name === this.model);
    if (!installed) throw new AiNotConfiguredError(`Модель ${this.model} не установлена. Администратору: ollama pull ${this.model}.`);
    const detail = z.object({ remote_host: z.string().optional(), remote_model: z.string().optional() })
      .safeParse(await this.request('/api/show', signal, { model: this.model }));
    if (!detail.success || detail.data.remote_host || detail.data.remote_model) {
      throw new AiNotConfiguredError('Удалённые модели Ollama запрещены. Установите локальную Qwen3.');
    }
    return { digest: installed.digest, size: installed.size };
  }

  async generate<T>(params: StructuredCallParams, signal: AbortSignal): Promise<StructuredCallResult<T>> {
    const installed = await this.inspect(signal);
    const result = Chat.safeParse(await this.request('/api/chat', signal, {
      model: this.model, stream: false, think: false, format: params.inputSchema,
      keep_alive: '5m',
      options: { temperature: params.temperature ?? 0, num_ctx: this.config.AI_CONTEXT_TOKENS,
        num_predict: Math.min(params.maxTokens ?? this.config.AI_MAX_OUTPUT_TOKENS, this.config.AI_MAX_OUTPUT_TOKENS) },
      messages: [{ role: 'system', content: params.system }, { role: 'user', content: params.userContent }],
    }));
    if (!result.success || result.data.model !== this.model) {
      throw new AiResponseError('Ollama не завершила генерацию полностью или изменила модель. Требует ручной проверки.');
    }
    let data: T;
    try { data = JSON.parse(result.data.message.content) as T; }
    catch { throw new AiResponseError('Модель вернула некорректный JSON. Анализ не сохранён как успешный.'); }
    return { data, model: result.data.model, provider: this.name, modelDigest: installed.digest,
      usage: { inputTokens: result.data.prompt_eval_count, outputTokens: result.data.eval_count } };
  }
}
