import { describe, expect, it } from 'vitest';

import { createPostgresPersistenceFromPool } from './postgres-persistence';
import { InMemorySoulStore } from './soul-store';

describe('Postgres snapshot persistence', () => {
  it('saves and loads user-scoped persona data without cross-user leakage', async () => {
    const pool = new FakePool();
    const persistence = createPostgresPersistenceFromPool(pool);

    const store = new InMemorySoulStore();
    const userA = store.createUser('用户 A');
    const userB = store.createUser('用户 B');
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
      kernelJson: { languageModel: { petPhrases: ['你自己拿主意'] } },
    });
    store.createSoulVersion({
      userId: userB.id,
      personaId: personaB.id,
      kernelJson: { languageModel: { petPhrases: ['慢慢来'] } },
    });
    store.addConversation({
      userId: userA.id,
      personaId: personaA.id,
      role: 'USER',
      content: '我要结婚了。',
    });
    store.recordOpsAuditEvent({
      action: 'OVERVIEW_READ',
      outcome: 'SUCCESS',
      actor: 'ops-token',
      metadata: { path: '/api/ops/overview' },
    });
    store.storeCredential(userA.id, 'a@example.com', 'hash-a');
    store.storeCredential(userB.id, 'b@example.com', 'hash-b');

    await persistence.save(store);

    const loadedStore = new InMemorySoulStore();
    expect(await persistence.load(loadedStore)).toBe(true);

    expect(loadedStore.listPersonasForUser(userA.id)).toEqual([personaA]);
    expect(loadedStore.listPersonasForUser(userB.id)).toEqual([personaB]);
    expect(loadedStore.listConversations({ userId: userA.id, personaId: personaA.id })).toHaveLength(1);
    expect(loadedStore.listConversations({ userId: userB.id, personaId: personaB.id })).toEqual([]);
    expect(loadedStore.listOpsAuditEvents()[0]).toMatchObject({
      action: 'OVERVIEW_READ',
      outcome: 'SUCCESS',
      actor: 'ops-token',
      metadata: { path: '/api/ops/overview' },
    });
    expect(loadedStore.getCredentialByEmail('a@example.com')?.userId).toBe(userA.id);
    expect(loadedStore.getCredentialByEmail('b@example.com')?.userId).toBe(userB.id);
  });

  it('returns false when no snapshot exists', async () => {
    const persistence = createPostgresPersistenceFromPool(new FakePool());
    await expect(persistence.load(new InMemorySoulStore())).resolves.toBe(false);
  });
});

class FakePool {
  private snapshotJson: unknown;

  async query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> {
    if (sql.includes('SELECT snapshot_json')) {
      return {
        rows: this.snapshotJson ? ([{ snapshot_json: this.snapshotJson }] as T[]) : [],
      };
    }
    if (sql.includes('INSERT INTO nnz_store_snapshots')) {
      this.snapshotJson = JSON.parse(String(params?.[1] ?? '{}'));
    }
    return { rows: [] };
  }

  async end(): Promise<void> {
    return undefined;
  }
}
