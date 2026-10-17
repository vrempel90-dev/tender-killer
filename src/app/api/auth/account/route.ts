import { cookies } from 'next/headers';
import { z } from 'zod';
import { requireSession } from '@/lib/auth/guard';
import { deleteOwnAccount } from '@/lib/auth/account';
import { SESSION_COOKIE } from '@/lib/auth/session';
import { consumeQuota } from '@/lib/security/quota';
import { readJson } from '@/lib/security/request';
import { handleApiError, jsonOk } from '@/lib/http';

const Schema = z.object({ password: z.string().min(1).max(256), confirmation: z.literal('УДАЛИТЬ') }).strict();

export async function DELETE(request: Request) {
  try {
    const session = await requireSession();
    await consumeQuota('account-delete', session.userId, 5, 900);
    const data = Schema.parse(await readJson(request));
    await deleteOwnAccount(session, data.password);
    (await cookies()).delete(SESSION_COOKIE);
    return jsonOk({ deleted: true, message: 'Аккаунт удалён. Все сессии завершены. Общие данные компании сохранены.' });
  } catch (error) { return handleApiError(error); }
}
