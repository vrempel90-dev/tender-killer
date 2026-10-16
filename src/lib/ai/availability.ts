import { getAiConfig } from './config';
import { OllamaProvider } from './providers/ollama';

export type AiAvailability = {
  state: 'available' | 'unavailable' | 'not_configured' | 'unverified';
  title: string;
  description: string;
};

/** Passive, bounded probe. Never generates text, pulls a model or calls a paid API. */
export async function checkAiAvailability(): Promise<AiAvailability> {
  try {
    const config = getAiConfig();
    if (config.AI_PROVIDER === 'anthropic') {
      if (!(process.env.ANTHROPIC_API_KEY ?? '').trim()
        || process.env.AI_EXTERNAL_TRANSFER_APPROVED !== 'true') {
        return { state: 'not_configured', title: 'Внешний AI не настроен',
          description: 'Выбран внешний провайдер. Администратору необходимо завершить его настройку или выбрать локальную Ollama.' };
      }
      return { state: 'unverified', title: 'Выбран внешний AI-провайдер',
        description: 'Конфигурация задана. Проверка подключения доступна администратору в настройках AI.' };
    }
    const provider = new OllamaProvider(config);
    try {
      await provider.inspect(AbortSignal.timeout(2_000));
      return { state: 'available', title: 'Ollama доступна',
        description: `Локальная модель ${config.OLLAMA_MODEL} установлена. Проверка генерации доступна администратору в настройках AI.` };
    } catch {
      return { state: 'unavailable', title: 'Ollama пока недоступна',
        description: `Сервер не ответил или локальная модель ${config.OLLAMA_MODEL} не готова. Обратитесь к администратору. Финансовый калькулятор и работа с документами доступны независимо от AI.` };
    }
  } catch {
    return { state: 'not_configured', title: 'AI-модель не настроена',
      description: 'Администратору необходимо проверить конфигурацию AI. Финансовый калькулятор и работа с документами доступны независимо от AI.' };
  }
}

// Coalesce concurrent dashboard loads; the probe uses only model metadata.
// Do not cache document content, credentials or internal addresses here.
let cached: { until: number; result: Promise<AiAvailability> } | undefined;
export function getAiAvailability(): Promise<AiAvailability> {
  if (!cached || Date.now() >= cached.until) {
    cached = { until: Date.now() + 15_000, result: checkAiAvailability() };
  }
  return cached.result;
}
