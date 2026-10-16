import { afterEach, describe, expect, it, vi } from 'vitest';
import { interpretSources } from '../semantic';
import { PROMPT_VERSION } from '../prompts';

const generate = vi.hoisted(() => vi.fn());
vi.mock('../client', () => ({ callStructured: generate }));
const first = 'Компания поставляет бумажные стикеры для заметок.';
const second = 'Закупаются бумажные стикеры для заметок, 500 штук.';
const result = { explanation: 'Предмет закупки соответствует профилю поставок.', classification: 'MATCH',
  firstQuote: first, secondQuote: second, missingInformation: [] };
afterEach(() => vi.resetAllMocks());

describe('semantic interpretations remain evidence-bound and advisory', () => {
  it('preserves provenance and mandatory human review even for a grounded match', async () => {
    generate.mockResolvedValue({ data: result, provider: 'ollama', model: 'qwen3:8b', modelDigest: 'digest', usage: { inputTokens: 1, outputTokens: 1 } });
    expect(await interpretSources({ kind: 'RADAR', first, second })).toMatchObject({ classification: 'MATCH',
      quoteVerified: true, needsManualReview: true, modelDigest: 'digest', promptVersion: PROMPT_VERSION });
  });
  it.each([
    { firstQuote: 'Несуществующий поставщик и его предложение.' },
    { explanation: 'Компания поставит за 999 тенге.' },
    { classification: 'CRITICAL' },
  ])('downgrades missing evidence, invented numbers or an invalid task class: %j', async overrides => {
    generate.mockResolvedValue({ data: { ...result, ...overrides } });
    expect(await interpretSources({ kind: 'RADAR', first, second })).toMatchObject({ classification: 'UNCERTAIN', quoteVerified: false, needsManualReview: true });
  });
  it('compares two real supplied revisions with separate citations', async () => {
    const old = 'Поставка осуществляется в течение 30 календарных дней.';
    const next = 'Поставка осуществляется в течение 15 календарных дней.';
    generate.mockResolvedValue({ data: { ...result, classification: 'MAJOR', explanation: 'Срок поставки сокращён с 30 до 15 дней.', firstQuote: old, secondQuote: next } });
    expect(await interpretSources({ kind: 'GUARD', first: old, second: next })).toMatchObject({ classification: 'MAJOR', quoteVerified: true, needsManualReview: true });
  });
});
