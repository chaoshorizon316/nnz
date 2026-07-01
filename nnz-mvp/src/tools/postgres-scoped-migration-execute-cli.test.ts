import { describe, expect, it } from 'vitest';

import type { StoreSnapshot } from '../domain/persistence';
import type {
  ExecutePostgresScopedMigrationOptions,
  ExecutePostgresScopedMigrationResult,
  PostgresScopedMigrationPool,
} from '../domain/postgres-scoped-migration-executor';
import { EXECUTE_POSTGRES_SCOPED_MIGRATION_CONFIRM } from '../domain/postgres-scoped-migration-executor';
import { InMemorySoulStore } from '../domain/soul-store';
import { runMigrationExecuteCommand, type MigrationExecuteCliDeps } from './postgres-scoped-migration-execute-cli';

describe('Postgres scoped migration execute CLI', () => {
  it('defaults to protected dry-run without creating a pool or printing private content', async () => {
    const snapshot = createSnapshot();
    const executeCalls: unknown[] = [];
    const poolUrls: string[] = [];

    const result = await runMigrationExecuteCommand(
      ['--snapshot', '/tmp/snapshot.json'],
      deps({
        snapshot,
        env: {
          DATABASE_URL: 'postgres://prod-secret',
          NNZ_POSTGRES_INTEGRATION_URL: 'postgres://disposable-secret',
        },
        poolUrls,
        executeCalls,
      }),
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(poolUrls).toEqual([]);
    expect(executeCalls).toEqual([]);
    expect(result.stdout).toContain('mode: dry-run');
    expect(result.stdout).toContain('databaseUrlEnv: none');
    expect(result.stdout).toContain('executed: no');
    expect(result.stdout).not.toContain('private memory text');
    expect(result.stdout).not.toContain('private chat text');
    expect(result.stdout).not.toContain('prod-secret');
    expect(result.stdout).not.toContain('disposable-secret');
  });

  it('refuses execution when DATABASE_URL is requested', async () => {
    const result = await runMigrationExecuteCommand(
      [
        '--snapshot',
        '/tmp/snapshot.json',
        '--execute',
        '--database-url-env',
        'DATABASE_URL',
        '--confirm',
        EXECUTE_POSTGRES_SCOPED_MIGRATION_CONFIRM,
      ],
      deps({
        snapshot: createSnapshot(),
        env: {
          DATABASE_URL: 'postgres://prod-secret',
          NNZ_POSTGRES_INTEGRATION_URL: 'postgres://disposable-secret',
        },
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('NNZ_POSTGRES_INTEGRATION_URL');
    expect(result.stderr).toContain('DATABASE_URL');
    expect(result.stderr).not.toContain('prod-secret');
    expect(result.stderr).not.toContain('disposable-secret');
  });

  it('requires explicit confirmation before execution', async () => {
    const result = await runMigrationExecuteCommand(
      [
        '--snapshot',
        '/tmp/snapshot.json',
        '--execute',
        '--database-url-env',
        'NNZ_POSTGRES_INTEGRATION_URL',
      ],
      deps({
        snapshot: createSnapshot(),
        env: { NNZ_POSTGRES_INTEGRATION_URL: 'postgres://disposable-secret' },
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(EXECUTE_POSTGRES_SCOPED_MIGRATION_CONFIRM);
    expect(result.stderr).not.toContain('disposable-secret');
  });

  it('refuses execution when the snapshot has blocking errors', async () => {
    const snapshot = createSnapshot();
    snapshot.personas[0]!.userId = 'missing-user';
    const executeCalls: unknown[] = [];

    const result = await runMigrationExecuteCommand(
      [
        '--snapshot',
        '/tmp/bad-snapshot.json',
        '--execute',
        '--database-url-env',
        'NNZ_POSTGRES_INTEGRATION_URL',
        '--confirm',
        EXECUTE_POSTGRES_SCOPED_MIGRATION_CONFIRM,
      ],
      deps({
        snapshot,
        env: { NNZ_POSTGRES_INTEGRATION_URL: 'postgres://disposable-secret' },
        executeCalls,
      }),
    );

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain('ready: no');
    expect(result.stderr).toContain('blocking errors');
    expect(executeCalls).toEqual([]);
  });

  it('refuses execution with warnings unless allow-warnings is explicit', async () => {
    const snapshot = createSnapshot();
    snapshot.opsAuditEvents.push({
      id: 'audit-missing-target',
      action: 'OVERVIEW_READ',
      outcome: 'SUCCESS',
      actor: 'ops:test',
      targetUserIds: ['missing-user'],
      metadata: { secret: 'private audit metadata' },
      createdAt: new Date().toISOString(),
    });
    const executeCalls: unknown[] = [];

    const result = await runMigrationExecuteCommand(
      [
        '--snapshot',
        '/tmp/warning-snapshot.json',
        '--execute',
        '--database-url-env',
        'NNZ_POSTGRES_INTEGRATION_URL',
        '--confirm',
        EXECUTE_POSTGRES_SCOPED_MIGRATION_CONFIRM,
      ],
      deps({
        snapshot,
        env: { NNZ_POSTGRES_INTEGRATION_URL: 'postgres://disposable-secret' },
        executeCalls,
      }),
    );

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain('warningCount: 1');
    expect(result.stderr).toContain('warnings are present');
    expect(result.stdout).not.toContain('private audit metadata');
    expect(executeCalls).toEqual([]);
  });

  it('executes against the allowed env only and writes a sanitized report', async () => {
    const snapshot = createSnapshot();
    const poolUrls: string[] = [];
    const executeCalls: Array<{
      pool: PostgresScopedMigrationPool;
      options: ExecutePostgresScopedMigrationOptions;
    }> = [];
    const written = new Map<string, string>();

    const result = await runMigrationExecuteCommand(
      [
        '--snapshot',
        '/tmp/snapshot.json',
        '--execute',
        '--database-url-env',
        'NNZ_POSTGRES_INTEGRATION_URL',
        '--confirm',
        EXECUTE_POSTGRES_SCOPED_MIGRATION_CONFIRM,
        '--report',
        '/tmp/report.json',
        '--migrated-at',
        '2026-07-01T00:00:00.000Z',
      ],
      deps({
        snapshot,
        env: {
          DATABASE_URL: 'postgres://prod-secret',
          NNZ_POSTGRES_INTEGRATION_URL: 'postgres://disposable-secret',
        },
        poolUrls,
        executeCalls,
        written,
      }),
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(poolUrls).toEqual(['postgres://disposable-secret']);
    expect(executeCalls).toHaveLength(1);
    expect(executeCalls[0]!.options).toMatchObject({
      confirm: EXECUTE_POSTGRES_SCOPED_MIGRATION_CONFIRM,
      ensureSchema: true,
      migratedAt: '2026-07-01T00:00:00.000Z',
    });
    expect(result.stdout).toContain('mode: execute');
    expect(result.stdout).toContain('databaseUrlEnv: NNZ_POSTGRES_INTEGRATION_URL');
    expect(result.stdout).toContain('executed: yes');
    expect(result.stdout).not.toContain('private memory text');
    expect(result.stdout).not.toContain('private chat text');
    expect(result.stdout).not.toContain('prod-secret');
    expect(result.stdout).not.toContain('disposable-secret');

    const report = written.get('/tmp/report.json') ?? '';
    expect(report).toContain('"executed": true');
    expect(report).toContain('"databaseUrlEnv": "NNZ_POSTGRES_INTEGRATION_URL"');
    expect(report).not.toContain('"rows"');
    expect(report).not.toContain('private memory text');
    expect(report).not.toContain('private chat text');
    expect(report).not.toContain('prod-secret');
    expect(report).not.toContain('disposable-secret');
  });
});

function deps(options: {
  snapshot: StoreSnapshot;
  env?: Record<string, string | undefined>;
  poolUrls?: string[];
  executeCalls?: unknown[];
  written?: Map<string, string>;
}): MigrationExecuteCliDeps {
  const poolUrls = options.poolUrls ?? [];
  const executeCalls = options.executeCalls ?? [];
  return {
    env: options.env ?? {},
    readTextFile: () => JSON.stringify(options.snapshot),
    writeTextFile: (path, text) => {
      options.written?.set(path, text);
    },
    createPool: (connectionString) => {
      poolUrls.push(connectionString);
      return new FakePool();
    },
    executeMigration: async (pool, _snapshot, migrationOptions) => {
      executeCalls.push({ pool, options: migrationOptions });
      return {
        plan: {} as never,
        tables: [
          { table: 'nnz_users', count: 1 },
          { table: 'nnz_personas', count: 1 },
        ],
        totalRows: 2,
        committed: true,
      };
    },
  };
}

class FakePool {
  endCount = 0;

  async query<T = unknown>(): Promise<{ rows: T[] }> {
    return { rows: [] };
  }

  async connect(): Promise<never> {
    throw new Error('fake pool should be handled by injected executeMigration');
  }

  async end(): Promise<void> {
    this.endCount += 1;
  }
}

function createSnapshot(): StoreSnapshot {
  const store = new InMemorySoulStore();
  const user = store.createUser('user@example.test');
  const persona = store.createPersona({
    userId: user.id,
    displayName: 'Father',
    relationship: 'daughter',
    type: 'DECEASED',
  });
  store.createSoulVersion({
    userId: user.id,
    personaId: persona.id,
    kernelJson: { identityCore: { relationship: 'father' } },
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
  return store.serialize();
}
