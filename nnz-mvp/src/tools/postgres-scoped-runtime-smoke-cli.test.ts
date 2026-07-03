import { describe, expect, it } from 'vitest';

import {
  runScopedRuntimeSmokeCommand,
  type PostgresScopedRuntimeSmokePool,
  type PostgresScopedRuntimeSmokeResult,
  type ScopedRuntimeSmokeCliDeps,
} from './postgres-scoped-runtime-smoke-cli';

describe('Postgres scoped runtime smoke CLI', () => {
  it('requires explicit smoke confirmation before creating a pool', async () => {
    const poolUrls: string[] = [];

    const result = await runScopedRuntimeSmokeCommand(
      ['--database-url-env', 'NNZ_POSTGRES_SCOPED_RUNTIME_URL'],
      deps({
        env: { NNZ_POSTGRES_SCOPED_RUNTIME_URL: 'postgres://scoped-runtime-secret' },
        poolUrls,
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('RUN_POSTGRES_SCOPED_RUNTIME_SMOKE');
    expect(result.stderr).not.toContain('scoped-runtime-secret');
    expect(poolUrls).toEqual([]);
  });

  it('refuses DATABASE_URL and does not print secret values', async () => {
    const poolUrls: string[] = [];

    const result = await runScopedRuntimeSmokeCommand(
      [
        '--database-url-env',
        'DATABASE_URL',
        '--confirm',
        'RUN_POSTGRES_SCOPED_RUNTIME_SMOKE',
      ],
      deps({
        env: {
          DATABASE_URL: 'postgres://prod-secret',
          NNZ_POSTGRES_SCOPED_RUNTIME_URL: 'postgres://scoped-runtime-secret',
        },
        poolUrls,
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('NNZ_POSTGRES_SCOPED_RUNTIME_URL');
    expect(result.stderr).toContain('DATABASE_URL');
    expect(result.stderr).not.toContain('prod-secret');
    expect(result.stderr).not.toContain('scoped-runtime-secret');
    expect(poolUrls).toEqual([]);
  });

  it('requires the scoped runtime database env to be set', async () => {
    const result = await runScopedRuntimeSmokeCommand(
      [
        '--database-url-env',
        'NNZ_POSTGRES_SCOPED_RUNTIME_URL',
        '--confirm',
        'RUN_POSTGRES_SCOPED_RUNTIME_SMOKE',
      ],
      deps({ env: {} }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('NNZ_POSTGRES_SCOPED_RUNTIME_URL is not set');
  });

  it('refuses when the scoped runtime env value matches a production database alias', async () => {
    const poolUrls: string[] = [];

    const result = await runScopedRuntimeSmokeCommand(
      [
        '--database-url-env',
        'NNZ_POSTGRES_SCOPED_RUNTIME_URL',
        '--confirm',
        'RUN_POSTGRES_SCOPED_RUNTIME_SMOKE',
      ],
      deps({
        env: {
          NNZ_POSTGRES_URL: 'postgres://shared-secret',
          NNZ_POSTGRES_SCOPED_RUNTIME_URL: ' postgres://shared-secret ',
        },
        poolUrls,
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('must not match NNZ_POSTGRES_URL');
    expect(result.stderr).not.toContain('shared-secret');
    expect(poolUrls).toEqual([]);
  });

  it('runs injected smoke with the allowed env and prints only sanitized checks', async () => {
    const poolUrls: string[] = [];
    const runSmokePools: PostgresScopedRuntimeSmokePool[] = [];

    const result = await runScopedRuntimeSmokeCommand(
      [
        '--database-url-env',
        'NNZ_POSTGRES_SCOPED_RUNTIME_URL',
        '--confirm',
        'RUN_POSTGRES_SCOPED_RUNTIME_SMOKE',
      ],
      deps({
        env: {
          DATABASE_URL: 'postgres://prod-secret',
          NNZ_POSTGRES_SCOPED_RUNTIME_URL: 'postgres://scoped-runtime-secret',
        },
        poolUrls,
        runSmokePools,
      }),
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(poolUrls).toEqual(['postgres://scoped-runtime-secret']);
    expect(runSmokePools).toHaveLength(1);
    expect(result.stdout).toContain('Postgres scoped runtime disposable smoke');
    expect(result.stdout).toContain('runtimeContextReadback: yes');
    expect(result.stdout).toContain('crossScopeRejected: yes');
    expect(result.stdout).toContain('cleanupAttempted: yes');
    expect(result.stdout).not.toContain('prod-secret');
    expect(result.stdout).not.toContain('scoped-runtime-secret');
    expect(result.stdout).not.toContain('runtime scoped memory');
    expect(result.stdout).not.toContain('node scoped chat');
    expect(result.stdout).not.toContain('hash-');
  });

  it('does not print raw database error details from smoke failures', async () => {
    const result = await runScopedRuntimeSmokeCommand(
      [
        '--database-url-env',
        'NNZ_POSTGRES_SCOPED_RUNTIME_URL',
        '--confirm',
        'RUN_POSTGRES_SCOPED_RUNTIME_SMOKE',
      ],
      deps({
        env: { NNZ_POSTGRES_SCOPED_RUNTIME_URL: 'postgres://scoped-runtime-secret' },
        smokeError: Object.assign(new Error('raw sql INSERT secret row payload'), { code: '23505' }),
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('errorCode=23505');
    expect(result.stderr).not.toContain('raw sql');
    expect(result.stderr).not.toContain('secret row payload');
    expect(result.stderr).not.toContain('scoped-runtime-secret');
  });

  it('does not print raw database error details from pool close failures', async () => {
    const result = await runScopedRuntimeSmokeCommand(
      [
        '--database-url-env',
        'NNZ_POSTGRES_SCOPED_RUNTIME_URL',
        '--confirm',
        'RUN_POSTGRES_SCOPED_RUNTIME_SMOKE',
      ],
      deps({
        env: { NNZ_POSTGRES_SCOPED_RUNTIME_URL: 'postgres://scoped-runtime-secret' },
        closeError: new Error('raw close failure with secret details'),
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('Postgres scoped runtime disposable smoke');
    expect(result.stderr).toContain('failed while closing the database pool');
    expect(result.stderr).not.toContain('raw close failure');
    expect(result.stderr).not.toContain('secret details');
    expect(result.stderr).not.toContain('scoped-runtime-secret');
  });
});

function deps(options: {
  env: Record<string, string | undefined>;
  poolUrls?: string[];
  runSmokePools?: PostgresScopedRuntimeSmokePool[];
  smokeError?: unknown;
  closeError?: unknown;
}): ScopedRuntimeSmokeCliDeps {
  return {
    env: options.env,
    createPool: (connectionString) => {
      options.poolUrls?.push(connectionString);
      return new FakePool(options.closeError);
    },
    runSmoke: async (pool) => {
      options.runSmokePools?.push(pool);
      if (options.smokeError) throw options.smokeError;
      return createSmokeResult();
    },
  };
}

class FakePool implements PostgresScopedRuntimeSmokePool {
  constructor(private readonly closeError?: unknown) {}

  async query<T = unknown>(): Promise<{ rows: T[] }> {
    return { rows: [] };
  }

  async end(): Promise<void> {
    if (this.closeError) throw this.closeError;
    return undefined;
  }
}

function createSmokeResult(): PostgresScopedRuntimeSmokeResult {
  return {
    kind: 'postgres-scoped-runtime-smoke',
    fixtureUsers: 2,
    checks: {
      schemaReady: true,
      credentialReadback: true,
      personaReadback: true,
      runtimeContextReadback: true,
      covenantTransitions: true,
      crossScopeRejected: true,
      cascadeDelete: true,
      siblingScopePreserved: true,
      cleanupAttempted: true,
    },
  };
}
