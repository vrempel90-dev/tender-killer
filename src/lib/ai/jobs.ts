import { createHash } from 'node:crypto';
import { requireWriteAccess } from '../auth/guard';
import { prisma } from '../db';
import type { SourceDocument } from './verify';
import { AiResponseError } from './errors';

/** Durable checkpoints for long analyses; no unvalidated model payload is stored. */
export async function runChunkedJob<T extends { meta: { model: string; provider?: string; modelDigest?: string } }>(kind: string, documents: SourceDocument[], chunks: SourceDocument[][],
  run: (documents: SourceDocument[], signal?: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T[]> {
  if (chunks.length === 1 && chunks[0]) return [await run(chunks[0], signal)];
  const session = await requireWriteAccess();
  const job = await prisma.aiAnalysisJob.create({ data: {
    companyId: session.companyId, userId: session.userId, kind, status: 'QUEUED', totalChunks: chunks.length,
    sources: documents.map(d => ({ id: d.id, sha256: createHash('sha256').update(d.text).digest('hex') })),
  } });
  const deadline = AbortSignal.timeout(600_000);
  const bounded = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const results: T[] = [];
  try {
    await prisma.aiAnalysisJob.update({ where: { id: job.id }, data: { status: 'RUNNING' } });
    for (let i = 0; i < chunks.length; i++) {
      bounded.throwIfAborted();
      const fragment = chunks[i];
      if (!fragment) throw new AiResponseError('Нет фрагмента документа.');
      const result = await run(fragment, bounded);
      const first = results[0]?.meta;
      if (first && (first.model !== result.meta.model || first.provider !== result.meta.provider || first.modelDigest !== result.meta.modelDigest)) {
        throw new AiResponseError('Модель или её версия изменилась между фрагментами.');
      }
      // Written after Zod, evidence and numeric verification in analyze.ts.
      await prisma.aiAnalysisChunk.create({ data: { jobId: job.id, position: i, result: JSON.parse(JSON.stringify(result)) } });
      results.push(result);
      await prisma.aiAnalysisJob.update({ where: { id: job.id }, data: { completedChunks: results.length } });
    }
    await prisma.aiAnalysisJob.update({ where: { id: job.id }, data: { status: 'SUCCEEDED', finishedAt: new Date() } });
    return results;
  } catch (cause) {
    // Keep a bounded, non-sensitive diagnostic category; never persist prompts or model output.
    const reason = bounded.aborted ? 'TIMEOUT' : cause instanceof AiResponseError ? 'AI_RESPONSE' : 'UNEXPECTED';
    console.error('[ai-chunk-job] failed', { kind, jobId: job.id, completedChunks: results.length, totalChunks: chunks.length, reason });
    await prisma.aiAnalysisJob.update({ where: { id: job.id }, data: {
      status: results.length ? 'PARTIAL' : 'FAILED', finishedAt: new Date(),
      error: reason === 'TIMEOUT' ? 'Прервано или превышено общее время анализа' : reason === 'AI_RESPONSE' ? 'Ошибка ответа AI-модели' : 'Внутренняя ошибка обработки AI-задания',
    } });
    throw new AiResponseError(`Анализ не завершён: обработано ${results.length}/${chunks.length} фрагментов. Причина: ${reason}. Требует ручной проверки. Промежуточные результаты: задание ${job.id} в настройках AI.`);
  }
}
