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
  | 'QUOTE_IMPORT'
  | 'QUOTE_DELETE'
  | 'HISTORY_IMPORT'
  | 'REPORT_GENERATE'
  | 'TAX_CONFIG_UPDATE';

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
    console.error('Не удалось записать событие в журнал операций:', error);
  }
}
