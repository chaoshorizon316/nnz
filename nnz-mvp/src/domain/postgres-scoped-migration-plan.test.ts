import { describe, expect, it } from 'vitest';

import type { StoreSnapshot } from './persistence';
import {
  POSTGRES_SCOPED_MIGRATION_TABLE_ORDER,
  planPostgresScopedMigration,
} from './postgres-scoped-migration-plan';
import { InMemorySoulStore } from './soul-store';

describe('Postgres scoped migration planner', () => {
  it('builds a ready dry-run plan from a valid store snapshot', () => {
    const snapshot = createValidSnapshot();

    const plan = planPostgresScopedMigration(snapshot);

    expect(plan.ready).toBe(true);
    expect(plan.errors).toEqual([]);
    expect(plan.warnings).toEqual([]);
    expect(plan.tableOrder).toEqual([...POSTGRES_SCOPED_MIGRATION_TABLE_ORDER]);
    expect(Object.fromEntries(plan.tables.map((table) => [table.table, table.count]))).toEqual({
      nnz_users: 2,
      nnz_personas: 2,
      nnz_soul_versions: 2,
      nnz_memory_items: 3,
      nnz_soul_snapshots: 1,
      nnz_node_events: 2,
      nnz_soul_update_proposals: 1,
      nnz_conversation_messages: 1,
      nnz_runtime_sessions: 1,
      nnz_credentials: 1,
      nnz_ops_audit_events: 1,
    });
    expect(plan.totalRows).toBe(17);
  });

  it('blocks cross-scope and missing-owner data before any database write', () => {
    const snapshot = createValidSnapshot();
    const userA = snapshot.users[0]!;
    const userB = snapshot.users[1]!;
    const memoryB = snapshot.memoryItems.find((memory) => memory.userId === userB.id && memory.type === 'CORRECTION')!;
    const soulB = snapshot.soulVersions.find((version) => version.userId === userB.id)!;
    const nodeB = snapshot.nodeEvents.find((node) => node.userId === userB.id)!;

    snapshot.soulSnapshots[0]!.soulVersionId = soulB.id;
    snapshot.soulSnapshots[0]!.memoryIds.push(memoryB.id);
    snapshot.soulUpdateProposals[0]!.evidenceIds = [memoryB.id];
    snapshot.conversationMessages[0]!.nodeId = nodeB.id;
    snapshot.sessions[0]!.nodeId = nodeB.id;
    snapshot.sessions[0]!.scopeKey = `${userA.id}:wrong-persona`;
    snapshot.credentials.push({
      userId: 'missing-user',
      email: 'missing@example.test',
      passwordHash: 'hash-missing',
      createdAt: new Date().toISOString(),
    });
    snapshot.opsAuditEvents[0]!.targetUserIds = ['missing-user'];

    const plan = planPostgresScopedMigration(snapshot);
    const errorCodes = plan.errors.map((error) => error.code);
    const warningCodes = plan.warnings.map((warning) => warning.code);

    expect(plan.ready).toBe(false);
    expect(errorCodes).toContain('SNAPSHOT_SOUL_VERSION_SCOPE_MISMATCH');
    expect(errorCodes).toContain('SNAPSHOT_MEMORY_SCOPE_MISMATCH');
    expect(errorCodes).toContain('PROPOSAL_EVIDENCE_SCOPE_MISMATCH');
    expect(errorCodes).toContain('CONVERSATION_NODE_SCOPE_MISMATCH');
    expect(errorCodes).toContain('SESSION_NODE_SCOPE_MISMATCH');
    expect(errorCodes).toContain('SESSION_SCOPE_KEY_MISMATCH');
    expect(errorCodes).toContain('USER_MISSING');
    expect(warningCodes).toEqual(['OPS_AUDIT_TARGET_USER_MISSING']);
  });

  it('rejects multiple active SoulVersions in the same user/persona scope', () => {
    const snapshot = createValidSnapshot();
    const active = snapshot.soulVersions.find((version) => version.status === 'ACTIVE')!;
    snapshot.soulVersions.push({
      ...active,
      id: `${active.id}_duplicate_active`,
      version: active.version + 1,
      createdAt: new Date(),
    });

    const plan = planPostgresScopedMigration(snapshot);

    expect(plan.ready).toBe(false);
    expect(plan.errors.map((error) => error.code)).toContain('MULTIPLE_ACTIVE_SOUL_VERSIONS');
  });
});

function createValidSnapshot(): StoreSnapshot {
  const store = new InMemorySoulStore();
  const userA = store.createUser('user-a@example.test');
  const userB = store.createUser('user-b@example.test');
  const personaA = store.createPersona({
    userId: userA.id,
    displayName: 'Father',
    relationship: 'daughter',
    type: 'DECEASED',
  });
  const personaB = store.createPersona({
    userId: userB.id,
    displayName: 'Father',
    relationship: 'son',
    type: 'DECEASED',
  });
  store.createSoulVersion({
    userId: userA.id,
    personaId: personaA.id,
    kernelJson: { affectModel: { humorLevel: 'low' } },
  });
  store.createSoulVersion({
    userId: userB.id,
    personaId: personaB.id,
    kernelJson: { affectModel: { humorLevel: 'medium' } },
  });
  const memoryA = store.addMemory({
    userId: userA.id,
    personaId: personaA.id,
    type: 'CORRECTION',
    content: 'He had a quiet sense of humor.',
    confidence: 1,
    enabledForSoul: true,
  });
  store.addMemory({
    userId: userB.id,
    personaId: personaB.id,
    type: 'CORRECTION',
    content: 'He spoke slowly.',
    confidence: 1,
    enabledForSoul: true,
  });
  store.createSoulUpdateProposal({
    userId: userA.id,
    personaId: personaA.id,
    fieldPath: 'affectModel.humorLevel',
    newValue: 'medium',
    evidenceIds: [memoryA.id],
  });
  store.sealSoul({ userId: userA.id, personaId: personaA.id });
  const nodeA = store.activateNode({ userId: userA.id, personaId: personaA.id }, 'wedding');
  store.addConversation({
    userId: userA.id,
    personaId: personaA.id,
    nodeId: nodeA.node.id,
    role: 'USER',
    content: 'I am getting married.',
  });
  store.createNode({
    userId: userB.id,
    personaId: personaB.id,
    name: 'graduation',
  });
  store.storeCredential(userA.id, 'user-a@example.test', 'hash-a');
  store.recordOpsAuditEvent({
    action: 'OVERVIEW_READ',
    outcome: 'SUCCESS',
    actor: 'ops-token',
    targetUserIds: [userA.id],
    metadata: { path: '/api/ops/overview' },
  });
  return store.serialize();
}
