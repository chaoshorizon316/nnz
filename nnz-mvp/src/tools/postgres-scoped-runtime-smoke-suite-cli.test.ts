import { describe, expect, it } from 'vitest';

import {
  runScopedRuntimeSmokeSuiteCommand,
  type ScopedRuntimeSmokeSuiteCliDeps,
} from './postgres-scoped-runtime-smoke-suite-cli';

describe('Postgres scoped runtime smoke suite CLI', () => {
  it('requires explicit suite confirmation before running any stage', async () => {
    const calls: string[] = [];

    const result = await runScopedRuntimeSmokeSuiteCommand(
      ['--database-url-env', 'NNZ_POSTGRES_SCOPED_RUNTIME_URL'],
      deps({
        env: { NNZ_POSTGRES_SCOPED_RUNTIME_URL: 'postgres://scoped-runtime-secret' },
        calls,
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('RUN_POSTGRES_SCOPED_RUNTIME_SMOKE_SUITE');
    expect(result.stderr).not.toContain('scoped-runtime-secret');
    expect(calls).toEqual([]);
  });

  it('refuses DATABASE_URL and avoids printing secret values', async () => {
    const calls: string[] = [];

    const result = await runScopedRuntimeSmokeSuiteCommand(
      [
        '--database-url-env',
        'DATABASE_URL',
        '--confirm',
        'RUN_POSTGRES_SCOPED_RUNTIME_SMOKE_SUITE',
      ],
      deps({
        env: {
          DATABASE_URL: 'postgres://prod-secret',
          NNZ_POSTGRES_SCOPED_RUNTIME_URL: 'postgres://scoped-runtime-secret',
        },
        calls,
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('NNZ_POSTGRES_SCOPED_RUNTIME_URL');
    expect(result.stderr).toContain('DATABASE_URL');
    expect(result.stderr).not.toContain('prod-secret');
    expect(result.stderr).not.toContain('scoped-runtime-secret');
    expect(calls).toEqual([]);
  });

  it('requires the scoped runtime database env to be set', async () => {
    const result = await runScopedRuntimeSmokeSuiteCommand(
      [
        '--database-url-env',
        'NNZ_POSTGRES_SCOPED_RUNTIME_URL',
        '--confirm',
        'RUN_POSTGRES_SCOPED_RUNTIME_SMOKE_SUITE',
      ],
      deps({ env: {} }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('NNZ_POSTGRES_SCOPED_RUNTIME_URL is not set');
  });

  it('refuses when the scoped runtime env value matches a production database alias', async () => {
    const calls: string[] = [];

    const result = await runScopedRuntimeSmokeSuiteCommand(
      [
        '--database-url-env',
        'NNZ_POSTGRES_SCOPED_RUNTIME_URL',
        '--confirm',
        'RUN_POSTGRES_SCOPED_RUNTIME_SMOKE_SUITE',
      ],
      deps({
        env: {
          DATABASE_URL: 'postgres://shared-secret',
          NNZ_POSTGRES_SCOPED_RUNTIME_URL: ' postgres://shared-secret ',
        },
        calls,
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('must not match DATABASE_URL');
    expect(result.stderr).not.toContain('shared-secret');
    expect(calls).toEqual([]);
  });

  it('runs direct smoke, build, then HTTP smoke with translated safe args', async () => {
    const calls: string[] = [];
    const directArgs: string[][] = [];
    const httpArgs: string[][] = [];

    const result = await runScopedRuntimeSmokeSuiteCommand(
      [
        '--database-url-env',
        'NNZ_POSTGRES_SCOPED_RUNTIME_URL',
        '--confirm',
        'RUN_POSTGRES_SCOPED_RUNTIME_SMOKE_SUITE',
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
        env: { NNZ_POSTGRES_SCOPED_RUNTIME_URL: 'postgres://scoped-runtime-secret' },
        calls,
        directArgs,
        httpArgs,
      }),
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(calls).toEqual(['direct', 'build', 'http']);
    expect(directArgs).toEqual([[
      '--database-url-env',
      'NNZ_POSTGRES_SCOPED_RUNTIME_URL',
      '--confirm',
      'RUN_POSTGRES_SCOPED_RUNTIME_SMOKE',
    ]]);
    expect(httpArgs).toEqual([[
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
    ]]);
    expect(result.stdout).toContain('Postgres scoped runtime smoke suite');
    expect(result.stdout).toContain('directRuntimeAdapterSmoke: yes');
    expect(result.stdout).toContain('demoBuild: yes');
    expect(result.stdout).toContain('httpApiSmoke: yes');
    expect(result.stdout).not.toContain('scoped-runtime-secret');
  });

  it('can load the scoped runtime database env from an explicit env file', async () => {
    const calls: string[] = [];
    const directArgs: string[][] = [];

    const result = await runScopedRuntimeSmokeSuiteCommand(
      [
        '--env-file',
        '.env.release',
        '--database-url-env',
        'NNZ_POSTGRES_SCOPED_RUNTIME_URL',
        '--confirm',
        'RUN_POSTGRES_SCOPED_RUNTIME_SMOKE_SUITE',
        '--skip-build',
      ],
      deps({
        env: {},
        calls,
        directArgs,
        files: {
          '/repo/.env.release': 'NNZ_POSTGRES_SCOPED_RUNTIME_URL=postgres://runtime-secret\n',
        },
      }),
    );

    expect(result.exitCode).toBe(0);
    expect(calls).toEqual(['direct', 'http']);
    expect(directArgs[0]).toContain('NNZ_POSTGRES_SCOPED_RUNTIME_URL');
    expect(result.stdout).not.toContain('.env.release');
    expect(result.stdout).not.toContain('runtime-secret');
  });

  it('can skip build while still running both smoke stages', async () => {
    const calls: string[] = [];

    const result = await runScopedRuntimeSmokeSuiteCommand(
      [
        '--database-url-env',
        'NNZ_POSTGRES_SCOPED_RUNTIME_URL',
        '--confirm',
        'RUN_POSTGRES_SCOPED_RUNTIME_SMOKE_SUITE',
        '--skip-build',
      ],
      deps({
        env: { NNZ_POSTGRES_SCOPED_RUNTIME_URL: 'postgres://scoped-runtime-secret' },
        calls,
      }),
    );

    expect(result.exitCode).toBe(0);
    expect(calls).toEqual(['direct', 'http']);
    expect(result.stdout).toContain('demoBuild: skipped');
  });

  it('validates numeric options before running', async () => {
    const calls: string[] = [];

    const result = await runScopedRuntimeSmokeSuiteCommand(
      [
        '--database-url-env',
        'NNZ_POSTGRES_SCOPED_RUNTIME_URL',
        '--confirm',
        'RUN_POSTGRES_SCOPED_RUNTIME_SMOKE_SUITE',
        '--timeout-ms',
        '999',
      ],
      deps({
        env: { NNZ_POSTGRES_SCOPED_RUNTIME_URL: 'postgres://scoped-runtime-secret' },
        calls,
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('--timeout-ms must be an integer');
    expect(calls).toEqual([]);
  });

  it('stops before build and HTTP smoke when direct smoke fails', async () => {
    const calls: string[] = [];

    const result = await runScopedRuntimeSmokeSuiteCommand(
      [
        '--database-url-env',
        'NNZ_POSTGRES_SCOPED_RUNTIME_URL',
        '--confirm',
        'RUN_POSTGRES_SCOPED_RUNTIME_SMOKE_SUITE',
      ],
      deps({
        env: { NNZ_POSTGRES_SCOPED_RUNTIME_URL: 'postgres://scoped-runtime-secret' },
        calls,
        directResult: {
          exitCode: 1,
          stdout: '',
          stderr: 'raw direct failure with secret row payload',
        },
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('direct runtime adapter smoke');
    expect(result.stderr).not.toContain('raw direct failure');
    expect(result.stderr).not.toContain('secret row payload');
    expect(result.stderr).not.toContain('scoped-runtime-secret');
    expect(calls).toEqual(['direct']);
  });

  it('stops before HTTP smoke when build fails', async () => {
    const calls: string[] = [];

    const result = await runScopedRuntimeSmokeSuiteCommand(
      [
        '--database-url-env',
        'NNZ_POSTGRES_SCOPED_RUNTIME_URL',
        '--confirm',
        'RUN_POSTGRES_SCOPED_RUNTIME_SMOKE_SUITE',
      ],
      deps({
        env: { NNZ_POSTGRES_SCOPED_RUNTIME_URL: 'postgres://scoped-runtime-secret' },
        calls,
        buildError: new Error('raw build output with secret'),
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('demo build');
    expect(result.stderr).not.toContain('raw build output');
    expect(result.stderr).not.toContain('secret');
    expect(calls).toEqual(['direct', 'build']);
  });

  it('does not print raw HTTP smoke failure output', async () => {
    const calls: string[] = [];

    const result = await runScopedRuntimeSmokeSuiteCommand(
      [
        '--database-url-env',
        'NNZ_POSTGRES_SCOPED_RUNTIME_URL',
        '--confirm',
        'RUN_POSTGRES_SCOPED_RUNTIME_SMOKE_SUITE',
      ],
      deps({
        env: { NNZ_POSTGRES_SCOPED_RUNTIME_URL: 'postgres://scoped-runtime-secret' },
        calls,
        httpResult: {
          exitCode: 1,
          stdout: '',
          stderr: 'raw http server log with bearer-token and raw-secret-password',
        },
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('HTTP /api/me smoke');
    expect(result.stderr).not.toContain('raw http server log');
    expect(result.stderr).not.toContain('bearer-token');
    expect(result.stderr).not.toContain('raw-secret-password');
    expect(result.stderr).not.toContain('scoped-runtime-secret');
    expect(calls).toEqual(['direct', 'build', 'http']);
  });
});

function deps(options: {
  env: Record<string, string | undefined>;
  calls?: string[];
  directArgs?: string[][];
  httpArgs?: string[][];
  directResult?: { exitCode: number; stdout: string; stderr: string };
  httpResult?: { exitCode: number; stdout: string; stderr: string };
  buildError?: unknown;
  files?: Record<string, string>;
}): ScopedRuntimeSmokeSuiteCliDeps {
  return {
    env: options.env,
    runDirectSmoke: async (args) => {
      options.calls?.push('direct');
      options.directArgs?.push(args);
      return options.directResult ?? { exitCode: 0, stdout: 'direct ok', stderr: '' };
    },
    buildDemo: async () => {
      options.calls?.push('build');
      if (options.buildError) throw options.buildError;
    },
    runHttpSmoke: async (args) => {
      options.calls?.push('http');
      options.httpArgs?.push(args);
      return options.httpResult ?? { exitCode: 0, stdout: 'http ok', stderr: '' };
    },
    cwd: '/repo',
    readTextFile: (path) => {
      const text = options.files?.[path];
      if (text === undefined) throw new Error('missing test file');
      return text;
    },
  };
}
