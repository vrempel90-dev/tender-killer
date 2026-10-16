/** Explicit opt-in benchmark. Does not pull models or call paid providers.
 * npx tsx scripts/evaluate-local-ai.ts manifest.json report.json
 * Manifest: {documents:[{id,path,sourceUrl,reference:[{id,terms:string[]}]}]}
 * Use only public/non-confidential PDFs and reviewed reference requirements.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { z } from 'zod';
import { extractDocument } from '../src/lib/documents/extract';
import { OllamaProvider } from '../src/lib/ai/providers/ollama';
import { getAiConfig, trustedOllamaUrl } from '../src/lib/ai/config';
import { planChunks } from '../src/lib/ai/chunks';
import { REQUIREMENTS_SYSTEM, PROMPT_VERSION } from '../src/lib/ai/prompts';
import { REQUIREMENTS_TOOL_SCHEMA, RequirementsResponseSchema } from '../src/lib/ai/schemas';
import { claimsNumbersGrounded, verifyQuote } from '../src/lib/ai/verify';
import { assertSafeAiInput } from '../src/lib/ai/client';

const Manifest = z.object({ documents: z.array(z.object({ id: z.string(), path: z.string(), sourceUrl: z.url(),
  pages: z.array(z.number().int().positive()).min(1).optional(),
  reference: z.array(z.object({ id: z.string(), terms: z.array(z.string()) })) })).min(1).max(10) });

async function main() {
  const manifestPath = process.argv[2], outputPath = process.argv[3];
  if (!manifestPath || !outputPath) throw new Error('Specify manifest.json and report.json. No model is installed automatically.');
  process.env.AI_PROVIDER = 'ollama';
  const manifest = Manifest.parse(JSON.parse(await readFile(manifestPath, 'utf8')));
  const corpus = [];
  for (const item of manifest.documents) {
    const buffer = await readFile(item.path);
    const extracted = await extractDocument({ buffer, mimeType: 'application/pdf', originalName: 'public.pdf' });
    if (extracted.status !== 'SUCCEEDED') throw new Error(`Incomplete source extraction: ${item.id}`);
    const selected = item.pages ? extracted.text.split(/(?=--- стр\. \d+ ---)/).filter(page => {
      const number = Number(/--- стр\. (\d+) ---/.exec(page)?.[1]);
      return item.pages?.includes(number);
    }).join('\n') : extracted.text;
    if (!selected) throw new Error('No selected pages');
    assertSafeAiInput(selected);
    corpus.push({ ...item, sha256: createHash('sha256').update(buffer).digest('hex'),
      document: { id: item.id, name: item.id, text: selected, extractionStatus: 'SUCCEEDED' as const, unreadablePages: [] } });
  }
  const report = { createdAt: new Date().toISOString(), promptVersion: PROMPT_VERSION,
    runtimeLabel: process.env.AI_EVALUATION_RUNTIME_LABEL ?? 'unspecified; record server settings separately',
    parameters: { contextTokens: getAiConfig().AI_CONTEXT_TOKENS, outputTokens: getAiConfig().AI_MAX_OUTPUT_TOKENS, temperature: 0, thinking: false },
    hardware: { platform: os.platform(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, ramBytes: os.totalmem() },
    note: 'Evidence/number grounding and reference coverage are automatic proxies. Semantic precision requires human review. Allocated model memory is not peak system memory.',
    runs: [] as object[] };
  for (const model of ['qwen3:4b', 'qwen3:8b'] as const) {
    process.env.OLLAMA_MODEL = model;
    const config = getAiConfig();
    const provider = new OllamaProvider(config);
    const installed = await provider.inspect(AbortSignal.timeout(5000));
    for (const item of corpus) {
      const chunks = planChunks([item.document], REQUIREMENTS_SYSTEM, REQUIREMENTS_TOOL_SCHEMA);
      const started = performance.now();
      const outputs = []; const errors: string[] = [];
      let valid = 0, allocatedBytes = 0, vramBytes = 0;
      for (const group of chunks) {
        try {
          const result = await provider.generate<unknown>({ system: REQUIREMENTS_SYSTEM,
            userContent: `Извлеките требования из фрагмента. Документ: ${item.id}\n${group.map(d => d.text).join('\n')}`,
            toolName: 'save_requirements', toolDescription: 'Извлечение требований', inputSchema: REQUIREMENTS_TOOL_SCHEMA as unknown as Record<string, unknown>,
          }, AbortSignal.timeout(config.AI_TIMEOUT_MS));
          const parsed = RequirementsResponseSchema.parse(result.data); valid++;
          outputs.push({ ...result, data: parsed });
          console.log(JSON.stringify({ model, document: item.id, chunk: valid, totalChunks: chunks.length, requirements: parsed.requirements.length }));
          const ps = await fetch(new URL('/api/ps', trustedOllamaUrl(config.OLLAMA_BASE_URL)), { signal: AbortSignal.timeout(5000), redirect: 'error' }).then(r => r.json());
          for (const active of ps.models ?? []) if (active.name === model) {
            allocatedBytes = Math.max(allocatedBytes, active.size ?? 0); vramBytes = Math.max(vramBytes, active.size_vram ?? 0);
          }
        } catch (error) { errors.push(error instanceof Error ? error.message : 'Unknown error'); }
      }
      const requirements = outputs.flatMap(r => r.data.requirements);
      const verified = requirements.filter(r => verifyQuote(r.sourceQuote, [item.document]).verified);
      const grounded = verified.filter(r => claimsNumbersGrounded(r.text + ' ' + r.label, r.sourceQuote));
      const normalized = (value: string) => value.toLowerCase().replace(/\s+/g, ' ');
      const references = item.reference.map(ref => ({ id: ref.id, covered: requirements.some(r => ref.terms.every(term => normalized(r.sourceQuote + ' ' + r.text).includes(normalized(term)))) }));
      report.runs.push({ model, modelDigest: installed.digest, documentId: item.id, sourceUrl: item.sourceUrl, sha256: item.sha256,
        pages: item.pages ?? 'all', chars: item.document.text.length, chunks: chunks.length, validResponses: valid, durationMs: Math.round(performance.now() - started),
        allocatedBytes, vramBytes, extracted: requirements.length, verifiedQuotes: verified.length,
        groundedConclusions: grounded.length, numericOrQuoteFailures: requirements.length - grounded.length,
        numericClaimMismatches: requirements.filter(r => !claimsNumbersGrounded(r.text + ' ' + r.label, r.sourceQuote)).length,
        referenceCoverage: references, errors, outputs });
      await writeFile(outputPath, JSON.stringify(report, null, 2));
    }
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Benchmark failed'); process.exitCode = 1; });
