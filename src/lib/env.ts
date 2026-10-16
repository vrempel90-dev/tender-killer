import { z } from 'zod';
import { AiConfigSchema, getAiConfig, trustedOllamaUrl } from './ai/config';

/**
 * Валидация переменных окружения. Приложение не должно стартовать с
 * невалидной конфигурацией, но отсутствие ANTHROPIC_API_KEY — допустимое
 * состояние: AI-модули тогда честно показываются как недоступные.
 */
const EnvSchema = AiConfigSchema.extend({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL обязателен'),
  SESSION_SECRET: z
    .string()
    .min(32, 'SESSION_SECRET должен быть не короче 32 символов'),
  ANTHROPIC_API_KEY: z.string().optional().default(''),
  ANTHROPIC_MODEL: z.string().optional().default('claude-sonnet-5-5'),
  STORAGE_DIR: z.string().optional().default('./storage'),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().optional().default(26_214_400),
  APP_URL: z.string().optional().default('http://localhost:3000'),
  NODE_ENV: z.enum(['development', 'test', 'production']).optional().default('development'),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(
      `Некорректная конфигурация окружения. ${details}. Смотрите .env.example`,
    );
  }
  cached = parsed.data;
  return cached;
}

/** Настроен ли доступ к Anthropic API (от этого зависит доступность AI-модулей). */
export function isAiConfigured(): boolean {
  try {
    const config = getAiConfig();
    if (config.AI_PROVIDER === 'ollama') { trustedOllamaUrl(config.OLLAMA_BASE_URL); return true; }
    return (process.env.ANTHROPIC_API_KEY ?? '').trim().length > 0
      && process.env.AI_EXTERNAL_TRANSFER_APPROVED === 'true';
  } catch { return false; }
}
