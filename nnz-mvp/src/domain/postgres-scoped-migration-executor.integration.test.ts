import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { StoreSnapshot } from './persistence';
import {
  EXECUTE_POSTGRES_SCOPED_MIGRATION_CONFIRM,
  executePostgresScopedMigration,
} from './postgres-scoped-migration-executor';
import {
  createPostgresScopedSoulRepositoryFromPool,
  type QueryablePool,
} from './postgres-scoped-soul-repository';
import { InMemorySoulStore } from './soul-store';
import type { NodeEvent, Persona, User } from './types';

const { Pool } = pg;

const connectionString = process.env['NNZ_POSTGRES_INTEGRATION_URL'];
const describeIntegration = connectionString ? describe : describe.skip;

describeIntegration('Postgres scoped migration executor integration', () => {
  let pool: QueryablePool;
  let userIds: string[] = [];
  let auditIds: string[] = [];

  beforeAll(async () => {
    pool = new Pool({
      connectionString,
      ssl: shouldUseSsl(connectionString!) ? { rejectUnauthorized: false } : undefined,
    });
  });

  afterAll(async () => {
    if (!pool) return;
    for (const auditId of auditIds) {
      await pool.query('DELETE FROM nnz_ops_audit_events WHERE id = $1', [auditId]);
    }
    for (const userId of userIds) {
      await pool.query('DELETE FROM nnz_users WHERE id = $1', [userId]);
    }
    await pool.end();
  });

  it('executes snapshot rows against real Postgres and remains idempotent within scope', async () => {
    const fixture = createSnapshotFixture();
    userIds = [fixture.userA.id, fixture.userB.id];
    auditIds = [fixture.auditId];

    const firstResult = await executePostgresScopedMigration(pool, fixture.snapshot, {
      confirm: EXECUTE_POSTGRES_SCOPED_MIGRATION_CONFIRM,
      migratedAt: '2026-06-26T00:00:00.000Z',
    });
    const secondResult = await executePostgresScopedMigration(pool, fixture.snapshot, {
      confirm: EXECUTE_POSTGRES_SCOPED_MIGRATION_CONFIRM,
      ensureSchema: false,
      migratedAt: '2026-06-26T00:00:00.000Z',
    });

    expect(firstResult.committed).toBe(true);
    expect(secondResult.totalRows).toBe(firstResult.totalRows);

    const repoA = createPostgresScopedSoulRepositoryFromPool(pool, {
      userId: fixture.userA.id,
      personaId: fixture.personaA.id,
    });
    const repoB = createPostgresScopedSoulRepositoryFromPool(pool, {
      userId: fixture.userB.id,
      personaId: fixture.personaB.id,
    });

    await expect(
      repoB.addConversation({
        nodeId: fixture.nodeA.id,
        role: 'USER',
        content: 'This should never cross scope.',
      }),
    ).rejects.toThrow();

    const sessionA = await repoA.getRuntimeSession();
    const snapshotA = await repoA.getSoulSnapshot(fixture.soulSnapshotAId);
    const memoryA = await repoA.listMemory();
    const conversationsA = await repoA.listConversations();
    const proposalsA = await repoA.listSoulUpdateProposals();
    const credentialA = await repoA.getCredentialByEmail(fixture.emailA);

    expect(sessionA).toMatchObject({
      state: 'NODE',
      soulSnapshotId: fixture.soulSnapshotAId,
      nodeContext: {
        nodeId: fixture.nodeA.id,
        nodeName: fixture.nodeA.name,
      },
    });
    expect(snapshotA.memoryIds).toEqual([fixture.memoryAId]);
    expect(memoryA.map((memory) => memory.content)).toEqual([
      fixture.memoryAContent,
      `节点「${fixture.nodeA.name}」已激活。`,
    ]);
    expect(conversationsA.map((message) => message.content)).toEqual([
      fixture.preNodeConversationA,
      fixture.nodeConversationA,
    ]);
    expect(proposalsA).toMatchObject([
      {
        fieldPath: 'affectModel.humorLevel',
        evidenceIds: [fixture.memoryAId],
        status: 'PENDING',
      },
    ]);
    expect(credentialA).toMatchObject({
      userId: fixture.userA.id,
      email: fixture.emailA,
    });

    expect(await repoB.listMemory()).toMatchObject([{ content: fixture.memoryBContent }]);
    expect(await repoB.getRuntimeSession()).toMatchObject({ state: 'ACTIVE' });

    const auditCount = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM nnz_ops_audit_events WHERE id = $1',
      [fixture.auditId],
    );
    expect(Number(auditCount.rows[0]?.count ?? 0)).toBe(1);

    const countsBeforeDelete = await scopedCounts(pool, fixture.userA.id);
    expect(countsBeforeDelete).toMatchObject({
      users: 1,
      personas: 1,
      memory: 2,
      soul_versions: 1,
      snapshots: 1,
      nodes: 1,
      conversations: 2,
      sessions: 1,
      credentials: 1,
    });

    await pool.query('DELETE FROM nnz_users WHERE id = $1', [fixture.userA.id]);
    userIds = [fixture.userB.id];

    expect(await scopedCounts(pool, fixture.userA.id)).toEqual({
      users: 0,
      personas: 0,
      memory: 0,
      soul_versions: 0,
      snapshots: 0,
      nodes: 0,
      conversations: 0,
      sessions: 0,
      credentials: 0,
    });
    expect(await repoB.listMemory()).toMatchObject([{ content: fixture.memoryBContent }]);
  });
});

interface SnapshotFixture {
  snapshot: StoreSnapshot;
  userA: User;
  userB: User;
  personaA: Persona;
  personaB: Persona;
  nodeA: NodeEvent;
  soulSnapshotAId: string;
  memoryAId: string;
  memoryAContent: string;
  memoryBContent: string;
  preNodeConversationA: string;
  nodeConversationA: string;
  emailA: string;
  auditId: string;
}

function createSnapshotFixture(): SnapshotFixture {
  const runId = `migration_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const store = new InMemorySoulStore();

  const userA = store.createUser(`迁移测试 A ${runId}`);
  const userB = store.createUser(`迁移测试 B ${runId}`);
  const personaA = store.createPersona({
    userId: userA.id,
    displayName: '爸爸',
    relationship: '女儿',
    type: 'DECEASED',
  });
  const personaB = store.createPersona({
    userId: userB.id,
    displayName: '爸爸',
    relationship: '儿子',
    type: 'DECEASED',
  });

  store.createSoulVersion({
    userId: userA.id,
    personaId: personaA.id,
    kernelJson: {
      affectModel: { humorLevel: 'low' },
      languageModel: { petPhrases: ['慢慢来'] },
    },
  });
  const memoryAContent = `A scoped memory ${runId}`;
  const memoryA = store.addMemory({
    userId: userA.id,
    personaId: personaA.id,
    type: 'CORRECTION',
    content: memoryAContent,
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
  const preNodeConversationA = `before node ${runId}`;
  store.addConversation({
    userId: userA.id,
    personaId: personaA.id,
    role: 'USER',
    content: preNodeConversationA,
  });
  const sealedA = store.sealSoul({ userId: userA.id, personaId: personaA.id });
  const nodeA = store.activateNode({ userId: userA.id, personaId: personaA.id }, `婚礼 ${runId}`).node;
  const nodeConversationA = `node conversation ${runId}`;
  store.addConversation({
    userId: userA.id,
    personaId: personaA.id,
    nodeId: nodeA.id,
    role: 'USER',
    content: nodeConversationA,
  });

  store.createSoulVersion({
    userId: userB.id,
    personaId: personaB.id,
    kernelJson: {
      affectModel: { humorLevel: 'medium' },
      languageModel: { petPhrases: ['你自己拿主意'] },
    },
  });
  const memoryBContent = `B scoped memory ${runId}`;
  store.addMemory({
    userId: userB.id,
    personaId: personaB.id,
    type: 'DESCRIPTION',
    content: memoryBContent,
    confidence: 1,
    enabledForSoul: true,
  });
  store.getRuntimeSession({ userId: userB.id, personaId: personaB.id });

  const emailA = `${runId}@example.test`;
  store.storeCredential(userA.id, emailA, `hash-${runId}`);
  const audit = store.recordOpsAuditEvent({
    action: 'OVERVIEW_READ',
    outcome: 'SUCCESS',
    actor: 'ops:migration-integration',
    targetUserIds: [userA.id, userB.id],
    metadata: { runId },
  });

  return {
    snapshot: store.serialize(),
    userA,
    userB,
    personaA,
    personaB,
    nodeA,
    soulSnapshotAId: sealedA.snapshot.id,
    memoryAId: memoryA.id,
    memoryAContent,
    memoryBContent,
    preNodeConversationA,
    nodeConversationA,
    emailA,
    auditId: audit.id,
  };
}

async function scopedCounts(pool: QueryablePool, userId: string): Promise<Record<string, number>> {
  const result = await pool.query<{ table_name: string; count: string }>(
    `SELECT table_name, row_count::text AS count
     FROM (
       SELECT 'users' AS table_name, COUNT(*) AS row_count FROM nnz_users WHERE id = $1
       UNION ALL
       SELECT 'personas', COUNT(*) FROM nnz_personas WHERE user_id = $1
       UNION ALL
       SELECT 'memory', COUNT(*) FROM nnz_memory_items WHERE user_id = $1
       UNION ALL
       SELECT 'soul_versions', COUNT(*) FROM nnz_soul_versions WHERE user_id = $1
       UNION ALL
       SELECT 'snapshots', COUNT(*) FROM nnz_soul_snapshots WHERE user_id = $1
       UNION ALL
       SELECT 'nodes', COUNT(*) FROM nnz_node_events WHERE user_id = $1
       UNION ALL
       SELECT 'conversations', COUNT(*) FROM nnz_conversation_messages WHERE user_id = $1
       UNION ALL
       SELECT 'sessions', COUNT(*) FROM nnz_runtime_sessions WHERE user_id = $1
       UNION ALL
       SELECT 'credentials', COUNT(*) FROM nnz_credentials WHERE user_id = $1
     ) counts`,
    [userId],
  );
  return Object.fromEntries(result.rows.map((row) => [row.table_name, Number(row.count)]));
}

function shouldUseSsl(url: string): boolean {
  if (url.includes('sslmode=disable')) return false;
  return url.startsWith('postgres://') || url.startsWith('postgresql://');
}
