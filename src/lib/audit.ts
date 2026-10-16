/**
 * Журнал операций. Пишется для всех действий, меняющих данные,
 * а также для запусков AI-анализа и загрузки/удаления документов.
 */

import { prisma } from './db';

export type AuditAction =
  | 'USER_REGISTER'
  | 'USER_LOGIN'
  | 'USER_LOGIN_FAILED'
  | 'USER_LOGOUT'
  | 'MFA_ENROLL_START'
  | 'MFA_ENABLED'
  | 'MFA_DISABLED'
  | 'MFA_VERIFIED'
  | 'MFA_VERIFY_FAILED'
  | 'MFA_RECOVERY_CODE_USED'
  | 'MFA_RECOVERY_CODES_REISSUED'
  | 'TENDER_CREATE'
  | 'TENDER_UPDATE'
  | 'TENDER_DELETE'
  | 'DOCUMENT_UPLOAD'
  | 'DOCUMENT_DELETE'
  | 'DOCUMENT_EXTRACT'
  | 'FINANCE_SAVE'
  | 'AI_REQUIREMENTS_RUN'
  | 'AI_COMPLIANCE_RUN'
  | 'AI_CONTRACT_RUN'
  | 'AI_SEMANTIC_RUN'
  | 'QUOTE_IMPORT'
  | 'QUOTE_DELETE'
  | 'HISTORY_IMPORT'
  | 'REPORT_GENERATE'
  | 'TAX_CONFIG_UPDATE'
  | 'PROFILE_UPDATE'
  | 'RADAR_IMPORT'
  | 'RADAR_IMPORT_DELETE'
  | 'RADAR_TENDER_CREATED'
  | 'SAVED_SEARCH_CREATE'
  | 'SAVED_SEARCH_DELETE'
  | 'WATCH_START'
  | 'WATCH_STOP'
  | 'WATCH_REVISION'
  | 'WATCH_CHANGE_ACK';

export async function writeAudit(params: {
  companyId: string;
  userId?: string | null;
  action: AuditAction;
  entity?: string;
  entityId?: string;
  ipAddress?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        companyId: params.companyId,
        userId: params.userId ?? null,
        action: params.action,
        entity: params.entity ?? null,
        entityId: params.entityId ?? null,
        ipAddress: params.ipAddress ?? null,
        metadata: (params.metadata ?? {}) as object,
      },
    });
  } catch (error) {
    // Журнал не должен ломать основную операцию, но молчать тоже нельзя.
    console.error(JSON.stringify({ event: 'audit_write_failed', type: error instanceof Error ? error.name : 'UnknownError' }));
  }
}
