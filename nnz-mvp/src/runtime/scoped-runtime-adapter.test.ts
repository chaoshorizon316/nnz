import { describe, expect, it } from 'vitest';

import { CovenantStateError, NotFoundError } from '../domain/errors';
import { InMemorySoulStore } from '../domain/soul-store';
import { createInMemoryScopedRuntimeAdapter, createPostgresScopedRuntimeAdapter } from './scoped-runtime-adapter';

describe('scoped runtime adapter', () => {
  it('keeps auth, personas, memories, and conversations scoped by user/persona', async () => {
    const adapter = createInMemoryScopedRuntimeAdapter(new InMemorySoulStore());
    const userA = await adapter.createUser('user-a@example.test');
    const userB = await adapter.createUser('user-b@example.test');
    await adapter.storeCredential(userA.id, 'user-a@example.test', 'hash-a');

    expect(await adapter.getCredentialByEmail('user-a@example.test')).toMatchObject({
      userId: userA.id,
      email: 'user-a@example.test',
      passwordHash: 'hash-a',
    });

    const personaA = await adapter.createPersona({
      userId: userA.id,
      displayName: '爸爸',
      relationship: '女儿',
      type: 'DECEASED',
    });
    const personaB = await adapter.createPersona({
      userId: userB.id,
      displayName: '爸爸',
      relationship: '儿子',
      type: 'DECEASED',
    });

    expect(await adapter.listPersonasForUser(userA.id)).toEqual([personaA]);
    expect(await adapter.listPersonasForUser(userB.id)).toEqual([personaB]);

    const runtimeA = adapter.forPersona({ userId: userA.id, personaId: personaA.id });
    const runtimeB = adapter.forPersona({ userId: userB.id, personaId: personaB.id });
    await runtimeA.createSoulVersion({
      kernelJson: { identityCore: { displayName: '爸爸' }, affectModel: { humorLevel: 'low' } },
    });
    await runtimeB.createSoulVersion({
      kernelJson: { identityCore: { displayName: '爸爸' }, affectModel: { humorLevel: 'medium' } },
    });
    const memoryA = await runtimeA.addMemory({
      type: 'DESCRIPTION',
      content: 'A 记得爸爸说话很慢。',
      confidence: 1,
      enabledForSoul: true,
    });
    const memoryB = await runtimeB.addMemory({
      type: 'DESCRIPTION',
      content: 'B 记得爸爸常说慢慢来。',
      confidence: 1,
      enabledForSoul: true,
    });
    const conversationA = await runtimeA.addConversation({ role: 'USER', content: '我要结婚了。' });
    const conversationB = await runtimeB.addConversation({ role: 'USER', content: '我今天很想你。' });

    expect(await runtimeA.listMemory()).toEqual([memoryA]);
    expect(await runtimeB.listMemory()).toEqual([memoryB]);
    expect(await runtimeA.listConversations()).toEqual([conversationA]);
    expect(await runtimeB.listConversations()).toEqual([conversationB]);

    const contextA = await runtimeA.getRuntimeContext();
    const contextB = await runtimeB.getRuntimeContext();
    expect(contextA.memories.map((memory) => memory.content)).toEqual(['A 记得爸爸说话很慢。']);
    expect(contextB.memories.map((memory) => memory.content)).toEqual(['B 记得爸爸常说慢慢来。']);
    expect(contextA.soul.kernelJson).toMatchObject({ affectModel: { humorLevel: 'low' } });
    expect(contextB.soul.kernelJson).toMatchObject({ affectModel: { humorLevel: 'medium' } });
  });

  it('rebuilds NODE runtime context from the sealed snapshot plus node memories', async () => {
    const adapter = createInMemoryScopedRuntimeAdapter(new InMemorySoulStore());
    const user = await adapter.createUser('node-user@example.test');
    const persona = await adapter.createPersona({
      userId: user.id,
      displayName: '妈妈',
      relationship: '孩子',
      type: 'DECEASED',
    });
    const runtime = adapter.forPersona({ userId: user.id, personaId: persona.id });
    await runtime.createSoulVersion({
      kernelJson: {
        identityCore: { displayName: '妈妈', relationship: '孩子心中的母亲' },
        languageModel: { petPhrases: ['好好吃饭'] },
      },
    });
    const baseMemory = await runtime.addMemory({
      type: 'DESCRIPTION',
      content: '妈妈常提醒我要好好吃饭。',
      confidence: 1,
      enabledForSoul: true,
    });

    const sealed = await runtime.sealSoul();
    await expect(runtime.getRuntimeContext()).rejects.toBeInstanceOf(CovenantStateError);

    const activated = await runtime.activateNode('婚礼');
    const context = await runtime.getRuntimeContext();

    expect(activated.session).toMatchObject({
      state: 'NODE',
      soulSnapshotId: sealed.snapshot.id,
      nodeContext: { nodeName: '婚礼' },
    });
    expect(context).toMatchObject({
      state: 'NODE',
      nodeName: '婚礼',
      soul: {
        id: sealed.snapshot.id,
        version: -1,
        status: 'ARCHIVED',
      },
    });
    expect(context.memories.map((memory) => memory.id)).toContain(baseMemory.id);
    expect(context.memories.some((memory) => memory.type === 'NODE_MEMORY' && memory.content.includes('婚礼'))).toBe(true);

    await runtime.completeNode();
    await runtime.graduateSoul();
    await expect(runtime.getRuntimeContext()).rejects.toBeInstanceOf(CovenantStateError);
  });

  it('updates runtime usage without changing the covenant context', async () => {
    const adapter = createInMemoryScopedRuntimeAdapter(new InMemorySoulStore());
    const user = await adapter.createUser('usage-user@example.test');
    const persona = await adapter.createPersona({
      userId: user.id,
      displayName: '爸爸',
      relationship: '女儿',
      type: 'DECEASED',
    });
    const runtime = adapter.forPersona({ userId: user.id, personaId: persona.id });
    await runtime.createSoulVersion({
      kernelJson: { identityCore: { displayName: '爸爸' } },
    });

    const sealed = await runtime.sealSoul();
    const activated = await runtime.activateNode('婚礼');
    const updated = await runtime.updateRuntimeUsage({
      dailyMessageCount: 8,
      lastMessageDate: '2026-07-08',
    });

    expect(updated).toMatchObject({
      state: 'NODE',
      soulSnapshotId: sealed.snapshot.id,
      nodeContext: {
        nodeId: activated.node.id,
        nodeName: '婚礼',
      },
      dailyMessageCount: 8,
      lastMessageDate: '2026-07-08',
    });
    expect(await runtime.getRuntimeSession()).toMatchObject(updated);
    expect((await runtime.getRuntimeContext()).nodeName).toBe('婚礼');
  });

  it('exports and deletes only the authenticated user data without credential hashes', async () => {
    const adapter = createInMemoryScopedRuntimeAdapter(new InMemorySoulStore());
    const userA = await adapter.createUser('user-a@example.test');
    const userB = await adapter.createUser('user-b@example.test');
    await adapter.storeCredential(userA.id, 'user-a@example.test', 'hash-a-secret');
    await adapter.storeCredential(userB.id, 'user-b@example.test', 'hash-b-secret');

    const personaA = await adapter.createPersona({
      userId: userA.id,
      displayName: '爸爸',
      relationship: '女儿',
      type: 'DECEASED',
    });
    const personaB = await adapter.createPersona({
      userId: userB.id,
      displayName: '爸爸',
      relationship: '儿子',
      type: 'DECEASED',
    });
    const runtimeA = adapter.forPersona({ userId: userA.id, personaId: personaA.id });
    const runtimeB = adapter.forPersona({ userId: userB.id, personaId: personaB.id });
    await runtimeA.createSoulVersion({
      kernelJson: { identityCore: { displayName: '爸爸' }, languageModel: { petPhrases: ['慢慢吃饭'] } },
    });
    await runtimeB.createSoulVersion({
      kernelJson: { identityCore: { displayName: '爸爸' }, languageModel: { petPhrases: ['慢慢来'] } },
    });
    await runtimeA.addMemory({
      type: 'DESCRIPTION',
      content: 'A 的私密记忆',
      confidence: 1,
      enabledForSoul: true,
    });
    await runtimeB.addMemory({
      type: 'DESCRIPTION',
      content: 'B 的私密记忆',
      confidence: 1,
      enabledForSoul: true,
    });
    await runtimeA.addConversation({ role: 'USER', content: 'A 的聊天' });
    await runtimeB.addConversation({ role: 'USER', content: 'B 的聊天' });
    await runtimeA.sealSoul();

    const exported = await adapter.exportUserData(userA.id);
    const exportedJson = JSON.stringify(exported);
    expect(exported).toMatchObject({
      user: { id: userA.id },
      credential: { email: 'user-a@example.test' },
      totals: {
        users: 1,
        personas: 1,
        memoryItems: 1,
        conversationMessages: 1,
        credentials: 1,
      },
    });
    expect(exported.soulSnapshots).toHaveLength(1);
    expect(exportedJson).toContain('A 的私密记忆');
    expect(exportedJson).toContain('A 的聊天');
    expect(exportedJson).not.toContain('B 的私密记忆');
    expect(exportedJson).not.toContain('B 的聊天');
    expect(exportedJson).not.toContain('hash-a-secret');
    expect(exportedJson).not.toContain('hash-b-secret');

    const receipt = await adapter.deleteUserData(userA.id);
    expect(receipt).toMatchObject({
      userId: userA.id,
      deleted: {
        users: 1,
        personas: 1,
        memoryItems: 1,
        conversationMessages: 1,
        credentials: 1,
      },
    });
    expect(await adapter.getCredentialByEmail('user-a@example.test')).toBeUndefined();
    await expect(adapter.exportUserData(userA.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await adapter.exportUserData(userB.id)).memoryItems.map((memory) => memory.content)).toEqual(['B 的私密记忆']);
  });

  it('wraps a Postgres scoped pool without exposing database URLs or unbound persona access', async () => {
    const pool = new FakePostgresPool();
    const adapter = createPostgresScopedRuntimeAdapter(pool);
    const runtime = adapter.forPersona({ userId: 'user_a', personaId: 'persona_a' });

    await adapter.storeCredential('user_a', 'user@example.test', 'hash-secret');
    const credential = await adapter.getCredentialByEmail('user@example.test');

    expect(runtime.scope).toEqual({ userId: 'user_a', personaId: 'persona_a' });
    expect(credential).toEqual({
      userId: 'user_a',
      email: 'user@example.test',
      passwordHash: 'hash-secret',
      createdAt: '2026-07-03T00:00:00.000Z',
    });
    expect(pool.calls.map((call) => call.params)).toEqual([
      ['user_a', 'user@example.test', 'hash-secret', expect.any(Date)],
      ['user@example.test'],
    ]);
    expect(JSON.stringify(pool.calls)).not.toContain('postgres://');
  });

  it('exports and deletes user data from Postgres with scoped table filters', async () => {
    const pool = new FakePostgresUserDataPool();
    const adapter = createPostgresScopedRuntimeAdapter(pool);

    const exported = await adapter.exportUserData('user_a');
    const exportedJson = JSON.stringify(exported);

    expect(exported).toMatchObject({
      user: { id: 'user_a' },
      credential: { email: 'user-a@example.test' },
      personas: [{ id: 'persona_a', userId: 'user_a' }],
      totals: {
        users: 1,
        personas: 1,
        soulVersions: 1,
        soulSnapshots: 1,
        memoryItems: 1,
        soulUpdateProposals: 1,
        nodeEvents: 1,
        conversationMessages: 1,
        sessions: 1,
        credentials: 1,
      },
    });
    expect(exported.memoryItems.map((memory) => memory.content)).toEqual(['postgres private memory A']);
    expect(exported.conversationMessages.map((message) => message.content)).toEqual(['postgres private chat A']);
    expect(exportedJson).not.toContain('hash-a-secret');
    expect(exportedJson).not.toContain('postgres private memory B');
    expect(exportedJson).not.toContain('postgres private chat B');

    const scopedDataCalls = pool.calls.filter((call) => (
      call.sql.includes('FROM nnz_soul_versions')
      || call.sql.includes('FROM nnz_soul_snapshots')
      || call.sql.includes('FROM nnz_memory_items')
      || call.sql.includes('FROM nnz_soul_update_proposals')
      || call.sql.includes('FROM nnz_node_events')
      || call.sql.includes('FROM nnz_conversation_messages')
      || call.sql.includes('FROM nnz_runtime_sessions')
    ));
    expect(scopedDataCalls.length).toBeGreaterThan(0);
    expect(scopedDataCalls.every((call) => call.params[0] === 'user_a' && call.params[1] === 'persona_a')).toBe(true);

    const receipt = await adapter.deleteUserData('user_a');
    expect(receipt.deleted.memoryItems).toBe(1);
    expect(pool.deletedUserIds).toEqual(['user_a']);
  });
});

class FakePostgresPool {
  readonly calls: Array<{ sql: string; params: unknown[] }> = [];

  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<{ rows: T[] }> {
    this.calls.push({ sql, params });
    if (sql.includes('FROM nnz_credentials')) {
      return {
        rows: [{
          user_id: 'user_a',
          email: params[0],
          password_hash: 'hash-secret',
          created_at: new Date('2026-07-03T00:00:00.000Z'),
        } as T],
      };
    }
    return { rows: [] };
  }
}

class FakePostgresUserDataPool {
  readonly calls: Array<{ sql: string; params: unknown[] }> = [];
  readonly deletedUserIds: string[] = [];

  private readonly users = [
    { id: 'user_a', display_name: 'User A', created_at: new Date('2026-07-06T00:00:00.000Z') },
    { id: 'user_b', display_name: 'User B', created_at: new Date('2026-07-06T00:00:00.000Z') },
  ];

  private readonly personas = [
    {
      id: 'persona_a',
      user_id: 'user_a',
      display_name: '爸爸',
      relationship: '女儿',
      type: 'DECEASED',
      created_at: new Date('2026-07-06T00:01:00.000Z'),
    },
    {
      id: 'persona_b',
      user_id: 'user_b',
      display_name: '爸爸',
      relationship: '儿子',
      type: 'DECEASED',
      created_at: new Date('2026-07-06T00:01:00.000Z'),
    },
  ];

  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<{ rows: T[] }> {
    this.calls.push({ sql, params });
    if (sql.includes('DELETE FROM nnz_users')) {
      this.deletedUserIds.push(params[0] as string);
      return { rows: [] };
    }
    if (sql.includes('FROM nnz_users')) {
      return { rows: this.users.filter((row) => row.id === params[0]) as T[] };
    }
    if (sql.includes('FROM nnz_personas')) {
      const rows = sql.includes('AND id = $2')
        ? this.personas.filter((row) => row.user_id === params[0] && row.id === params[1])
        : this.personas.filter((row) => row.user_id === params[0]);
      return { rows: rows as T[] };
    }
    if (sql.includes('FROM nnz_credentials')) {
      return {
        rows: params[0] === 'user_a'
          ? [{
            email: 'user-a@example.test',
            password_hash: 'hash-a-secret',
            created_at: new Date('2026-07-06T00:02:00.000Z'),
          } as T]
          : [],
      };
    }
    if (sql.includes('FROM nnz_soul_versions')) {
      return {
        rows: [{
          id: 'soul_a',
          user_id: params[0],
          persona_id: params[1],
          version: 1,
          kernel_json: { identityCore: { displayName: '爸爸' } },
          status: 'ACTIVE',
          knowledge_cutoff: null,
          created_at: new Date('2026-07-06T00:03:00.000Z'),
        } as T],
      };
    }
    if (sql.includes('FROM nnz_soul_snapshots')) {
      return {
        rows: [{
          id: 'snapshot_a',
          user_id: params[0],
          persona_id: params[1],
          soul_version_id: 'soul_a',
          kernel_json: { identityCore: { displayName: '爸爸' } },
          memory_ids: ['memory_a'],
          sealed_at: new Date('2026-07-06T00:04:00.000Z'),
        } as T],
      };
    }
    if (sql.includes('FROM nnz_memory_items')) {
      return {
        rows: [{
          id: 'memory_a',
          user_id: params[0],
          persona_id: params[1],
          type: 'DESCRIPTION',
          source: 'USER_INPUT',
          content: params[0] === 'user_a' ? 'postgres private memory A' : 'postgres private memory B',
          confidence: 1,
          sensitivity: 'LOW',
          enabled_for_soul: true,
          enabled_for_runtime: true,
          enabled_for_soul_update: true,
          evidence_ids: [],
          created_by: 'USER',
          state: 'ACTIVE',
          created_at: new Date('2026-07-06T00:05:00.000Z'),
        } as T],
      };
    }
    if (sql.includes('FROM nnz_soul_update_proposals')) {
      return {
        rows: [{
          id: 'proposal_a',
          user_id: params[0],
          persona_id: params[1],
          field_path: 'affectModel.humorLevel',
          old_value: 'low',
          new_value: 'medium',
          evidence_ids: ['memory_a'],
          status: 'PENDING',
          created_at: new Date('2026-07-06T00:06:00.000Z'),
        } as T],
      };
    }
    if (sql.includes('FROM nnz_node_events')) {
      return {
        rows: [{
          id: 'node_a',
          user_id: params[0],
          persona_id: params[1],
          name: '生日',
          status: 'ACTIVE',
          start_at: new Date('2026-07-06T00:07:00.000Z'),
          end_at: new Date('2026-07-09T00:07:00.000Z'),
        } as T],
      };
    }
    if (sql.includes('FROM nnz_conversation_messages')) {
      return {
        rows: [{
          id: 'message_a',
          user_id: params[0],
          persona_id: params[1],
          node_id: null,
          role: 'USER',
          content: params[0] === 'user_a' ? 'postgres private chat A' : 'postgres private chat B',
          created_at: new Date('2026-07-06T00:08:00.000Z'),
        } as T],
      };
    }
    if (sql.includes('FROM nnz_runtime_sessions')) {
      return {
        rows: [{
          user_id: params[0],
          persona_id: params[1],
          state: 'SEALED',
          soul_snapshot_id: 'snapshot_a',
          node_id: null,
          node_name: null,
          daily_message_count: 3,
          last_message_date: '2026-07-06',
        } as T],
      };
    }
    return { rows: [] };
  }
}
