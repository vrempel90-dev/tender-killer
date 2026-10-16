/** Explicit local-only smoke check. Never downloads a model. */
import 'dotenv/config';
import { z } from 'zod';
import { getAiConfig, trustedOllamaUrl } from '../src/lib/ai/config';
import { OllamaProvider } from '../src/lib/ai/providers/ollama';

async function main() {
  const config = getAiConfig();
  if (config.AI_PROVIDER !== 'ollama') throw new Error('This command checks only a local Ollama provider.');
  const provider = new OllamaProvider(config);
  const schema = z.object({ ok: z.literal(true) });
  const started = performance.now();
  const result = await provider.generate({ system: 'Верните JSON {"ok":true}.', userContent: 'Проверка подключения.',
    toolName: 'local_test', toolDescription: 'Локальный тест', inputSchema: z.toJSONSchema(schema), maxTokens: 256,
  }, AbortSignal.timeout(config.AI_TIMEOUT_MS));
  schema.parse(result.data);
  const ps = await fetch(new URL('/api/ps', trustedOllamaUrl(config.OLLAMA_BASE_URL)), { redirect: 'error', signal: AbortSignal.timeout(5000) }).then(r => r.json());
  const active = ps.models?.find((m: { name: string }) => m.name === config.OLLAMA_MODEL);
  console.log(JSON.stringify({ provider: result.provider, model: result.model, digest: result.modelDigest,
    structuredTest: 'passed', durationMs: Math.round(performance.now() - started),
    allocatedBytes: active?.size, vramBytes: active?.size_vram }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Local test failed'); process.exitCode = 1; });
