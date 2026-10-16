import { requireSession } from '@/lib/auth/guard';
import { prisma } from '@/lib/db';
import { handleApiError, jsonError, jsonOk } from '@/lib/http';

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    // A process crash must not leave a job looking as though it runs forever.
    await prisma.aiAnalysisJob.updateMany({ where: { companyId: session.companyId,
      status: { in: ['QUEUED', 'RUNNING'] }, updatedAt: { lt: new Date(Date.now() - 660_000) } },
    data: { status: 'PARTIAL', error: 'Выполнение прервалось. Проверьте сохранённые фрагменты вручную.', finishedAt: new Date() } });
    const id = new URL(request.url).searchParams.get('id');
    if (id) {
      const position = Number(new URL(request.url).searchParams.get('position') ?? '0');
      if (!Number.isInteger(position) || position < 0 || position > 99) return jsonError('Некорректный номер фрагмента', 422);
      const job = await prisma.aiAnalysisJob.findFirst({ where: { id, companyId: session.companyId },
        include: { chunks: { orderBy: { position: 'asc' }, select: { position: true, createdAt: true } } } });
      if (!job) return jsonError('Задание не найдено', 404);
      const checkpoint = await prisma.aiAnalysisChunk.findFirst({ where: { jobId: id, position } });
      return jsonOk({ ...job, checkpoint });
    }
    return jsonOk(await prisma.aiAnalysisJob.findMany({ where: { companyId: session.companyId },
      orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, kind: true, status: true,
        completedChunks: true, totalChunks: true, createdAt: true, error: true } }));
  } catch (error) { return handleApiError(error); }
}
