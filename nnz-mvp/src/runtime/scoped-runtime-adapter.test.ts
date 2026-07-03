import { describe, expect, it } from 'vitest';

import { CovenantStateError } from '../domain/errors';
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
