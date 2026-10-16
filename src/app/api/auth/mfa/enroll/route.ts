import { requirePartialSession } from '@/lib/auth/guard';
import { renderQrPath } from '@/lib/auth/mfa/qr';
import { startMfaEnrollment } from '@/lib/auth/mfa/service';
import { writeAudit } from '@/lib/audit';
import { clientIp, handleApiError, jsonError, jsonOk } from '@/lib/http';
import { consumeQuota } from '@/lib/security/quota';

export async function POST(request: Request) {
  try {
    const session = await requirePartialSession();
    // Ограничение на перегенерацию секрета: иначе журнал и БД засоряются.
    await consumeQuota('mfa-enroll', session.userId, 10, 900);

    const enrollment = await startMfaEnrollment({
      userId: session.userId,
      accountName: session.email,
    });

    await writeAudit({
      companyId: session.companyId,
      userId: session.userId,
      action: 'MFA_ENROLL_START',
      ipAddress: clientIp(request),
    });

    // Секрет возвращается ровно один раз — для QR и ручного ввода.
    return jsonOk({
      secretForDisplay: enrollment.secretForDisplay,
      otpauthUri: enrollment.otpauthUri,
      qr: renderQrPath(enrollment.otpauthUri),
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Второй фактор уже')) {
      return jsonError(error.message, 409);
    }
    return handleApiError(error);
  }
}
