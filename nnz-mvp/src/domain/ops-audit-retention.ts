import type { OpsAuditEvent } from './types';

export interface OpsAuditRetentionPolicy {
  retentionDays?: number;
  maxEvents?: number;
}

export interface OpsAuditRetentionResult {
  retained: OpsAuditEvent[];
  removed: OpsAuditEvent[];
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function parseOpsAuditRetentionPolicy(env: Record<string, string | undefined>): OpsAuditRetentionPolicy {
  const policy: OpsAuditRetentionPolicy = {};
  const retentionDays = readPositiveIntegerEnv(env, 'NNZ_OPS_AUDIT_RETENTION_DAYS');
  const maxEvents = readPositiveIntegerEnv(env, 'NNZ_OPS_AUDIT_MAX_EVENTS');
  if (retentionDays !== undefined) policy.retentionDays = retentionDays;
  if (maxEvents !== undefined) policy.maxEvents = maxEvents;
  return policy;
}

export function hasOpsAuditRetentionPolicy(policy: OpsAuditRetentionPolicy): boolean {
  return policy.retentionDays !== undefined || policy.maxEvents !== undefined;
}

export function applyOpsAuditRetention(
  events: OpsAuditEvent[],
  policy: OpsAuditRetentionPolicy,
  now = new Date(),
): OpsAuditRetentionResult {
  if (!hasOpsAuditRetentionPolicy(policy)) {
    return { retained: [...events], removed: [] };
  }

  const cutoff = policy.retentionDays === undefined
    ? undefined
    : new Date(now.getTime() - policy.retentionDays * MS_PER_DAY);
  const byNewest = [...events].sort(compareAuditEventDesc);
  const retained: OpsAuditEvent[] = [];
  const removed: OpsAuditEvent[] = [];

  for (const event of byNewest) {
    if (cutoff && event.createdAt < cutoff) {
      removed.push(event);
      continue;
    }
    if (policy.maxEvents !== undefined && retained.length >= policy.maxEvents) {
      removed.push(event);
      continue;
    }
    retained.push(event);
  }

  return { retained, removed };
}

function readPositiveIntegerEnv(
  env: Record<string, string | undefined>,
  key: 'NNZ_OPS_AUDIT_RETENTION_DAYS' | 'NNZ_OPS_AUDIT_MAX_EVENTS',
): number | undefined {
  const raw = env[key]?.trim();
  if (!raw) return undefined;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${key} must be a positive integer.`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${key} must be a positive integer.`);
  }
  return value;
}

function compareAuditEventDesc(left: OpsAuditEvent, right: OpsAuditEvent): number {
  return right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id);
}
