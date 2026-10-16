import Anthropic from '@anthropic-ai/sdk';
import { RequestError } from '../../security/request';
import { AiNotConfiguredError, AiResponseError } from '../errors';
import type { AIProvider, StructuredCallParams, StructuredCallResult } from '../provider';

export function getAiClient(): Anthropic {
  const apiKey = (process.env.ANTHROPIC_API_KEY ?? '').trim();
  if (!apiKey) throw new AiNotConfiguredError('AI-анализ недоступен: не задан ANTHROPIC_API_KEY. Остальные функции платформы работают.');
  if (process.env.AI_PROVIDER !== 'anthropic' || process.env.AI_EXTERNAL_TRANSFER_APPROVED !== 'true') {
    throw new RequestError('Внешний AI отключён: требуется явный выбор anthropic и AI_EXTERNAL_TRANSFER_APPROVED.', 503);
  }
  return new Anthropic({ apiKey, maxRetries: 0, timeout: 180_000 });
}

export class AnthropicProvider implements AIProvider {
  readonly name = 'anthropic' as const;
  readonly model = (process.env.ANTHROPIC_MODEL ?? '').trim() || 'claude-sonnet-5-5';
  async generate<T>(params: StructuredCallParams, signal: AbortSignal): Promise<StructuredCallResult<T>> {
    const response = await getAiClient().messages.create({
      model: this.model, max_tokens: params.maxTokens ?? 8000, temperature: params.temperature ?? 0,
      system: params.system,
      tools: [{ name: params.toolName, description: params.toolDescription, input_schema: params.inputSchema as Anthropic.Tool['input_schema'] }],
      tool_choice: { type: 'tool', name: params.toolName }, messages: [{ role: 'user', content: params.userContent }],
    }, { signal });
    const blocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === params.toolName);
    if (response.stop_reason !== 'tool_use' || blocks.length !== 1) throw new AiResponseError('Модель не завершила структурированный ответ. Требует ручной проверки.');
    const block = blocks[0];
    if (!block) throw new AiResponseError('Нет структурированного ответа.');
    return { data: block.input as T, model: response.model, provider: this.name,
      usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens } };
  }
}
