import { describe, expect, it } from 'vitest';

import { InMemorySoulStore } from '../domain/soul-store';
import { buildOpsOverview, buildTestUserCleanupPlan, cleanupTestUsers, queryOpsAuditEvents } from './ops-console';

function seedOpsStore() {
  const store = new InMemorySoulStore();

  const userA = store.createUser('用户 A');
  const personaA = store.createPersona({
    userId: userA.id,
    displayName: '爸爸',
    relationship: '女儿',
    type: 'DECEASED',
  });
  store.createSoulVersion({
    userId: userA.id,
    personaId: personaA.id,
    kernelJson: {
      identityCore: { displayName: '爸爸', relationship: '女儿心中的父亲' },
      affectModel: { humorLevel: 'low' },
    },
  });
  store.addMemory({
    userId: userA.id,
    personaId: personaA.id,
    type: 'DESCRIPTION',
    content: '用户 A 的演示记忆。',
    confidence: 0.9,
    enabledForSoul: true,
  });

  const normal = store.createUser('real.user@example.com');
  store.storeCredential(normal.id, 'real.user@example.com', 'hash-real');
  const normalPersona = store.createPersona({
    userId: normal.id,
    displayName: '妈妈',
    relationship: '孩子',
    type: 'DECEASED',
  });
  store.createSoulVersion({
    userId: normal.id,
    personaId: normalPersona.id,
    kernelJson: {
      identityCore: { displayName: '妈妈', relationship: '孩子心中的母亲' },
      affectModel: { humorLevel: 'medium' },
    },
  });

  const smoke = store.createUser('codex-ops-smoke-20260611@example.test');
  store.storeCredential(smoke.id, 'codex-ops-smoke-20260611@example.test', 'hash-smoke');
  const smokePersona = store.createPersona({
    userId: smoke.id,
    displayName: '爸爸',
    relationship: '孩子',
    type: 'DECEASED',
  });
  store.createSoulVersion({
    userId: smoke.id,
    personaId: smokePersona.id,
    kernelJson: {
      identityCore: { displayName: '爸爸', relationship: '孩子心中的父亲' },
      affectModel: { humorLevel: 'medium' },
    },
  });
  const evidence = store.addMemory({
    userId: smoke.id,
    personaId: smokePersona.id,
    type: 'CORRECTION',
    content: '烟测用户的纠正记忆。',
    confidence: 1,
    enabledForSoul: true,
  });
  store.createSoulUpdateProposal({
    userId: smoke.id,
    personaId: smokePersona.id,
    fieldPath: 'affectModel.humorLevel',
    newValue: 'high',
    evidenceIds: [evidence.id],
  });
  store.createNode({ userId: smoke.id, personaId: smokePersona.id, name: '烟测节点' });
  store.addConversation({ userId: smoke.id, personaId: smokePersona.id, role: 'USER', content: '烟测消息' });

  return { store, userA, personaA, normal, normalPersona, smoke, smokePersona };
}

describe('Soul Ops console helpers', () => {
  it('summarizes users without mixing user/persona scoped maturity reports', () => {
    const { store, userA, personaA, normal, smoke, smokePersona } = seedOpsStore();

    const overview = buildOpsOverview(store, {
      mode: 'memory',
      runtimeMode: 'snapshot',
      requestedRuntimeMode: null,
      postgresConfigured: false,
      postgresEnv: null,
      scopedPostgresConfigured: false,
      scopedPostgresEnv: null,
      sqliteConfigured: false,
      startupBlocked: false,
      startupBlockReason: null,
    });

    expect(overview.totals.users).toBe(3);
    expect(overview.totals.testUsers).toBe(1);
    expect(overview.totals.opsAuditEvents).toBe(0);
    expect(overview.users.find((user) => user.id === userA.id)).toMatchObject({
      isDemoUser: true,
      isTestUser: false,
    });
    expect(overview.users.find((user) => user.id === normal.id)).toMatchObject({
      isDemoUser: false,
      isTestUser: false,
    });

    const smokeSummary = overview.users.find((user) => user.id === smoke.id);
    expect(smokeSummary).toMatchObject({
      isDemoUser: false,
      isTestUser: true,
      counts: {
        personas: 1,
        memories: 1,
        proposals: 1,
        nodes: 1,
        conversations: 1,
      },
    });
    expect(smokeSummary?.personas[0]?.maturity).toMatchObject({
      userId: smoke.id,
      personaId: smokePersona.id,
      proposalCount: 1,
      nodeCount: 1,
    });

    const demoSummary = overview.users.find((user) => user.id === userA.id);
    expect(demoSummary?.personas[0]?.maturity).toMatchObject({
      userId: userA.id,
      personaId: personaA.id,
      memoryCount: 1,
      proposalCount: 0,
    });
  });

  it('includes recent ops audit events without exposing secret values', () => {
    const { store, smoke } = seedOpsStore();
    store.recordOpsAuditEvent({
      action: 'OVERVIEW_READ',
      outcome: 'SUCCESS',
      actor: 'ops-token',
      metadata: { path: '/api/ops/overview' },
    });
    store.recordOpsAuditEvent({
      action: 'CLEANUP_DRY_RUN',
      outcome: 'SUCCESS',
      actor: 'ops-token',
      targetUserIds: [smoke.id],
      metadata: { candidateUsers: 1, dryRun: true },
    });

    const overview = buildOpsOverview(store, {
      mode: 'memory',
      runtimeMode: 'snapshot',
      requestedRuntimeMode: null,
      postgresConfigured: false,
      postgresEnv: null,
      scopedPostgresConfigured: false,
      scopedPostgresEnv: null,
      sqliteConfigured: false,
      startupBlocked: false,
      startupBlockReason: null,
    });

    expect(overview.totals.opsAuditEvents).toBe(2);
    expect(overview.audit.total).toBe(2);
    expect(overview.audit.recent).toHaveLength(2);
    expect(overview.audit.recent[0]).toMatchObject({
      action: 'CLEANUP_DRY_RUN',
      outcome: 'SUCCESS',
      targetUserIds: [smoke.id],
      metadata: { candidateUsers: 1, dryRun: true },
    });
    expect(JSON.stringify(overview.audit)).not.toContain('NNZ_OPS_TOKEN');
  });

  it('queries ops audit events by action, actor, target user, and pagination', () => {
    const { store, smoke, normal } = seedOpsStore();
    store.recordOpsAuditEvent({
      action: 'OVERVIEW_READ',
      outcome: 'SUCCESS',
      actor: 'ops:viewer',
      metadata: { path: '/api/ops/overview' },
    });
    store.recordOpsAuditEvent({
      action: 'CLEANUP_DRY_RUN',
      outcome: 'SUCCESS',
      actor: 'ops:operator',
      targetUserIds: [smoke.id],
      metadata: { candidateUsers: 1, dryRun: true },
    });
    store.recordOpsAuditEvent({
      action: 'AUDIT_QUERY',
      outcome: 'SUCCESS',
      actor: 'ops:admin',
      targetUserIds: [normal.id],
      metadata: { action: 'CLEANUP_DELETE', actorRole: 'admin' },
    });

    const auditQueries = queryOpsAuditEvents(store, { action: 'AUDIT_QUERY' });
    expect(auditQueries.events).toHaveLength(1);
    expect(auditQueries.events[0]).toMatchObject({
      action: 'AUDIT_QUERY',
      actor: 'ops:admin',
      targetUserIds: [normal.id],
    });
    expect(auditQueries.filters).toEqual({
      action: 'AUDIT_QUERY',
      actor: null,
      targetUserId: null,
    });

    const operatorEvents = queryOpsAuditEvents(store, { actor: 'ops:operator' });
    expect(operatorEvents.events).toHaveLength(1);
    expect(operatorEvents.events[0]?.action).toBe('CLEANUP_DRY_RUN');

    const smokeEvents = queryOpsAuditEvents(store, { targetUserId: smoke.id });
    expect(smokeEvents.events).toHaveLength(1);
    expect(smokeEvents.events[0]).toMatchObject({
      action: 'CLEANUP_DRY_RUN',
      targetUserIds: [smoke.id],
    });

    const firstPage = queryOpsAuditEvents(store, { limit: 2, offset: 0 });
    expect(firstPage.pagination).toMatchObject({
      limit: 2,
      offset: 0,
      total: 3,
      returned: 2,
      hasMore: true,
    });
    expect(firstPage.events.map((event) => event.action)).toEqual(['AUDIT_QUERY', 'CLEANUP_DRY_RUN']);

    const secondPage = queryOpsAuditEvents(store, { limit: 2, offset: 2 });
    expect(secondPage.pagination).toMatchObject({
      limit: 2,
      offset: 2,
      total: 3,
      returned: 1,
      hasMore: false,
    });
    expect(secondPage.events[0]?.action).toBe('OVERVIEW_READ');

    const clamped = queryOpsAuditEvents(store, { limit: 999, offset: -12 });
    expect(clamped.pagination.limit).toBe(100);
    expect(clamped.pagination.offset).toBe(0);
    expect(JSON.stringify(clamped)).not.toContain('token');
  });

  it('builds a conservative cleanup plan for explicit smoke accounts only', () => {
    const { store, smoke } = seedOpsStore();

    const plan = buildTestUserCleanupPlan(store);

    expect(plan.users).toHaveLength(1);
    expect(plan.users[0]).toMatchObject({
      userId: smoke.id,
      email: 'codex-ops-smoke-20260611@example.test',
      reason: 'example.test smoke account',
      counts: {
        users: 1,
        personas: 1,
        soulVersions: 1,
        memories: 1,
        proposals: 1,
        nodes: 1,
        conversations: 1,
        credentials: 1,
      },
    });
    expect(plan.totals.users).toBe(1);
    expect(plan.totals.credentials).toBe(1);
  });

  it('keeps dry-run cleanup read-only and deletes only test user data when confirmed', () => {
    const { store, userA, personaA, normal, normalPersona, smoke, smokePersona } = seedOpsStore();

    const dryRun = cleanupTestUsers(store, true);
    expect(dryRun.deletedUserIds).toEqual([]);
    expect(dryRun.receipts).toEqual([]);
    expect(store.getCredentialByEmail('codex-ops-smoke-20260611@example.test')?.userId).toBe(smoke.id);
    expect(store.listPersonasForUser(normal.id)).toEqual([normalPersona]);

    const result = cleanupTestUsers(store, false);
    expect(result.deletedUserIds).toEqual([smoke.id]);
    expect(result.receipts).toHaveLength(1);
    expect(result.receipts[0]).toMatchObject({
      userId: smoke.id,
      email: 'codex-ops-smoke-20260611@example.test',
      status: 'DELETED',
      counts: {
        users: 1,
        personas: 1,
        memories: 1,
        proposals: 1,
        nodes: 1,
        conversations: 1,
        credentials: 1,
      },
    });
    expect(store.getCredentialByEmail('codex-ops-smoke-20260611@example.test')).toBeUndefined();
    expect(() => store.listPersonasForUser(smoke.id)).toThrow();
    expect(() => store.getLatestSoulVersion({ userId: smoke.id, personaId: smokePersona.id })).toThrow();

    expect(store.listPersonasForUser(userA.id)).toEqual([personaA]);
    expect(store.listPersonasForUser(normal.id)).toEqual([normalPersona]);
    expect(store.getCredentialByEmail('real.user@example.com')?.userId).toBe(normal.id);
    expect(store.buildSoulMaturityReport({ userId: userA.id, personaId: personaA.id }).memoryCount).toBe(1);
  });
});
