export type DataStatus = 'VERIFIED' | 'USER_CONFIRMED' | 'ESTIMATED' | 'MISSING' | 'STALE';
export interface DataEvidence {
  value: number | null;
  status: DataStatus;
  source: string;
  obtainedAt: string;
  formula?: string;
  assumptions?: string[];
}

/** Snapshot input evidence without claiming document verification for user-entered values. */
export function financeEvidence(input: unknown, userId: string, obtainedAt = new Date().toISOString()): Record<string, DataEvidence> {
  const evidence: Record<string, DataEvidence> = {};
  function visit(value: unknown, prefix: string) {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      const field = prefix ? `${prefix}.${key}` : key;
      if (key.endsWith('Minor') || key.endsWith('Percent')) {
        const amount = typeof item === 'number' && Number.isFinite(item) ? item : null;
        evidence[field] = { value: amount, status: amount === null ? 'MISSING' : amount === 0 ? 'ESTIMATED' : 'USER_CONFIRMED',
          source: `user:${userId}`, obtainedAt,
          ...(amount === 0 ? { assumptions: ['Нулевое значение требует отдельного подтверждения отсутствия расхода/налога.'] } : {}) };
      } else visit(item, field);
    }
  }
  visit(input, '');
  return evidence;
}
