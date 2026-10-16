import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { planChunks } from '../chunks';
import { runChunkedJob } from '../jobs';
import { REQUIREMENTS_SYSTEM } from '../prompts';
import { REQUIREMENTS_TOOL_SCHEMA } from '../schemas';
import type { SourceDocument } from '../verify';

const state = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), checkpoint: vi.fn(), auth: vi.fn() }));
vi.mock('../../auth/guard', () => ({ requireWriteAccess: state.auth }));
vi.mock('../../db', () => ({ prisma: { aiAnalysisJob: { create: state.create, update: state.update }, aiAnalysisChunk: { create: state.checkpoint } } }));
const doc: SourceDocument = { id: 'd', name: 'ТЗ', text: 'я'.repeat(9000), extractionStatus: 'SUCCEEDED', unreadablePages: [] };
beforeEach(() => {
  vi.stubEnv('AI_PROVIDER', 'ollama');
  state.auth.mockResolvedValue({ companyId: 'tenant-a', userId: 'user-a' });
  state.create.mockResolvedValue({ id: 'job' }); state.update.mockResolvedValue({}); state.checkpoint.mockResolvedValue({});
});
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });
describe('fragment planning and persistence', () => {
  it('covers all characters, including the middle, without modifying sources', () => {
    const unique = { ...doc, text: Array.from({ length: 5000 }, (_, i) => `Строка${i}\n`).join('') };
    const chunks = planChunks([unique], REQUIREMENTS_SYSTEM, REQUIREMENTS_TOOL_SCHEMA);
    const joined = chunks.flat().map(d => d.text).join('');
    for (let i = 0; i < 5000; i++) expect(joined).toContain(`Строка${i}`);
    expect(chunks.flat().every(d => d.analysisTruncated)).toBe(true);
  });
  it('refuses excessive document/chunk counts explicitly', () => {
    vi.stubEnv('AI_MAX_CHUNKS', '1'); expect(() => planChunks([doc], REQUIREMENTS_SYSTEM, REQUIREMENTS_TOOL_SCHEMA)).toThrow('текст не обрезан');
  });
  it('runs sequentially and checkpoints only completed verified chunks', async () => {
    const order: number[] = [];
    const run = vi.fn(async () => { order.push(order.length); return { meta: { model: 'qwen3:8b' }, verified: true }; });
    const result = await runChunkedJob('TEST', [doc], [[doc], [doc]], run);
    expect(result).toHaveLength(2); expect(order).toEqual([0, 1]);
    expect(state.create.mock.calls[0]?.[0].data.companyId).toBe('tenant-a');
    expect(state.checkpoint).toHaveBeenCalledTimes(2);
    expect(state.update.mock.lastCall?.[0].data.status).toBe('SUCCEEDED');
  });
  it('retains an earlier checkpoint and marks the entire failed run PARTIAL', async () => {
    const run = vi.fn().mockResolvedValueOnce({ meta: { model: 'qwen3:8b' } }).mockRejectedValueOnce(new Error('invalid JSON containing secret'));
    await expect(runChunkedJob('TEST', [doc], [[doc], [doc]], run)).rejects.toThrow('1/2');
    expect(state.checkpoint).toHaveBeenCalledTimes(1); expect(state.update.mock.lastCall?.[0].data.status).toBe('PARTIAL');
    expect(JSON.stringify(state.update.mock.calls)).not.toContain('secret');
  });
  it('does not combine different model versions', async () => {
    const run = vi.fn().mockResolvedValueOnce({ meta: { model: 'qwen3:8b', modelDigest: 'a' } })
      .mockResolvedValueOnce({ meta: { model: 'qwen3:8b', modelDigest: 'b' } });
    await expect(runChunkedJob('TEST', [doc], [[doc], [doc]], run)).rejects.toThrow('не завершён');
    expect(state.checkpoint).toHaveBeenCalledTimes(1); expect(state.update.mock.lastCall?.[0].data.status).toBe('PARTIAL');
  });
});
