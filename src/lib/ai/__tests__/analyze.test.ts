/**
 * Тесты обработки ответов AI без обращения к API.
 * Проверяется поведение при недоступном ключе и при негодных ответах модели.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { analyzeContract, checkCompliance, extractLineItems, extractRequirements } from '../analyze';
import { AiNotConfiguredError, getAiModel, truncateForPrompt } from '../client';
import type { SourceDocument } from '../verify';

const readable: SourceDocument = {
  id: 'd1',
  name: 'ТЗ.pdf',
  text: '--- стр. 1 ---\nТребуется лицензия на монтаж оборудования связи.',
  extractionStatus: 'SUCCEEDED',
  unreadablePages: [],
};

const unreadable: SourceDocument = {
  id: 'd2',
  name: 'Скан.pdf',
  text: '',
  extractionStatus: 'FAILED',
  unreadablePages: [1],
};

describe('поведение без настроенного API-ключа', () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    if (originalKey !== undefined) process.env.ANTHROPIC_API_KEY = originalKey;
  });

  it('извлечение требований сообщает, что AI не настроен', async () => {
    await expect(extractRequirements({ documents: [readable] })).rejects.toThrow(
      AiNotConfiguredError,
    );
  });

  it('извлечение позиций сообщает, что AI не настроен', async () => {
    await expect(extractLineItems({ documents: [readable] })).rejects.toThrow(
      AiNotConfiguredError,
    );
  });

  it('проверка соответствия сообщает, что AI не настроен', async () => {
    await expect(
      checkCompliance({
        requirements: [
          {
            id: 'r1',
            label: 'Лицензия',
            text: 'Требуется лицензия',
            category: 'DOCUMENT',
            isMandatory: true,
          },
        ],
        supplierDocuments: [readable],
      }),
    ).rejects.toThrow(AiNotConfiguredError);
  });

  it('анализ договора сообщает, что AI не настроен', async () => {
    await expect(analyzeContract({ document: readable })).rejects.toThrow(
      AiNotConfiguredError,
    );
  });

  it('текст ошибки объясняет, что остальное работает', async () => {
    await expect(
      extractRequirements({ documents: [readable] }),
    ).rejects.toThrow(/ANTHROPIC_API_KEY/);
    await expect(
      extractRequirements({ documents: [readable] }),
    ).rejects.toThrow(/работают/);
  });
});

describe('проверки до обращения к модели', () => {
  it('не обращается к AI, если ни один документ не прочитан', async () => {
    // Ключ намеренно задан: ошибка должна быть о документах, а не о ключе.
    process.env.ANTHROPIC_API_KEY = 'тестовый-ключ-не-используется';
    await expect(
      extractRequirements({ documents: [unreadable] }),
    ).rejects.toThrow(/не прочитан/);
    await expect(
      extractLineItems({ documents: [unreadable] }),
    ).rejects.toThrow(/не прочитан/);
    await expect(
      analyzeContract({ document: unreadable }),
    ).rejects.toThrow(/не прочитано/);
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('не проверяет соответствие при пустом списке требований', async () => {
    process.env.ANTHROPIC_API_KEY = 'тестовый-ключ-не-используется';
    await expect(
      checkCompliance({ requirements: [], supplierDocuments: [readable] }),
    ).rejects.toThrow(/требований пуст/);
    delete process.env.ANTHROPIC_API_KEY;
  });
});

describe('подготовка текста для модели', () => {
  it('не изменяет текст в пределах лимита', () => {
    const r = truncateForPrompt('короткий текст', 1000);
    expect(r.truncated).toBe(false);
    expect(r.text).toBe('короткий текст');
  });

  it('сокращает длинный текст, сохраняя начало и конец', () => {
    const text = 'НАЧАЛО' + 'x'.repeat(5000) + 'КОНЕЦ';
    const r = truncateForPrompt(text, 1000);
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBeLessThan(text.length);
    expect(r.text.startsWith('НАЧАЛО')).toBe(true);
    expect(r.text.endsWith('КОНЕЦ')).toBe(true);
    // пользователь должен понимать, что текст сокращён
    expect(r.text).toContain('пропущено');
  });
});

describe('выбор модели', () => {
  const original = process.env.ANTHROPIC_MODEL;
  afterEach(() => {
    if (original === undefined) delete process.env.ANTHROPIC_MODEL;
    else process.env.ANTHROPIC_MODEL = original;
  });

  it('берёт модель из переменной окружения', () => {
    process.env.ANTHROPIC_MODEL = 'claude-opus-5-5';
    expect(getAiModel()).toBe('claude-opus-5-5');
  });

  it('использует значение по умолчанию, если переменная пуста', () => {
    process.env.ANTHROPIC_MODEL = '';
    expect(getAiModel()).toBe('claude-sonnet-5-5');
  });
});
