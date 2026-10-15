/**
 * Серверный адаптер Anthropic API.
 *
 * Ключ читается только из переменных окружения и никогда не попадает в
 * клиентский код. Если ключа нет, функции бросают AiNotConfiguredError —
 * вызывающий код обязан показать это состояние в интерфейсе, а не делать
 * вид, что анализ выполнен.
 */

import Anthropic from '@anthropic-ai/sdk';
import { RequestError } from '../security/request';

export class AiNotConfiguredError extends Error {
  constructor() {
    super(
      'AI-анализ недоступен: не задан ANTHROPIC_API_KEY. '
      + 'Остальные функции платформы работают.',
    );
    this.name = 'AiNotConfiguredError';
  }
}

export class AiResponseError extends Error {
  constructor(
    message: string,
    readonly raw?: unknown,
  ) {
    super(message);
    this.name = 'AiResponseError';
  }
}

let client: Anthropic | null = null;

export function getAiClient(): Anthropic {
  const apiKey = (process.env.ANTHROPIC_API_KEY ?? '').trim();
  if (apiKey.length === 0) {
    throw new AiNotConfiguredError();
  }
  if (process.env.AI_EXTERNAL_TRANSFER_APPROVED !== 'true') {
    throw new RequestError('Внешний AI отключён: требуется подтверждённое основание передачи данных и настройка AI_EXTERNAL_TRANSFER_APPROVED.', 503);
  }
  if (!client) {
    client = new Anthropic({ apiKey, maxRetries: 2, timeout: 180_000 });
  }
  return client;
}

export function getAiModel(): string {
  return (process.env.ANTHROPIC_MODEL ?? '').trim() || 'claude-sonnet-5-5';
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface StructuredCallResult<T> {
  data: T;
  usage: TokenUsage;
  model: string;
}

/**
 * Вызов модели с обязательным структурированным ответом через инструмент.
 *
 * Схема инструмента задаёт форму ответа, поэтому разбирать свободный текст
 * не нужно. Результат всё равно валидируется zod-схемой вызывающей стороной:
 * модель может вернуть структурно верный, но содержательно негодный ответ.
 */
export async function callStructured<T>(params: {
  system: string;
  userContent: string;
  toolName: string;
  toolDescription: string;
  inputSchema: Record<string, unknown>;
  maxTokens?: number;
  /** Температура 0 — расчётные задачи не должны «фантазировать». */
  temperature?: number;
}): Promise<StructuredCallResult<T>> {
  const anthropic = getAiClient();
  const model = getAiModel();
  const [{ getCurrentSession }, { consumeQuota }] = await Promise.all([
    import('../auth/session'), import('../security/quota'),
  ]);
  const session = await getCurrentSession();
  if (!session) throw new RequestError('Требуется авторизация', 401);
  const reservedTokens = Buffer.byteLength(params.system + params.userContent, 'utf8') + (params.maxTokens ?? 8000);
  await consumeQuota('ai-daily-calls', session.companyId, 20, 86400);
  await consumeQuota('ai-platform-tokens', 'platform', Number(process.env.AI_DAILY_TOKEN_BUDGET ?? 0), 86400, reservedTokens);
  await consumeQuota('ai-company-tokens', session.companyId, Number(process.env.AI_COMPANY_DAILY_TOKEN_BUDGET ?? 0), 86400, reservedTokens);

  const response = await anthropic.messages.create({
    model,
    max_tokens: params.maxTokens ?? 8000,
    temperature: params.temperature ?? 0,
    system: params.system,
    tools: [
      {
        name: params.toolName,
        description: params.toolDescription,
        input_schema: params.inputSchema as Anthropic.Tool['input_schema'],
      },
    ],
    tool_choice: { type: 'tool', name: params.toolName },
    messages: [{ role: 'user', content: params.userContent }],
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
  );

  if (!toolUse) {
    const text = response.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join(' ')
      .slice(0, 500);
    throw new AiResponseError(
      `Модель не вернула структурированный ответ. Ответ: ${text || '(пусто)'}`,
      response,
    );
  }

  return {
    data: toolUse.input as T,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
    model,
  };
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
