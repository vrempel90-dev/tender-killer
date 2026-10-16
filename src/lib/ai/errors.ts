/** Public errors never retain provider payloads, prompts, URLs or credentials. */
export class AiNotConfiguredError extends Error {
  constructor(message = 'AI-анализ недоступен: проверьте настройки AI-модели. Остальные функции платформы работают.') {
    super(message);
    this.name = 'AiNotConfiguredError';
  }
}

export class AiResponseError extends Error {
  constructor(message: string, _raw?: unknown) {
    super(message);
    this.name = 'AiResponseError';
  }
}
