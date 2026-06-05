import { afterEach, describe, expect, it } from 'vitest';
import { unlinkSync } from 'node:fs';
import { InMemorySoulStore } from './soul-store';
import { loadStore, saveStore } from './persistence';

function tempDbPath(): string {
  return `/tmp/nnz-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
}

describe('SQLite persistence', () => {
  const paths: string[] = [];

  afterEach(() => {
    for (const p of paths) {
      try { unlinkSync(p); } catch { /* ok */ }
      try { unlinkSync(p + '-wal'); } catch { /* ok */ }
      try { unlinkSync(p + '-shm'); } catch { /* ok */ }
    }
  });

  it('saves and loads store data', () => {
    const dbPath = tempDbPath();
    paths.push(dbPath);

    const store = new InMemorySoulStore();
    const user = store.createUser('Alice');
    const persona = store.createPersona({
      userId: user.id, displayName: '爸爸', relationship: '女儿', type: 'DECEASED',
    });
    store.createSoulVersion({
      userId: user.id, personaId: persona.id,
      kernelJson: { identityCore: { displayName: '爸爸', relationship: '女儿心中的父亲' }, affectModel: { humorLevel: 'high' } },
    });
    store.addMemory({
      userId: user.id, personaId: persona.id,
      type: 'DESCRIPTION', content: '爸爸很幽默。', confidence: 0.9, enabledForSoul: true,
    });
    store.addConversation({
      userId: user.id, personaId: persona.id,
      role: 'USER', content: '爸，我想你了。',
    });

    saveStore(store, dbPath);

    const store2 = new InMemorySoulStore();
    const loaded = loadStore(store2, dbPath);
    expect(loaded).toBe(true);

    const scope = { userId: user.id, personaId: persona.id };
    const soul = store2.getLatestSoulVersion(scope);
    expect(soul.kernelJson).toEqual({ identityCore: { displayName: '爸爸', relationship: '女儿心中的父亲' }, affectModel: { humorLevel: 'high' } });

    const memories = store2.listMemory(scope);
    expect(memories).toHaveLength(1);
    expect(memories[0]!.content).toBe('爸爸很幽默。');

    const conversations = store2.listConversations(scope);
    expect(conversations).toHaveLength(1);
    expect(conversations[0]!.content).toBe('爸，我想你了。');
  });

  it('returns false when loading from empty/nonexistent db', () => {
    const store = new InMemorySoulStore();
    const loaded = loadStore(store, '/tmp/nonexistent-nnz-test.db');
    expect(loaded).toBe(false);
  });

  it('preserves covenant state across save/load', () => {
    const dbPath = tempDbPath();
    paths.push(dbPath);

    const store = new InMemorySoulStore();
    const user = store.createUser('Bob');
    const persona = store.createPersona({
      userId: user.id, displayName: '妈妈', relationship: '儿子', type: 'DECEASED',
    });
    store.createSoulVersion({
      userId: user.id, personaId: persona.id, kernelJson: {},
    });
    store.sealSoul({ userId: user.id, personaId: persona.id });

    saveStore(store, dbPath);

    const store2 = new InMemorySoulStore();
    loadStore(store2, dbPath);

    const session = store2.getRuntimeSession({ userId: user.id, personaId: persona.id });
    expect(session.state).toBe('SEALED');
  });
});
