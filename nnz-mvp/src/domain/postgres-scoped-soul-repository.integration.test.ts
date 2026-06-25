import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createPostgresPersona,
  createPostgresScopedSoulRepositoryFromPool,
  createPostgresUser,
  ensurePostgresScopedSchema,
  type QueryablePool,
} from './postgres-scoped-soul-repository';

const { Pool } = pg;

const connectionString = process.env['NNZ_POSTGRES_INTEGRATION_URL'];
const describeIntegration = connectionString ? describe : describe.skip;

describeIntegration('PostgresScopedSoulRepository integration', () => {
  let pool: QueryablePool;
  let userIds: string[] = [];
  let auditIds: string[] = [];

  beforeAll(async () => {
    pool = new Pool({
      connectionString,
      ssl: shouldUseSsl(connectionString!) ? { rejectUnauthorized: false } : undefined,
    });
    await ensurePostgresScopedSchema(pool);
  });

  afterAll(async () => {
    for (const auditId of auditIds) {
      await pool.query('DELETE FROM nnz_ops_audit_events WHERE id = $1', [auditId]);
    }
    for (const userId of userIds) {
      await pool.query('DELETE FROM nnz_users WHERE id = $1', [userId]);
    }
    await pool.end();
  });

  it('round-trips scoped data through real Postgres JSONB, foreign keys, and cascade delete', async () => {
    const runId = `it_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const userA = await createPostgresUser(pool, '集成测试 A', `user_${runId}_a`);
    const userB = await createPostgresUser(pool, '集成测试 B', `user_${runId}_b`);
    userIds = [userA.id, userB.id];
    const personaA = await createPostgresPersona(
      pool,
      {
        userId: userA.id,
        displayName: '爸爸',
        relationship: '女儿',
        type: 'DECEASED',
      },
      `persona_${runId}_a`,
    );
    const personaB = await createPostgresPersona(
      pool,
      {
        userId: userB.id,
        displayName: '爸爸',
        relationship: '儿子',
        type: 'DECEASED',
      },
      `persona_${runId}_b`,
    );
    const repoA = createPostgresScopedSoulRepositoryFromPool(pool, {
      userId: userA.id,
      personaId: personaA.id,
    });
    const repoB = createPostgresScopedSoulRepositoryFromPool(pool, {
      userId: userB.id,
      personaId: personaB.id,
    });

    await repoA.createSoulVersion({
      kernelJson: {
        affectModel: { humorLevel: 'low' },
        languageModel: { petPhrases: ['慢慢来'] },
      },
    });
    const soulB = await repoB.createSoulVersion({
      kernelJson: {
        affectModel: { humorLevel: 'medium' },
        languageModel: { petPhrases: ['你自己拿主意'] },
      },
    });
    const memoryA = await repoA.addMemory({
      type: 'CORRECTION',
      content: '爸爸其实很幽默。',
      confidence: 1,
      enabledForSoul: true,
    });
    const memoryB = await repoB.addMemory({
      type: 'CORRECTION',
      content: '爸爸说话很慢。',
      confidence: 1,
      enabledForSoul: true,
    });

    await expect(
      pool.query(
        `INSERT INTO nnz_soul_snapshots (
          id, user_id, persona_id, soul_version_id, kernel_json, memory_ids, sealed_at
        ) VALUES (
          $1, $2, $3, $4, $5::jsonb, $6::jsonb, $7
        )`,
        [
          `snapshot_${runId}_cross`,
          userA.id,
          personaA.id,
          soulB.id,
          JSON.stringify({}),
          JSON.stringify([]),
          new Date(),
        ],
      ),
    ).rejects.toThrow();
    await expect(
      pool.query(
        `INSERT INTO nnz_memory_items (
          id, user_id, persona_id, type, source, content, confidence, sensitivity,
          enabled_for_soul, enabled_for_runtime, enabled_for_soul_update,
          evidence_ids, created_by, state, created_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12::jsonb, $13, $14, $15
        )`,
        [
          `memory_${runId}_cross`,
          userA.id,
          personaB.id,
          'CORRECTION',
          'CORRECTION',
          '这个记忆不应跨 scope 写入。',
          1,
          'LOW',
          true,
          true,
          true,
          JSON.stringify([]),
          'USER',
          'ACTIVE',
          new Date(),
        ],
      ),
    ).rejects.toThrow();
    await expect(
      repoA.createSoulUpdateProposal({
        fieldPath: 'affectModel.humorLevel',
        newValue: 'very-high',
        evidenceIds: [memoryB.id],
      }),
    ).rejects.toThrow();

    const proposal = await repoA.createSoulUpdateProposal({
      fieldPath: 'affectModel.humorLevel',
      newValue: 'high',
      evidenceIds: [memoryA.id],
    });
    const acceptedSoul = await repoA.acceptSoulUpdateProposal(proposal.id);
    expect(acceptedSoul.kernelJson).toMatchObject({ affectModel: { humorLevel: 'high' } });

    const sealed = await repoA.sealSoul();
    expect(await repoA.getSoulSnapshot(sealed.snapshot.id)).toMatchObject({
      memoryIds: [memoryA.id],
      kernelJson: acceptedSoul.kernelJson,
    });

    const node = await repoA.activateNode('婚礼');
    await repoA.addConversation({
      nodeId: node.node.id,
      role: 'USER',
      content: '我要结婚了。',
    });
    await expect(
      repoB.addConversation({
        nodeId: node.node.id,
        role: 'USER',
        content: '这个节点不属于 B。',
      }),
    ).rejects.toThrow();

    await repoA.storeCredential(userA.id, `${runId}@example.test`, 'hash-a');
    const audit = await repoA.recordOpsAuditEvent({
      action: 'OVERVIEW_READ',
      outcome: 'SUCCESS',
      actor: 'ops:integration',
      targetUserIds: [userA.id],
      metadata: { path: '/api/ops/overview' },
    });
    auditIds.push(audit.id);
    expect(await repoA.getCredentialByEmail(`${runId}@example.test`)).toMatchObject({
      userId: userA.id,
      email: `${runId}@example.test`,
    });
    expect(await repoA.listOpsAuditEvents(1)).toMatchObject([{ id: audit.id }]);

    await pool.query('DELETE FROM nnz_users WHERE id = $1', [userA.id]);
    userIds = [userB.id];

    const scopedCounts = await pool.query<{ table_name: string; count: string }>(
      `SELECT table_name, row_count::text AS count
       FROM (
         SELECT 'personas' AS table_name, COUNT(*) AS row_count FROM nnz_personas WHERE user_id = $1
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
      [userA.id],
    );
    expect(Object.fromEntries(scopedCounts.rows.map((row) => [row.table_name, Number(row.count)]))).toEqual({
      personas: 0,
      memory: 0,
      soul_versions: 0,
      snapshots: 0,
      nodes: 0,
      conversations: 0,
      sessions: 0,
      credentials: 0,
    });
    expect(await repoB.listMemory()).toHaveLength(1);
    expect((await repoB.getLatestSoulVersion()).kernelJson).toMatchObject({
      affectModel: { humorLevel: 'medium' },
    });
    expect(await repoB.listConversations()).toEqual([]);
    expect(await repoB.getRuntimeSession()).toMatchObject({ state: 'ACTIVE' });

    const auditCount = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM nnz_ops_audit_events WHERE id = $1',
      [audit.id],
    );
    expect(Number(auditCount.rows[0]?.count ?? 0)).toBe(1);
  });
});

function shouldUseSsl(url: string): boolean {
  if (url.includes('sslmode=disable')) return false;
  return url.startsWith('postgres://') || url.startsWith('postgresql://');
}
