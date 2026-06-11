import { describe, expect, it } from 'vitest';

import { InMemorySoulStore } from '../domain/soul-store';
import { buildOpsOverview, buildTestUserCleanupPlan, cleanupTestUsers } from './ops-console';

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
      postgresConfigured: false,
      postgresEnv: null,
      sqliteConfigured: false,
    });

    expect(overview.totals.users).toBe(3);
    expect(overview.totals.testUsers).toBe(1);
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
    expect(store.getCredentialByEmail('codex-ops-smoke-20260611@example.test')?.userId).toBe(smoke.id);
    expect(store.listPersonasForUser(normal.id)).toEqual([normalPersona]);

    const result = cleanupTestUsers(store, false);
    expect(result.deletedUserIds).toEqual([smoke.id]);
    expect(store.getCredentialByEmail('codex-ops-smoke-20260611@example.test')).toBeUndefined();
    expect(() => store.listPersonasForUser(smoke.id)).toThrow();
    expect(() => store.getLatestSoulVersion({ userId: smoke.id, personaId: smokePersona.id })).toThrow();

    expect(store.listPersonasForUser(userA.id)).toEqual([personaA]);
    expect(store.listPersonasForUser(normal.id)).toEqual([normalPersona]);
    expect(store.getCredentialByEmail('real.user@example.com')?.userId).toBe(normal.id);
    expect(store.buildSoulMaturityReport({ userId: userA.id, personaId: personaA.id }).memoryCount).toBe(1);
  });
});
