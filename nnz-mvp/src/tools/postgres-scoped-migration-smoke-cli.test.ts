import { describe, expect, it } from 'vitest';

import {
  runMigrationSmokeCommand,
  type MigrationSmokeCliDeps,
  type PostgresScopedMigrationSmokePool,
  type PostgresScopedMigrationSmokeResult,
} from './postgres-scoped-migration-smoke-cli';

describe('Postgres scoped migration smoke CLI', () => {
  it('requires explicit smoke confirmation before creating a pool', async () => {
    const poolUrls: string[] = [];

    const result = await runMigrationSmokeCommand(
      ['--database-url-env', 'NNZ_POSTGRES_INTEGRATION_URL'],
      deps({
        env: { NNZ_POSTGRES_INTEGRATION_URL: 'postgres://disposable-secret' },
        poolUrls,
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('RUN_POSTGRES_SCOPED_MIGRATION_SMOKE');
    expect(result.stderr).not.toContain('disposable-secret');
    expect(poolUrls).toEqual([]);
  });

  it('refuses DATABASE_URL and does not print secret values', async () => {
    const poolUrls: string[] = [];

    const result = await runMigrationSmokeCommand(
      [
        '--database-url-env',
        'DATABASE_URL',
        '--confirm',
        'RUN_POSTGRES_SCOPED_MIGRATION_SMOKE',
      ],
      deps({
        env: {
          DATABASE_URL: 'postgres://prod-secret',
          NNZ_POSTGRES_INTEGRATION_URL: 'postgres://disposable-secret',
        },
        poolUrls,
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('NNZ_POSTGRES_INTEGRATION_URL');
    expect(result.stderr).toContain('DATABASE_URL');
    expect(result.stderr).not.toContain('prod-secret');
    expect(result.stderr).not.toContain('disposable-secret');
    expect(poolUrls).toEqual([]);
  });

  it('requires the disposable database env to be set', async () => {
    const result = await runMigrationSmokeCommand(
      [
        '--database-url-env',
        'NNZ_POSTGRES_INTEGRATION_URL',
        '--confirm',
        'RUN_POSTGRES_SCOPED_MIGRATION_SMOKE',
      ],
      deps({ env: {} }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('NNZ_POSTGRES_INTEGRATION_URL is not set');
  });

  it('runs injected smoke with the allowed env and prints only sanitized checks', async () => {
    const poolUrls: string[] = [];
    const runSmokePools: PostgresScopedMigrationSmokePool[] = [];

    const result = await runMigrationSmokeCommand(
      [
        '--database-url-env',
        'NNZ_POSTGRES_INTEGRATION_URL',
        '--confirm',
        'RUN_POSTGRES_SCOPED_MIGRATION_SMOKE',
      ],
      deps({
        env: {
          DATABASE_URL: 'postgres://prod-secret',
          NNZ_POSTGRES_INTEGRATION_URL: 'postgres://disposable-secret',
        },
        poolUrls,
        runSmokePools,
      }),
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(poolUrls).toEqual(['postgres://disposable-secret']);
    expect(runSmokePools).toHaveLength(1);
    expect(result.stdout).toContain('Postgres scoped migration disposable smoke');
    expect(result.stdout).toContain('crossScopeRejected: yes');
    expect(result.stdout).toContain('cleanupAttempted: yes');
    expect(result.stdout).not.toContain('prod-secret');
    expect(result.stdout).not.toContain('disposable-secret');
    expect(result.stdout).not.toContain('A scoped memory');
    expect(result.stdout).not.toContain('node conversation');
    expect(result.stdout).not.toContain('hash-');
  });

  it('does not print raw database error details from smoke failures', async () => {
    const result = await runMigrationSmokeCommand(
      [
        '--database-url-env',
        'NNZ_POSTGRES_INTEGRATION_URL',
        '--confirm',
        'RUN_POSTGRES_SCOPED_MIGRATION_SMOKE',
      ],
      deps({
        env: { NNZ_POSTGRES_INTEGRATION_URL: 'postgres://disposable-secret' },
        smokeError: Object.assign(new Error('raw sql INSERT secret row payload'), { code: '23505' }),
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('errorCode=23505');
    expect(result.stderr).not.toContain('raw sql');
    expect(result.stderr).not.toContain('secret row payload');
    expect(result.stderr).not.toContain('disposable-secret');
  });
});

function deps(options: {
  env: Record<string, string | undefined>;
  poolUrls?: string[];
  runSmokePools?: PostgresScopedMigrationSmokePool[];
  smokeError?: unknown;
}): MigrationSmokeCliDeps {
  return {
    env: options.env,
    createPool: (connectionString) => {
      options.poolUrls?.push(connectionString);
      return new FakePool();
    },
    runSmoke: async (pool) => {
      options.runSmokePools?.push(pool);
      if (options.smokeError) throw options.smokeError;
      return createSmokeResult();
    },
  };
}

class FakePool {
  async query<T = unknown>(): Promise<{ rows: T[] }> {
    return { rows: [] };
  }

  async connect(): Promise<never> {
    throw new Error('fake pool should not connect in CLI tests');
  }

  async end(): Promise<void> {
    return undefined;
  }
}

function createSmokeResult(): PostgresScopedMigrationSmokeResult {
  return {
    kind: 'postgres-scoped-migration-smoke',
    committed: true,
    totalRows: 11,
    checks: {
      idempotentExecution: true,
      repositoryReadback: true,
      crossScopeRejected: true,
      cascadeDelete: true,
      siblingScopePreserved: true,
      auditRowWritten: true,
      cleanupAttempted: true,
    },
  };
}
