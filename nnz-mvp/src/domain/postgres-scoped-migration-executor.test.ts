import { describe, expect, it } from 'vitest';

import type { StoreSnapshot } from './persistence';
import {
  EXECUTE_POSTGRES_SCOPED_MIGRATION_CONFIRM,
  executePostgresScopedMigration,
} from './postgres-scoped-migration-executor';
import { InMemorySoulStore } from './soul-store';

describe('Postgres scoped migration executor', () => {
  it('requires explicit confirmation before running any query', async () => {
    const pool = new FakePool();
    await expect(
      executePostgresScopedMigration(pool, createSnapshot(), { confirm: 'WRONG' as never }),
    ).rejects.toThrow(EXECUTE_POSTGRES_SCOPED_MIGRATION_CONFIRM);

    expect(pool.calls).toEqual([]);
  });

  it('executes schema and row inserts in one transaction', async () => {
    const pool = new FakePool();

    const result = await executePostgresScopedMigration(pool, createSnapshot(), {
      confirm: EXECUTE_POSTGRES_SCOPED_MIGRATION_CONFIRM,
      migratedAt: '2026-06-26T00:00:00.000Z',
    });

    expect(result.committed).toBe(true);
    expect(result.totalRows).toBeGreaterThan(0);
    expect(pool.calls[0]?.sql).toBe('BEGIN');
    expect(pool.calls.some((call) => call.sql.includes('CREATE TABLE IF NOT EXISTS nnz_users'))).toBe(true);
    expect(pool.calls.at(-1)?.sql).toBe('COMMIT');
    expect(pool.calls.find((call) => call.sql.startsWith('INSERT INTO nnz_users'))?.params).toContain('user-a@example.test');
    expect(pool.calls.find((call) => call.sql.startsWith('INSERT INTO nnz_memory_items'))?.params).toContain('private memory text');
    expect(pool.calls.find((call) => call.sql.startsWith('INSERT INTO nnz_runtime_sessions'))?.params).toContain('wedding');
  });

  it('can skip schema creation for callers that already ensured schema', async () => {
    const pool = new FakePool();

    await executePostgresScopedMigration(pool, createSnapshot(), {
      confirm: EXECUTE_POSTGRES_SCOPED_MIGRATION_CONFIRM,
      ensureSchema: false,
    });

    expect(pool.calls.some((call) => call.sql.includes('CREATE TABLE IF NOT EXISTS'))).toBe(false);
  });

  it('rolls back when any row insert fails', async () => {
    const pool = new FakePool({ failOnSqlPrefix: 'INSERT INTO nnz_memory_items' });

    await expect(
      executePostgresScopedMigration(pool, createSnapshot(), {
        confirm: EXECUTE_POSTGRES_SCOPED_MIGRATION_CONFIRM,
      }),
    ).rejects.toThrow('fake insert failure');

    expect(pool.calls[0]?.sql).toBe('BEGIN');
    expect(pool.calls.at(-1)?.sql).toBe('ROLLBACK');
    expect(pool.calls.some((call) => call.sql === 'COMMIT')).toBe(false);
  });
});

interface QueryCall {
  sql: string;
  params?: unknown[];
}

class FakePool {
  readonly calls: QueryCall[] = [];

  constructor(private readonly options: { failOnSqlPrefix?: string } = {}) {}

  async query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> {
    this.calls.push(params ? { sql, params } : { sql });
    if (this.options.failOnSqlPrefix && sql.startsWith(this.options.failOnSqlPrefix)) {
      throw new Error('fake insert failure');
    }
    return { rows: [] };
  }

  async end(): Promise<void> {
    return undefined;
  }
}

function createSnapshot(): StoreSnapshot {
  const store = new InMemorySoulStore();
  const user = store.createUser('user-a@example.test');
  const persona = store.createPersona({
    userId: user.id,
    displayName: 'Father',
    relationship: 'daughter',
    type: 'DECEASED',
  });
  store.createSoulVersion({
    userId: user.id,
    personaId: persona.id,
    kernelJson: { affectModel: { humorLevel: 'low' } },
  });
  store.addMemory({
    userId: user.id,
    personaId: persona.id,
    type: 'DESCRIPTION',
    content: 'private memory text',
    confidence: 1,
    enabledForSoul: true,
  });
  store.addConversation({
    userId: user.id,
    personaId: persona.id,
    role: 'USER',
    content: 'private chat text',
  });
  store.sealSoul({ userId: user.id, personaId: persona.id });
  store.activateNode({ userId: user.id, personaId: persona.id }, 'wedding');
  store.storeCredential(user.id, 'user-a@example.test', 'hash-a');
  store.recordOpsAuditEvent({
    action: 'OVERVIEW_READ',
    outcome: 'SUCCESS',
    actor: 'ops:test',
    targetUserIds: [user.id],
    metadata: { path: '/api/ops/overview' },
  });
  return store.serialize();
}
