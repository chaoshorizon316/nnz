import { describe, expect, it } from 'vitest';

import { CovenantStateError, OwnershipError, ScopeValidationError } from './errors';
import {
  createPostgresPersona,
  createPostgresScopedSoulRepositoryFromPool,
  createPostgresUser,
  ensurePostgresScopedSchema,
  listPostgresPersonasForUser,
  type QueryablePool,
} from './postgres-scoped-soul-repository';
import type {
  ConversationMessage,
  MemoryItem,
  NodeEvent,
  OpsAuditAction,
  OpsAuditOutcome,
  PersonaType,
  RuntimeSession,
  SoulSnapshot,
  SoulUpdateProposal,
  SoulVersion,
} from './types';

describe('PostgresScopedSoulRepository', () => {
  it('creates scoped tables and composite foreign keys', async () => {
    const pool = new FakeScopedPool();

    await ensurePostgresScopedSchema(pool);

    expect(pool.schemaSql).toContain('FOREIGN KEY (user_id, persona_id)');
    expect(pool.schemaSql).toContain('idx_nnz_personas_user_created');
    expect(pool.schemaSql).toContain('idx_nnz_memory_scope_created');
    expect(pool.schemaSql).toContain('idx_nnz_soul_versions_scope_version');
    expect(pool.schemaSql).toContain('idx_nnz_soul_snapshots_scope_sealed');
    expect(pool.schemaSql).toContain('idx_nnz_node_events_scope_start');
    expect(pool.schemaSql).toContain('idx_nnz_soul_update_proposals_scope_status');
    expect(pool.schemaSql).toContain('idx_nnz_conversation_scope_created');
    expect(pool.schemaSql).toContain('nnz_runtime_sessions');
    expect(pool.schemaSql).toContain('nnz_credentials');
    expect(pool.schemaSql).toContain('nnz_ops_audit_events');
  });

  it('requires a complete owned user/persona scope', async () => {
    const { pool, userA, personaA, personaB } = await createFixture();

    expect(() =>
      createPostgresScopedSoulRepositoryFromPool(pool, { personaId: personaA.id } as never),
    ).toThrow(ScopeValidationError);

    const repo = createPostgresScopedSoulRepositoryFromPool(pool, {
      userId: userA.id,
      personaId: personaA.id,
    });
    await expect(repo.getPersona()).resolves.toMatchObject({
      userId: userA.id,
      id: personaA.id,
    });

    const wrongOwnerRepo = createPostgresScopedSoulRepositoryFromPool(pool, {
      userId: userA.id,
      personaId: personaB.id,
    });
    await expect(wrongOwnerRepo.getPersona()).rejects.toThrow(OwnershipError);
    await expect(
      wrongOwnerRepo.addMemory({
        type: 'DESCRIPTION',
        content: '不应该写入。',
        confidence: 1,
        enabledForSoul: true,
      }),
    ).rejects.toThrow(OwnershipError);
  });

  it('keeps same-name personas, memory, and conversations isolated by user scope', async () => {
    const { pool, userA, userB, personaA, personaB } = await createFixture();
    const repoA = createPostgresScopedSoulRepositoryFromPool(pool, {
      userId: userA.id,
      personaId: personaA.id,
    });
    const repoB = createPostgresScopedSoulRepositoryFromPool(pool, {
      userId: userB.id,
      personaId: personaB.id,
    });

    expect(await listPostgresPersonasForUser(pool, userA.id)).toEqual([personaA]);
    expect(await listPostgresPersonasForUser(pool, userB.id)).toEqual([personaB]);

    const memoryA = await repoA.addMemory({
      type: 'DESCRIPTION',
      content: '爸爸说话慢，但很认真。',
      confidence: 0.9,
      enabledForSoul: true,
    });
    const memoryB = await repoB.addMemory({
      type: 'DESCRIPTION',
      content: '爸爸总会说慢慢来。',
      confidence: 0.8,
      enabledForSoul: true,
    });
    const conversationA = await repoA.addConversation({
      role: 'USER',
      content: '我要结婚了。',
    });
    const conversationB = await repoB.addConversation({
      role: 'USER',
      content: '我今天很想你。',
    });

    expect(await repoA.listMemory()).toEqual([memoryA]);
    expect(await repoB.listMemory()).toEqual([memoryB]);
    expect(await repoA.listConversations()).toEqual([conversationA]);
    expect(await repoB.listConversations()).toEqual([conversationB]);
  });

  it('does not let caller-supplied ids override the bound scope', async () => {
    const { pool, userA, userB, personaA, personaB } = await createFixture();
    const repoA = createPostgresScopedSoulRepositoryFromPool(pool, {
      userId: userA.id,
      personaId: personaA.id,
    });
    const repoB = createPostgresScopedSoulRepositoryFromPool(pool, {
      userId: userB.id,
      personaId: personaB.id,
    });

    const memory = await repoA.addMemory({
      userId: userB.id,
      personaId: personaB.id,
      type: 'DESCRIPTION',
      content: '这是用户 A 心中的爸爸。',
      confidence: 1,
      enabledForSoul: true,
    } as never);
    const conversation = await repoA.addConversation({
      userId: userB.id,
      personaId: personaB.id,
      role: 'ASSISTANT',
      content: '我在。',
    } as never);

    expect(memory).toMatchObject({ userId: userA.id, personaId: personaA.id });
    expect(conversation).toMatchObject({ userId: userA.id, personaId: personaA.id });
    expect(await repoB.listMemory()).toEqual([]);
    expect(await repoB.listConversations()).toEqual([]);
  });

  it('matches in-memory memory defaults and scoped memory filters', async () => {
    const { pool, userA, personaA } = await createFixture();
    const repo = createPostgresScopedSoulRepositoryFromPool(pool, {
      userId: userA.id,
      personaId: personaA.id,
    });

    const normal = await repo.addMemory({
      type: 'DESCRIPTION',
      content: '爸爸会叫我丫头。',
      confidence: 1,
      enabledForSoul: true,
    });
    const nodeMemory = await repo.addMemory({
      type: 'NODE_MEMORY',
      content: '婚礼那天想告诉爸爸。',
      confidence: 0.7,
      enabledForSoul: false,
    });
    const risk = await repo.addMemory({
      type: 'RISK',
      content: '需要人工关注的风险信号。',
      confidence: 0.6,
      enabledForSoul: true,
    });
    await repo.addMemory({
      type: 'DESCRIPTION',
      content: '这条隐私等级不可进入运行上下文。',
      confidence: 0.8,
      enabledForSoul: true,
      sensitivity: 'RESTRICTED',
      enabledForRuntime: true,
      enabledForSoulUpdate: true,
    });
    await repo.addMemory({
      type: 'DESCRIPTION',
      content: '这条已经归档。',
      confidence: 0.8,
      enabledForSoul: true,
      state: 'ARCHIVED',
    });

    expect(nodeMemory).toMatchObject({
      source: 'NODE',
      enabledForRuntime: true,
      enabledForSoulUpdate: false,
      createdBy: 'USER',
    });
    expect(risk).toMatchObject({
      source: 'SYSTEM',
      sensitivity: 'RESTRICTED',
      enabledForRuntime: false,
      enabledForSoulUpdate: false,
      createdBy: 'SYSTEM',
    });
    const runtimeMemory = await repo.listRuntimeMemory();
    expect(runtimeMemory).toHaveLength(2);
    expect(runtimeMemory).toEqual(expect.arrayContaining([normal, nodeMemory]));
    expect(await repo.listSoulUpdateMemory()).toEqual([normal]);

    await expect(
      repo.addMemory({
        type: 'DESCRIPTION',
        content: 'confidence 超出范围。',
        confidence: 1.1,
        enabledForSoul: true,
      }),
    ).rejects.toThrow(RangeError);
  });

  it('keeps soul versions and covenant lifecycle scoped', async () => {
    const { pool, userA, userB, personaA, personaB } = await createFixture();
    const repoA = createPostgresScopedSoulRepositoryFromPool(pool, {
      userId: userA.id,
      personaId: personaA.id,
    });
    const repoB = createPostgresScopedSoulRepositoryFromPool(pool, {
      userId: userB.id,
      personaId: personaB.id,
    });

    const soulA1 = await repoA.createSoulVersion({
      kernelJson: { identityCore: { displayName: '爸爸' }, affectModel: { humorLevel: 'low' } },
    });
    const soulA2 = await repoA.createSoulVersion({
      kernelJson: { identityCore: { displayName: '爸爸' }, affectModel: { humorLevel: 'high' } },
    });
    const soulB = await repoB.createSoulVersion({
      kernelJson: { identityCore: { displayName: '爸爸' }, affectModel: { humorLevel: 'medium' } },
    });
    const memoryA = await repoA.addMemory({
      type: 'DESCRIPTION',
      content: '爸爸会叫我丫头。',
      confidence: 1,
      enabledForSoul: true,
    });

    expect(await repoA.listSoulVersions()).toMatchObject([
      { id: soulA1.id, status: 'ARCHIVED' },
      { id: soulA2.id, status: 'ACTIVE' },
    ]);
    expect(await repoB.listSoulVersions()).toEqual([soulB]);
    expect(await repoA.getLatestSoulVersion()).toMatchObject({ id: soulA2.id });

    const sealed = await repoA.sealSoul();
    expect(sealed.snapshot).toMatchObject({
      userId: userA.id,
      personaId: personaA.id,
      soulVersionId: soulA2.id,
      memoryIds: [memoryA.id],
    });
    expect(sealed.snapshot.kernelJson).toEqual(soulA2.kernelJson);
    expect(sealed.session).toMatchObject({
      userId: userA.id,
      personaId: personaA.id,
      state: 'SEALED',
      soulSnapshotId: sealed.snapshot.id,
    });
    expect(await repoA.listSoulVersions()).toMatchObject([
      { id: soulA1.id, status: 'ARCHIVED' },
      { id: soulA2.id, status: 'ARCHIVED' },
    ]);
    expect(await repoB.listSoulVersions()).toMatchObject([{ id: soulB.id, status: 'ACTIVE' }]);
    expect(await repoA.getSoulSnapshot(sealed.snapshot.id)).toEqual(sealed.snapshot);

    await expect(repoA.sealSoul()).rejects.toThrow(CovenantStateError);

    const activeNode = await repoA.createNode({ name: '婚礼' });
    const nodeSession = await repoA.activateNode('婚礼');
    expect(nodeSession.node.id).toBe(activeNode.id);
    const completed = await repoA.completeNode();
    expect(completed.state).toBe('SEALED');
    const newNodeSession = await repoA.activateNode('婚礼');
    expect(newNodeSession.node.id).not.toBe(activeNode.id);
    await repoA.completeNode();
    expect(await repoA.listNodes()).toMatchObject([
      { name: '婚礼', status: 'COMPLETED' },
      { name: '婚礼', status: 'COMPLETED' },
    ]);

    const freshNode = await repoA.createNode({ name: '毕业典礼' });
    await repoB.createSoulVersion({ kernelJson: { identityCore: { displayName: '爸爸' } } });
    await expect(
      repoB.addConversation({
        nodeId: freshNode.id,
        role: 'USER',
        content: '这个节点不属于 B。',
      }),
    ).rejects.toThrow(OwnershipError);

    const graduated = await repoA.graduateSoul();
    expect(graduated.state).toBe('GRADUATED');
    expect(await repoA.listSoulVersions()).toMatchObject([
      { id: soulA1.id, status: 'GRADUATED' },
      { id: soulA2.id, status: 'GRADUATED' },
    ]);
    expect(await repoB.getRuntimeSession()).toMatchObject({ state: 'ACTIVE' });
    expect(await repoB.listSoulVersions()).toMatchObject([{ id: soulB.id, status: 'ARCHIVED' }, { status: 'ACTIVE' }]);
  });

  it('keeps soul update proposals scoped and reviewable', async () => {
    const { pool, userA, userB, personaA, personaB } = await createFixture();
    const repoA = createPostgresScopedSoulRepositoryFromPool(pool, {
      userId: userA.id,
      personaId: personaA.id,
    });
    const repoB = createPostgresScopedSoulRepositoryFromPool(pool, {
      userId: userB.id,
      personaId: personaB.id,
    });
    await repoA.createSoulVersion({
      kernelJson: { affectModel: { humorLevel: 'low' }, languageModel: { petPhrases: ['慢慢来'] } },
    });
    await repoB.createSoulVersion({
      kernelJson: { affectModel: { humorLevel: 'medium' }, languageModel: { petPhrases: ['你自己拿主意'] } },
    });
    const evidenceA = await repoA.addMemory({
      type: 'CORRECTION',
      content: '爸爸其实很幽默。',
      confidence: 1,
      enabledForSoul: true,
    });
    const evidenceB = await repoB.addMemory({
      type: 'CORRECTION',
      content: '爸爸说话慢。',
      confidence: 1,
      enabledForSoul: true,
    });
    const nodeMemory = await repoA.addMemory({
      type: 'NODE_MEMORY',
      content: '婚礼节点记忆不能做 Soul 更新证据。',
      confidence: 1,
      enabledForSoul: false,
    });

    await expect(
      repoA.createSoulUpdateProposal({
        fieldPath: 'affectModel.humorLevel',
        newValue: 'high',
        evidenceIds: [evidenceB.id],
      }),
    ).rejects.toThrow(OwnershipError);
    await expect(
      repoA.createSoulUpdateProposal({
        fieldPath: 'affectModel.humorLevel',
        newValue: 'high',
        evidenceIds: [nodeMemory.id],
      }),
    ).rejects.toThrow(OwnershipError);
    await expect(
      repoA.createSoulUpdateProposal({
        fieldPath: 'unsafe.path',
        newValue: 'bad',
        evidenceIds: [evidenceA.id],
      }),
    ).rejects.toThrow('not allowed');

    const proposal = await repoA.createSoulUpdateProposal({
      fieldPath: 'affectModel.humorLevel',
      newValue: 'high',
      evidenceIds: [evidenceA.id],
    });
    expect(proposal).toMatchObject({
      userId: userA.id,
      personaId: personaA.id,
      oldValue: 'low',
      newValue: 'high',
      status: 'PENDING',
    });
    expect(await repoA.listSoulUpdateProposalEvidence(proposal.id)).toEqual([evidenceA]);
    expect(await repoB.listSoulUpdateProposals()).toEqual([]);

    const acceptedSoul = await repoA.acceptSoulUpdateProposal(proposal.id);
    expect(acceptedSoul.kernelJson).toMatchObject({ affectModel: { humorLevel: 'high' } });
    expect(await repoA.listSoulUpdateProposals('ACCEPTED')).toHaveLength(1);
    await expect(repoA.rejectSoulUpdateProposal(proposal.id)).rejects.toThrow('already ACCEPTED');
    expect(await repoB.getLatestSoulVersion()).toMatchObject({
      userId: userB.id,
      personaId: personaB.id,
      kernelJson: { affectModel: { humorLevel: 'medium' }, languageModel: { petPhrases: ['你自己拿主意'] } },
    });

    const rejectedProposal = await repoA.createSoulUpdateProposal({
      fieldPath: 'languageModel.petPhrases',
      newValue: ['丫头'],
      evidenceIds: [evidenceA.id],
    });
    await expect(repoA.rejectSoulUpdateProposal(rejectedProposal.id)).resolves.toMatchObject({ status: 'REJECTED' });
    await expect(repoA.acceptSoulUpdateProposal(rejectedProposal.id)).rejects.toThrow('already REJECTED');
  });

  it('stores credentials by user and records ops audit without leaking sensitive fields', async () => {
    const { pool, userA, userB, personaA } = await createFixture();
    const repoA = createPostgresScopedSoulRepositoryFromPool(pool, {
      userId: userA.id,
      personaId: personaA.id,
    });

    await repoA.storeCredential(userA.id, 'a@example.com', 'hash-a');
    await repoA.storeCredential(userB.id, 'b@example.com', 'hash-b');

    expect(await repoA.getCredentialByEmail('a@example.com')).toMatchObject({
      userId: userA.id,
      email: 'a@example.com',
      passwordHash: 'hash-a',
    });
    expect(await repoA.getCredentialByEmail('b@example.com')).toMatchObject({
      userId: userB.id,
      email: 'b@example.com',
      passwordHash: 'hash-b',
    });

    await repoA.recordOpsAuditEvent({
      action: 'OVERVIEW_READ',
      outcome: 'SUCCESS',
      actor: 'ops:viewer',
      targetUserIds: [userA.id, userA.id],
      metadata: { path: '/api/ops/overview', count: 1 },
    });
    await repoA.recordOpsAuditEvent({
      action: 'ACCESS_DENIED',
      outcome: 'DENIED',
      actor: 'ops:unknown',
      metadata: { reason: 'bad-token' },
    });

    const events = await repoA.listOpsAuditEvents();
    expect(events).toHaveLength(2);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'ACCESS_DENIED',
          outcome: 'DENIED',
          metadata: { reason: 'bad-token' },
        }),
        expect.objectContaining({
          action: 'OVERVIEW_READ',
          actor: 'ops:viewer',
          targetUserIds: [userA.id],
          metadata: { path: '/api/ops/overview', count: 1 },
        }),
      ]),
    );
    expect(JSON.stringify(events)).not.toContain('hash-a');
    expect(JSON.stringify(events)).not.toContain('我今天很想你');
  });
});

async function createFixture() {
  const pool = new FakeScopedPool();
  const userA = await createPostgresUser(pool, '用户 A', 'user_a');
  const userB = await createPostgresUser(pool, '用户 B', 'user_b');
  const personaA = await createPostgresPersona(
    pool,
    {
      userId: userA.id,
      displayName: '爸爸',
      relationship: '女儿',
      type: 'DECEASED',
    },
    'persona_a',
  );
  const personaB = await createPostgresPersona(
    pool,
    {
      userId: userB.id,
      displayName: '爸爸',
      relationship: '儿子',
      type: 'DECEASED',
    },
    'persona_b',
  );

  return { pool, userA, userB, personaA, personaB };
}

class FakeScopedPool implements QueryablePool {
  schemaSql = '';
  readonly queries: Array<{ sql: string; params: unknown[] }> = [];

  private readonly users = new Map<string, UserRow>();
  private readonly personas = new Map<string, PersonaRow>();
  private readonly memoryItems = new Map<string, MemoryRow>();
  private readonly soulVersions = new Map<string, SoulVersionRow>();
  private readonly soulSnapshots = new Map<string, SoulSnapshotRow>();
  private readonly soulUpdateProposals = new Map<string, SoulUpdateProposalRow>();
  private readonly nodeEvents = new Map<string, NodeEventRow>();
  private readonly conversations = new Map<string, ConversationRow>();
  private readonly runtimeSessions = new Map<string, RuntimeSessionRow>();
  private readonly credentials = new Map<string, CredentialRow>();
  private readonly opsAuditEvents = new Map<string, OpsAuditEventRow>();

  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<{ rows: T[] }> {
    const compactSql = sql.replace(/\s+/g, ' ').trim();
    this.queries.push({ sql, params });

    if (compactSql.includes('CREATE TABLE IF NOT EXISTS nnz_users')) {
      this.schemaSql += sql;
      return rows([]);
    }
    if (compactSql.startsWith('INSERT INTO nnz_users')) {
      const [id, displayName, createdAt] = params;
      this.users.set(String(id), {
        id: String(id),
        display_name: String(displayName),
        created_at: asDate(createdAt),
      });
      return rows([]);
    }
    if (compactSql === 'SELECT * FROM nnz_users WHERE id = $1') {
      return rows(this.users.get(String(params[0])) ? [this.users.get(String(params[0]))] : []);
    }
    if (compactSql.startsWith('INSERT INTO nnz_personas')) {
      const [id, userId, displayName, relationship, type, createdAt] = params;
      this.requireUser(String(userId));
      this.personas.set(String(id), {
        id: String(id),
        user_id: String(userId),
        display_name: String(displayName),
        relationship: String(relationship),
        type: type as PersonaType,
        created_at: asDate(createdAt),
      });
      return rows([]);
    }
    if (compactSql === 'SELECT * FROM nnz_personas WHERE user_id = $1 AND id = $2') {
      return rows(this.findPersona(String(params[0]), String(params[1])));
    }
    if (compactSql === 'SELECT id FROM nnz_personas WHERE id = $1') {
      const persona = this.personas.get(String(params[0]));
      return rows(persona ? [{ id: persona.id }] : []);
    }
    if (compactSql === 'SELECT * FROM nnz_personas WHERE user_id = $1 ORDER BY created_at ASC, id ASC') {
      this.requireUser(String(params[0]));
      return rows(
        [...this.personas.values()]
          .filter((persona) => persona.user_id === String(params[0]))
          .sort(compareCreatedAt),
      );
    }
    if (compactSql.startsWith('INSERT INTO nnz_memory_items')) {
      const [
        id,
        userId,
        personaId,
        type,
        source,
        content,
        confidence,
        sensitivity,
        enabledForSoul,
        enabledForRuntime,
        enabledForSoulUpdate,
        evidenceIds,
        createdBy,
        state,
        createdAt,
      ] = params;
      this.requirePersonaScope(String(userId), String(personaId));
      this.memoryItems.set(String(id), {
        id: String(id),
        user_id: String(userId),
        persona_id: String(personaId),
        type: type as MemoryItem['type'],
        source: source as MemoryItem['source'],
        content: String(content),
        confidence: Number(confidence),
        sensitivity: sensitivity as MemoryItem['sensitivity'],
        enabled_for_soul: Boolean(enabledForSoul),
        enabled_for_runtime: Boolean(enabledForRuntime),
        enabled_for_soul_update: Boolean(enabledForSoulUpdate),
        evidence_ids: JSON.parse(String(evidenceIds)) as string[],
        created_by: createdBy as MemoryItem['createdBy'],
        state: state as MemoryItem['state'],
        created_at: asDate(createdAt),
      });
      return rows([]);
    }
    if (
      compactSql
      === "UPDATE nnz_soul_versions SET status = 'ARCHIVED' WHERE user_id = $1 AND persona_id = $2 AND status = 'ACTIVE'"
    ) {
      for (const version of this.soulVersions.values()) {
        if (
          version.user_id === String(params[0])
          && version.persona_id === String(params[1])
          && version.status === 'ACTIVE'
        ) {
          version.status = 'ARCHIVED';
        }
      }
      return rows([]);
    }
    if (
      compactSql
      === 'SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM nnz_soul_versions WHERE user_id = $1 AND persona_id = $2'
    ) {
      const maxVersion = [...this.soulVersions.values()]
        .filter((version) => version.user_id === String(params[0]) && version.persona_id === String(params[1]))
        .reduce((max, version) => Math.max(max, Number(version.version)), 0);
      return rows([{ next_version: maxVersion + 1 }]);
    }
    if (compactSql.startsWith('INSERT INTO nnz_soul_versions')) {
      const [id, userId, personaId, version, kernelJson, status, knowledgeCutoff, createdAt] = params;
      this.requirePersonaScope(String(userId), String(personaId));
      this.soulVersions.set(String(id), {
        id: String(id),
        user_id: String(userId),
        persona_id: String(personaId),
        version: Number(version),
        kernel_json: JSON.parse(String(kernelJson)) as Record<string, unknown>,
        status: status as SoulVersion['status'],
        knowledge_cutoff: knowledgeCutoff ? asDate(knowledgeCutoff) : null,
        created_at: asDate(createdAt),
      });
      return rows([]);
    }
    if (
      compactSql
      === "SELECT * FROM nnz_soul_versions WHERE user_id = $1 AND persona_id = $2 AND status = 'ACTIVE' ORDER BY version DESC LIMIT 1"
    ) {
      return rows(
        [...this.soulVersions.values()]
          .filter(
            (version) =>
              version.user_id === String(params[0])
              && version.persona_id === String(params[1])
              && version.status === 'ACTIVE',
          )
          .sort((left, right) => Number(right.version) - Number(left.version))
          .slice(0, 1),
      );
    }
    if (compactSql === 'SELECT * FROM nnz_soul_versions WHERE user_id = $1 AND persona_id = $2 ORDER BY version ASC') {
      return rows(
        [...this.soulVersions.values()]
          .filter((version) => version.user_id === String(params[0]) && version.persona_id === String(params[1]))
          .sort((left, right) => Number(left.version) - Number(right.version)),
      );
    }
    if (compactSql.startsWith('INSERT INTO nnz_soul_snapshots')) {
      const [id, userId, personaId, soulVersionId, kernelJson, memoryIds, sealedAt] = params;
      this.requirePersonaScope(String(userId), String(personaId));
      this.requireSoulVersionScope(String(userId), String(personaId), String(soulVersionId));
      this.soulSnapshots.set(String(id), {
        id: String(id),
        user_id: String(userId),
        persona_id: String(personaId),
        soul_version_id: String(soulVersionId),
        kernel_json: JSON.parse(String(kernelJson)) as Record<string, unknown>,
        memory_ids: JSON.parse(String(memoryIds)) as string[],
        sealed_at: asDate(sealedAt),
      });
      return rows([]);
    }
    if (compactSql === 'SELECT * FROM nnz_soul_snapshots WHERE user_id = $1 AND persona_id = $2 AND id = $3') {
      const snapshot = this.soulSnapshots.get(String(params[2]));
      return rows(
        snapshot && snapshot.user_id === String(params[0]) && snapshot.persona_id === String(params[1])
          ? [snapshot]
          : [],
      );
    }
    if (
      compactSql
      === 'SELECT * FROM nnz_memory_items WHERE user_id = $1 AND persona_id = $2 ORDER BY created_at ASC, id ASC'
    ) {
      return rows(
        [...this.memoryItems.values()]
          .filter((memory) => memory.user_id === String(params[0]) && memory.persona_id === String(params[1]))
          .sort(compareCreatedAt),
      );
    }
    if (compactSql.startsWith('INSERT INTO nnz_soul_update_proposals')) {
      const [id, userId, personaId, fieldPath, oldValue, newValue, evidenceIds, status, createdAt] = params;
      this.requirePersonaScope(String(userId), String(personaId));
      this.soulUpdateProposals.set(String(id), {
        id: String(id),
        user_id: String(userId),
        persona_id: String(personaId),
        field_path: String(fieldPath),
        old_value: JSON.parse(String(oldValue)),
        new_value: JSON.parse(String(newValue)),
        evidence_ids: JSON.parse(String(evidenceIds)) as string[],
        status: status as SoulUpdateProposal['status'],
        created_at: asDate(createdAt),
      });
      return rows([]);
    }
    if (
      compactSql
      === 'SELECT * FROM nnz_soul_update_proposals WHERE user_id = $1 AND persona_id = $2 AND status = $3 ORDER BY created_at ASC, id ASC'
    ) {
      return rows(
        [...this.soulUpdateProposals.values()]
          .filter(
            (proposal) =>
              proposal.user_id === String(params[0])
              && proposal.persona_id === String(params[1])
              && proposal.status === params[2],
          )
          .sort(compareCreatedAt),
      );
    }
    if (
      compactSql
      === 'SELECT * FROM nnz_soul_update_proposals WHERE user_id = $1 AND persona_id = $2 ORDER BY created_at ASC, id ASC'
    ) {
      return rows(
        [...this.soulUpdateProposals.values()]
          .filter((proposal) => proposal.user_id === String(params[0]) && proposal.persona_id === String(params[1]))
          .sort(compareCreatedAt),
      );
    }
    if (compactSql === 'SELECT * FROM nnz_soul_update_proposals WHERE user_id = $1 AND persona_id = $2 AND id = $3') {
      const proposal = this.soulUpdateProposals.get(String(params[2]));
      return rows(
        proposal && proposal.user_id === String(params[0]) && proposal.persona_id === String(params[1])
          ? [proposal]
          : [],
      );
    }
    if (
      compactSql
      === "UPDATE nnz_soul_update_proposals SET status = 'ACCEPTED' WHERE user_id = $1 AND persona_id = $2 AND id = $3 AND status = 'PENDING'"
    ) {
      const proposal = this.soulUpdateProposals.get(String(params[2]));
      if (
        proposal
        && proposal.user_id === String(params[0])
        && proposal.persona_id === String(params[1])
        && proposal.status === 'PENDING'
      ) {
        proposal.status = 'ACCEPTED';
      }
      return rows([]);
    }
    if (
      compactSql
      === "UPDATE nnz_soul_update_proposals SET status = 'REJECTED' WHERE user_id = $1 AND persona_id = $2 AND id = $3 AND status = 'PENDING'"
    ) {
      const proposal = this.soulUpdateProposals.get(String(params[2]));
      if (
        proposal
        && proposal.user_id === String(params[0])
        && proposal.persona_id === String(params[1])
        && proposal.status === 'PENDING'
      ) {
        proposal.status = 'REJECTED';
      }
      return rows([]);
    }
    if (
      compactSql
      === "UPDATE nnz_soul_versions SET status = 'ARCHIVED' WHERE user_id = $1 AND persona_id = $2 AND id = $3"
    ) {
      const version = this.soulVersions.get(String(params[2]));
      if (version && version.user_id === String(params[0]) && version.persona_id === String(params[1])) {
        version.status = 'ARCHIVED';
      }
      return rows([]);
    }
    if (compactSql.startsWith('INSERT INTO nnz_node_events')) {
      const [id, userId, personaId, name, status, startAt, endAt] = params;
      this.requirePersonaScope(String(userId), String(personaId));
      this.nodeEvents.set(String(id), {
        id: String(id),
        user_id: String(userId),
        persona_id: String(personaId),
        name: String(name),
        status: status as NodeEvent['status'],
        start_at: asDate(startAt),
        end_at: asDate(endAt),
      });
      return rows([]);
    }
    if (compactSql === 'SELECT * FROM nnz_node_events WHERE user_id = $1 AND persona_id = $2 ORDER BY start_at ASC, id ASC') {
      return rows(
        [...this.nodeEvents.values()]
          .filter((node) => node.user_id === String(params[0]) && node.persona_id === String(params[1]))
          .sort(compareStartAt),
      );
    }
    if (compactSql === 'SELECT * FROM nnz_runtime_sessions WHERE user_id = $1 AND persona_id = $2') {
      const session = this.runtimeSessions.get(scopeKey(String(params[0]), String(params[1])));
      return rows(session ? [session] : []);
    }
    if (compactSql.startsWith('INSERT INTO nnz_runtime_sessions')) {
      const [
        userId,
        personaId,
        state,
        soulSnapshotId,
        nodeId,
        nodeName,
        dailyMessageCount,
        lastMessageDate,
        updatedAt,
      ] = params;
      this.requirePersonaScope(String(userId), String(personaId));
      this.runtimeSessions.set(scopeKey(String(userId), String(personaId)), {
        user_id: String(userId),
        persona_id: String(personaId),
        state: state as RuntimeSession['state'],
        soul_snapshot_id: soulSnapshotId ? String(soulSnapshotId) : null,
        node_id: nodeId ? String(nodeId) : null,
        node_name: nodeName ? String(nodeName) : null,
        daily_message_count: dailyMessageCount === null ? null : Number(dailyMessageCount),
        last_message_date: lastMessageDate ? String(lastMessageDate) : null,
        updated_at: asDate(updatedAt),
      });
      return rows([]);
    }
    if (
      compactSql
      === "SELECT * FROM nnz_node_events WHERE user_id = $1 AND persona_id = $2 AND name = $3 AND status = 'ACTIVE' ORDER BY start_at ASC, id ASC LIMIT 1"
    ) {
      return rows(
        [...this.nodeEvents.values()]
          .filter(
            (node) =>
              node.user_id === String(params[0])
              && node.persona_id === String(params[1])
              && node.name === String(params[2])
              && node.status === 'ACTIVE',
          )
          .sort(compareStartAt)
          .slice(0, 1),
      );
    }
    if (
      compactSql
      === "UPDATE nnz_node_events SET status = 'COMPLETED' WHERE user_id = $1 AND persona_id = $2 AND id = $3"
    ) {
      const node = this.nodeEvents.get(String(params[2]));
      if (node && node.user_id === String(params[0]) && node.persona_id === String(params[1])) {
        node.status = 'COMPLETED';
      }
      return rows([]);
    }
    if (
      compactSql
      === "UPDATE nnz_soul_versions SET status = 'GRADUATED' WHERE user_id = $1 AND persona_id = $2"
    ) {
      for (const version of this.soulVersions.values()) {
        if (version.user_id === String(params[0]) && version.persona_id === String(params[1])) {
          version.status = 'GRADUATED';
        }
      }
      return rows([]);
    }
    if (compactSql.startsWith('INSERT INTO nnz_conversation_messages')) {
      const [id, userId, personaId, nodeId, role, content, createdAt] = params;
      this.requirePersonaScope(String(userId), String(personaId));
      this.conversations.set(String(id), {
        id: String(id),
        user_id: String(userId),
        persona_id: String(personaId),
        node_id: nodeId ? String(nodeId) : null,
        role: role as ConversationMessage['role'],
        content: String(content),
        created_at: asDate(createdAt),
      });
      return rows([]);
    }
    if (
      compactSql
      === 'SELECT * FROM nnz_conversation_messages WHERE user_id = $1 AND persona_id = $2 ORDER BY created_at ASC, id ASC'
    ) {
      return rows(
        [...this.conversations.values()]
          .filter((message) => message.user_id === String(params[0]) && message.persona_id === String(params[1]))
          .sort(compareCreatedAt),
      );
    }
    if (compactSql === 'SELECT * FROM nnz_node_events WHERE user_id = $1 AND persona_id = $2 AND id = $3') {
      const node = this.nodeEvents.get(String(params[2]));
      return rows(node && node.user_id === String(params[0]) && node.persona_id === String(params[1]) ? [node] : []);
    }
    if (compactSql.startsWith('INSERT INTO nnz_credentials')) {
      const [userId, email, passwordHash, createdAt] = params;
      this.requireUser(String(userId));
      this.credentials.set(String(userId), {
        user_id: String(userId),
        email: String(email),
        password_hash: String(passwordHash),
        created_at: asDate(createdAt),
      });
      return rows([]);
    }
    if (compactSql === 'SELECT * FROM nnz_credentials WHERE email = $1') {
      return rows([...this.credentials.values()].filter((credential) => credential.email === String(params[0])));
    }
    if (compactSql.startsWith('INSERT INTO nnz_ops_audit_events')) {
      const [id, action, outcome, actor, targetUserIds, metadata, createdAt] = params;
      this.opsAuditEvents.set(String(id), {
        id: String(id),
        action: action as OpsAuditAction,
        outcome: outcome as OpsAuditOutcome,
        actor: String(actor),
        target_user_ids: JSON.parse(String(targetUserIds)) as string[],
        metadata: JSON.parse(String(metadata)) as Record<string, string | number | boolean | null>,
        created_at: asDate(createdAt),
      });
      return rows([]);
    }
    if (compactSql === 'SELECT * FROM nnz_ops_audit_events ORDER BY created_at DESC, id DESC') {
      return rows([...this.opsAuditEvents.values()].sort(compareCreatedAtDesc));
    }
    if (compactSql === 'SELECT * FROM nnz_ops_audit_events ORDER BY created_at DESC, id DESC LIMIT $1') {
      return rows([...this.opsAuditEvents.values()].sort(compareCreatedAtDesc).slice(0, Number(params[0])));
    }

    throw new Error(`Unexpected SQL in fake scoped pool: ${compactSql}`);
  }

  async end(): Promise<void> {
    return undefined;
  }

  private requireUser(userId: string): void {
    if (!this.users.has(userId)) {
      throw new Error(`User ${userId} was not found in fake pool.`);
    }
  }

  private requirePersonaScope(userId: string, personaId: string): void {
    if (this.findPersona(userId, personaId).length === 0) {
      throw new Error(`Persona ${personaId} does not belong to user ${userId} in fake pool.`);
    }
  }

  private requireSoulVersionScope(userId: string, personaId: string, soulVersionId: string): void {
    const version = this.soulVersions.get(soulVersionId);
    if (!version || version.user_id !== userId || version.persona_id !== personaId) {
      throw new Error(`Soul version ${soulVersionId} does not belong to user ${userId} in fake pool.`);
    }
  }

  private findPersona(userId: string, personaId: string): PersonaRow[] {
    const persona = this.personas.get(personaId);
    return persona && persona.user_id === userId ? [persona] : [];
  }
}

function rows<T = unknown>(values: unknown[]): { rows: T[] } {
  return { rows: values as T[] };
}

function asDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function compareCreatedAt<T extends { created_at: Date; id: string }>(left: T, right: T): number {
  return left.created_at.getTime() - right.created_at.getTime() || left.id.localeCompare(right.id);
}

function compareCreatedAtDesc<T extends { created_at: Date; id: string }>(left: T, right: T): number {
  return right.created_at.getTime() - left.created_at.getTime() || right.id.localeCompare(left.id);
}

function compareStartAt<T extends { start_at: Date; id: string }>(left: T, right: T): number {
  return left.start_at.getTime() - right.start_at.getTime() || left.id.localeCompare(right.id);
}

function scopeKey(userId: string, personaId: string): string {
  return `${userId}:${personaId}`;
}

interface UserRow {
  id: string;
  display_name: string;
  created_at: Date;
}

interface PersonaRow {
  id: string;
  user_id: string;
  display_name: string;
  relationship: string;
  type: PersonaType;
  created_at: Date;
}

interface MemoryRow {
  id: string;
  user_id: string;
  persona_id: string;
  type: MemoryItem['type'];
  source: MemoryItem['source'];
  content: string;
  confidence: number;
  sensitivity: MemoryItem['sensitivity'];
  enabled_for_soul: boolean;
  enabled_for_runtime: boolean;
  enabled_for_soul_update: boolean;
  evidence_ids: string[];
  created_by: MemoryItem['createdBy'];
  state: MemoryItem['state'];
  created_at: Date;
}

interface SoulVersionRow {
  id: string;
  user_id: string;
  persona_id: string;
  version: number;
  kernel_json: Record<string, unknown>;
  status: SoulVersion['status'];
  knowledge_cutoff: Date | null;
  created_at: Date;
}

interface SoulSnapshotRow {
  id: string;
  user_id: string;
  persona_id: string;
  soul_version_id: string;
  kernel_json: Record<string, unknown>;
  memory_ids: string[];
  sealed_at: Date;
}

interface SoulUpdateProposalRow {
  id: string;
  user_id: string;
  persona_id: string;
  field_path: string;
  old_value: unknown;
  new_value: unknown;
  evidence_ids: string[];
  status: SoulUpdateProposal['status'];
  created_at: Date;
}

interface NodeEventRow {
  id: string;
  user_id: string;
  persona_id: string;
  name: string;
  status: NodeEvent['status'];
  start_at: Date;
  end_at: Date;
}

interface ConversationRow {
  id: string;
  user_id: string;
  persona_id: string;
  node_id: string | null;
  role: ConversationMessage['role'];
  content: string;
  created_at: Date;
}

interface RuntimeSessionRow {
  user_id: string;
  persona_id: string;
  state: RuntimeSession['state'];
  soul_snapshot_id: string | null;
  node_id: string | null;
  node_name: string | null;
  daily_message_count: number | null;
  last_message_date: string | null;
  updated_at: Date;
}

interface CredentialRow {
  user_id: string;
  email: string;
  password_hash: string;
  created_at: Date;
}

interface OpsAuditEventRow {
  id: string;
  action: OpsAuditAction;
  outcome: OpsAuditOutcome;
  actor: string;
  target_user_ids: string[];
  metadata: Record<string, string | number | boolean | null>;
  created_at: Date;
}
