import { expect, it } from 'vitest';
import { trustedOllamaUrl } from '../config';
it('allows only the exact private Railway Ollama service, with no URL decorations', () => {
  expect(trustedOllamaUrl('http://ollama.railway.internal:11434').hostname).toBe('ollama.railway.internal');
  for (const url of ['http://ollama.railway.internal.evil:11434', 'https://ollama.railway.internal:11434',
    'http://user:pass@ollama.railway.internal:11434', 'http://other.railway.internal:11434',
    'http://ollama.railway.internal:11434/api/chat', 'http://ollama.railway.internal:11434/?x=1']) {
    expect(() => trustedOllamaUrl(url)).toThrow();
  }
});
