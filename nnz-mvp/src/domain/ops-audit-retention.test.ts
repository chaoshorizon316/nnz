import { describe, expect, it } from 'vitest';

import {
  applyOpsAuditRetention,
  hasOpsAuditRetentionPolicy,
  parseOpsAuditRetentionPolicy,
} from './ops-audit-retention';
import { InMemorySoulStore } from './soul-store';
import type { OpsAuditEvent } from './types';

describe('Ops audit retention policy', () => {
  it('is disabled by default and requires positive integer env values', () => {
    expect(parseOpsAuditRetentionPolicy({})).toEqual({});
    expect(hasOpsAuditRetentionPolicy({})).toBe(false);
    expect(parseOpsAuditRetentionPolicy({
      NNZ_OPS_AUDIT_RETENTION_DAYS: '30',
      NNZ_OPS_AUDIT_MAX_EVENTS: '500',
    })).toEqual({ retentionDays: 30, maxEvents: 500 });

    expect(() => parseOpsAuditRetentionPolicy({ NNZ_OPS_AUDIT_RETENTION_DAYS: '0' }))
      .toThrow('NNZ_OPS_AUDIT_RETENTION_DAYS must be a positive integer.');
    expect(() => parseOpsAuditRetentionPolicy({ NNZ_OPS_AUDIT_MAX_EVENTS: '1.5' }))
      .toThrow('NNZ_OPS_AUDIT_MAX_EVENTS must be a positive integer.');
  });

  it('keeps only events inside the day window and max event cap', () => {
    const now = new Date('2026-07-10T00:00:00.000Z');
    const newest = auditEvent('audit_newest', '2026-07-10T00:00:00.000Z');
    const recent = auditEvent('audit_recent', '2026-07-09T00:00:00.000Z');
    const stillRecent = auditEvent('audit_still_recent', '2026-07-08T00:00:00.000Z');
    const old = auditEvent('audit_old', '2026-07-01T00:00:00.000Z');

    const result = applyOpsAuditRetention([old, stillRecent, newest, recent], {
      retentionDays: 7,
      maxEvents: 2,
    }, now);

    expect(result.retained.map((event) => event.id)).toEqual(['audit_newest', 'audit_recent']);
    expect(result.removed.map((event) => event.id).sort()).toEqual(['audit_old', 'audit_still_recent']);
  });

  it('prunes InMemory store audit events without touching other store data', () => {
    const store = new InMemorySoulStore();
    store.deserialize({
      users: [],
      personas: [],
      soulVersions: [],
      soulSnapshots: [],
      memoryItems: [],
      soulUpdateProposals: [],
      nodeEvents: [],
      conversationMessages: [],
      sessions: [],
      credentials: [],
      opsAuditEvents: [
        auditEvent('audit_1', '2026-07-10T00:00:00.000Z'),
        auditEvent('audit_2', '2026-07-09T00:00:00.000Z'),
        auditEvent('audit_3', '2026-07-08T00:00:00.000Z'),
      ],
    });

    const result = store.pruneOpsAuditEvents({ maxEvents: 2 }, new Date('2026-07-10T00:00:00.000Z'));

    expect(result).toEqual({ removed: 1, retained: 2 });
    expect(store.listOpsAuditEvents().map((event) => event.id)).toEqual(['audit_1', 'audit_2']);
    expect(store.serialize().users).toEqual([]);
  });
});

function auditEvent(id: string, createdAt: string): OpsAuditEvent {
  return {
    id,
    action: 'OVERVIEW_READ',
    outcome: 'SUCCESS',
    actor: 'ops:admin',
    targetUserIds: [],
    metadata: {},
    createdAt: new Date(createdAt),
  };
}
