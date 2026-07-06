import { describe, expect, it } from 'vitest';

import {
  buildScopedRuntimeHttpSmokeChildEnv,
  runScopedRuntimeHttpSmokeCommand,
  type ScopedRuntimeHttpSmokeCliDeps,
  type ScopedRuntimeHttpSmokeConfig,
  type ScopedRuntimeHttpSmokeResult,
} from './postgres-scoped-runtime-http-smoke-cli';

describe('Postgres scoped runtime HTTP smoke CLI', () => {
  it('requires explicit HTTP smoke confirmation before running', async () => {
    const configs: ScopedRuntimeHttpSmokeConfig[] = [];

    const result = await runScopedRuntimeHttpSmokeCommand(
      ['--database-url-env', 'NNZ_POSTGRES_SCOPED_RUNTIME_URL'],
      deps({
        env: { NNZ_POSTGRES_SCOPED_RUNTIME_URL: 'postgres://scoped-runtime-secret' },
        configs,
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('RUN_POSTGRES_SCOPED_RUNTIME_HTTP_SMOKE');
    expect(result.stderr).not.toContain('scoped-runtime-secret');
    expect(configs).toEqual([]);
  });

  it('refuses DATABASE_URL and does not print secret values', async () => {
    const configs: ScopedRuntimeHttpSmokeConfig[] = [];

    const result = await runScopedRuntimeHttpSmokeCommand(
      [
        '--database-url-env',
        'DATABASE_URL',
        '--confirm',
        'RUN_POSTGRES_SCOPED_RUNTIME_HTTP_SMOKE',
      ],
      deps({
        env: {
          DATABASE_URL: 'postgres://prod-secret',
          NNZ_POSTGRES_SCOPED_RUNTIME_URL: 'postgres://scoped-runtime-secret',
        },
        configs,
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('NNZ_POSTGRES_SCOPED_RUNTIME_URL');
    expect(result.stderr).toContain('DATABASE_URL');
    expect(result.stderr).not.toContain('prod-secret');
    expect(result.stderr).not.toContain('scoped-runtime-secret');
    expect(configs).toEqual([]);
  });

  it('requires the scoped runtime database env to be set', async () => {
    const result = await runScopedRuntimeHttpSmokeCommand(
      [
        '--database-url-env',
        'NNZ_POSTGRES_SCOPED_RUNTIME_URL',
        '--confirm',
        'RUN_POSTGRES_SCOPED_RUNTIME_HTTP_SMOKE',
      ],
      deps({ env: {} }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('NNZ_POSTGRES_SCOPED_RUNTIME_URL is not set');
  });

  it('refuses when the scoped runtime env value matches a production database alias', async () => {
    const configs: ScopedRuntimeHttpSmokeConfig[] = [];

    const result = await runScopedRuntimeHttpSmokeCommand(
      [
        '--database-url-env',
        'NNZ_POSTGRES_SCOPED_RUNTIME_URL',
        '--confirm',
        'RUN_POSTGRES_SCOPED_RUNTIME_HTTP_SMOKE',
      ],
      deps({
        env: {
          DATABASE_URL: 'postgres://shared-secret',
          NNZ_POSTGRES_SCOPED_RUNTIME_URL: ' postgres://shared-secret ',
        },
        configs,
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('must not match DATABASE_URL');
    expect(result.stderr).not.toContain('shared-secret');
    expect(configs).toEqual([]);
  });

  it('passes sanitized config to the injected HTTP smoke runner', async () => {
    const configs: ScopedRuntimeHttpSmokeConfig[] = [];

    const result = await runScopedRuntimeHttpSmokeCommand(
      [
        '--database-url-env',
        'NNZ_POSTGRES_SCOPED_RUNTIME_URL',
        '--confirm',
        'RUN_POSTGRES_SCOPED_RUNTIME_HTTP_SMOKE',
        '--host',
        '127.0.0.1',
        '--port',
        '3999',
        '--server-entry',
        'dist-cjs/demo-server.js',
        '--timeout-ms',
        '2000',
      ],
      deps({
        env: {
          DATABASE_URL: 'postgres://prod-secret',
          NNZ_POSTGRES_SCOPED_RUNTIME_URL: 'postgres://scoped-runtime-secret',
        },
        configs,
      }),
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(configs).toHaveLength(1);
    expect(configs[0]).toMatchObject({
      databaseUrl: 'postgres://scoped-runtime-secret',
      host: '127.0.0.1',
      port: 3999,
      serverEntry: 'dist-cjs/demo-server.js',
      timeoutMs: 2000,
    });
    expect(result.stdout).toContain('Postgres scoped runtime HTTP disposable smoke');
    expect(result.stdout).toContain('healthzScopedPostgres: yes');
    expect(result.stdout).toContain('exportRedactsCredentialHash: yes');
    expect(result.stdout).toContain('deleteCurrentUser: yes');
    expect(result.stdout).not.toContain('prod-secret');
    expect(result.stdout).not.toContain('scoped-runtime-secret');
    expect(result.stdout).not.toContain('private http smoke memory');
    expect(result.stdout).not.toContain('private http smoke chat');
    expect(result.stdout).not.toContain('SmokePass');
  });

  it('validates numeric options before running', async () => {
    const configs: ScopedRuntimeHttpSmokeConfig[] = [];

    const result = await runScopedRuntimeHttpSmokeCommand(
      [
        '--database-url-env',
        'NNZ_POSTGRES_SCOPED_RUNTIME_URL',
        '--confirm',
        'RUN_POSTGRES_SCOPED_RUNTIME_HTTP_SMOKE',
        '--port',
        '99999',
      ],
      deps({
        env: { NNZ_POSTGRES_SCOPED_RUNTIME_URL: 'postgres://scoped-runtime-secret' },
        configs,
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('--port must be an integer');
    expect(configs).toEqual([]);
  });

  it('does not print raw server or HTTP details from smoke failures', async () => {
    const result = await runScopedRuntimeHttpSmokeCommand(
      [
        '--database-url-env',
        'NNZ_POSTGRES_SCOPED_RUNTIME_URL',
        '--confirm',
        'RUN_POSTGRES_SCOPED_RUNTIME_HTTP_SMOKE',
      ],
      deps({
        env: { NNZ_POSTGRES_SCOPED_RUNTIME_URL: 'postgres://scoped-runtime-secret' },
        smokeError: Object.assign(new Error('raw server log with bearer-secret password and memory'), { status: 500 }),
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('httpStatus=500');
    expect(result.stderr).not.toContain('raw server log');
    expect(result.stderr).not.toContain('bearer-secret');
    expect(result.stderr).not.toContain('scoped-runtime-secret');
  });

  it('builds a scoped child env without snapshot persistence or LLM provider values', () => {
    const childEnv = buildScopedRuntimeHttpSmokeChildEnv({
      databaseUrl: 'postgres://scoped-runtime-secret',
      host: '127.0.0.1',
      port: 3147,
      serverEntry: 'dist-cjs/demo-server.js',
      timeoutMs: 2000,
      env: {
        DATABASE_URL: 'postgres://prod-secret',
        NNZ_POSTGRES_URL: 'postgres://other-prod-secret',
        NNZ_DB_PATH: './prod.sqlite',
        NNZ_LLM_API_KEY: 'llm-secret',
        NNZ_LLM_BASE_URL: 'https://llm.example.test',
        NNZ_LLM_MODEL: 'example-model',
        NNZ_POSTGRES_SCOPED_RUNTIME_URL: 'postgres://scoped-runtime-secret',
      },
    });

    expect(childEnv.NNZ_RUNTIME_PERSISTENCE_MODE).toBe('scoped');
    expect(childEnv.NNZ_POSTGRES_SCOPED_RUNTIME_URL).toBe('postgres://scoped-runtime-secret');
    expect(childEnv.HOST).toBe('127.0.0.1');
    expect(childEnv.PORT).toBe('3147');
    expect(childEnv.DATABASE_URL).toBe('');
    expect(childEnv.NNZ_POSTGRES_URL).toBe('');
    expect(childEnv.NNZ_DB_PATH).toBe('');
    expect(childEnv.NNZ_LLM_API_KEY).toBe('');
    expect(childEnv.NNZ_LLM_BASE_URL).toBe('');
    expect(childEnv.NNZ_LLM_MODEL).toBe('');
  });
});

function deps(options: {
  env: Record<string, string | undefined>;
  configs?: ScopedRuntimeHttpSmokeConfig[];
  smokeError?: unknown;
}): ScopedRuntimeHttpSmokeCliDeps {
  return {
    env: options.env,
    runSmoke: async (config) => {
      options.configs?.push(config);
      if (options.smokeError) throw options.smokeError;
      return createSmokeResult();
    },
  };
}

function createSmokeResult(): ScopedRuntimeHttpSmokeResult {
  return {
    kind: 'postgres-scoped-runtime-http-smoke',
    fixtureUsers: 1,
    checks: {
      serverStarted: true,
      healthzScopedPostgres: true,
      registerLogin: true,
      personaCreate: true,
      chatHistory: true,
      covenantTransitions: true,
      exportContainsOwnData: true,
      exportRedactsCredentialHash: true,
      deleteCurrentUser: true,
      cleanupAttempted: true,
    },
  };
}
