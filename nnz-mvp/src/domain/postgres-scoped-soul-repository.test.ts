import { describe, expect, it } from 'vitest';

import { OwnershipError, ScopeValidationError } from './errors';
import {
  createPostgresPersona,
  createPostgresScopedSoulRepositoryFromPool,
  createPostgresUser,
  ensurePostgresScopedSchema,
  listPostgresPersonasForUser,
  type QueryablePool,
} from './postgres-scoped-soul-repository';
import type { ConversationMessage, MemoryItem, PersonaType } from './types';

describe('PostgresScopedSoulRepository', () => {
  it('creates scoped tables and composite foreign keys', async () => {
    const pool = new FakeScopedPool();

    await ensurePostgresScopedSchema(pool);

    expect(pool.schemaSql).toContain('FOREIGN KEY (user_id, persona_id)');
    expect(pool.schemaSql).toContain('idx_nnz_personas_user_created');
    expect(pool.schemaSql).toContain('idx_nnz_memory_scope_created');
    expect(pool.schemaSql).toContain('idx_nnz_conversation_scope_created');
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
  private readonly conversations = new Map<string, ConversationRow>();

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
      === 'SELECT * FROM nnz_memory_items WHERE user_id = $1 AND persona_id = $2 ORDER BY created_at ASC, id ASC'
    ) {
      return rows(
        [...this.memoryItems.values()]
          .filter((memory) => memory.user_id === String(params[0]) && memory.persona_id === String(params[1]))
          .sort(compareCreatedAt),
      );
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

interface ConversationRow {
  id: string;
  user_id: string;
  persona_id: string;
  node_id: string | null;
  role: ConversationMessage['role'];
  content: string;
  created_at: Date;
}
