import { describe, expect, it } from 'vitest';

import type { QueryablePool } from '../domain/postgres-scoped-soul-repository';
import { createPostgresScopedRuntimePersistenceFromPool } from './scoped-runtime-persistence';

describe('scoped runtime persistence', () => {
  it('ensures scoped schema once and exposes a Postgres runtime adapter', async () => {
    const pool = new FakeScopedRuntimePool();
    let schemaCalls = 0;
    const persistence = createPostgresScopedRuntimePersistenceFromPool(pool, async () => {
      schemaCalls += 1;
      await pool.query('CREATE TABLE IF NOT EXISTS nnz_users (id TEXT PRIMARY KEY)');
    });

    await persistence.ensureReady();
    await persistence.ensureReady();
    await persistence.adapter.storeCredential('user_a', 'user@example.test', 'hash-secret');
    const credential = await persistence.adapter.getCredentialByEmail('user@example.test');
    await persistence.close();

    expect(persistence.mode).toBe('scoped-postgres');
    expect(schemaCalls).toBe(1);
    expect(pool.closed).toBe(true);
    expect(pool.calls[0]?.sql).toContain('CREATE TABLE IF NOT EXISTS nnz_users');
    expect(credential).toEqual({
      userId: 'user_a',
      email: 'user@example.test',
      passwordHash: 'hash-secret',
      createdAt: '2026-07-03T00:00:00.000Z',
    });
    expect(JSON.stringify(pool.calls)).not.toContain('postgres://');
  });
});

class FakeScopedRuntimePool implements QueryablePool {
  readonly calls: Array<{ sql: string; params: unknown[] }> = [];
  closed = false;

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

  async end(): Promise<void> {
    this.closed = true;
  }
}
