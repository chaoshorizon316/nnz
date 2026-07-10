import { describe, expect, it } from 'vitest';

import {
  runReleasePreflightCommand,
  type ReleasePreflightCliDeps,
} from './release-preflight-cli';

describe('release preflight CLI', () => {
  it('prints usage without checking envs', async () => {
    const result = await runReleasePreflightCommand(['--help'], deps({ env: {} }));

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('npm run release:preflight');
  });

  it('reports missing external inputs without printing secret values', async () => {
    const result = await runReleasePreflightCommand([], deps({
      env: {
        DATABASE_URL: 'postgres://prod-secret',
        NNZ_LLM_API_KEY: 'llm-secret',
      },
    }));

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('overall: blocked');
    expect(result.stdout).toContain('migrationValidationSuite: blocked');
    expect(result.stdout).toContain('snapshotInput: blocked (NNZ_MIGRATION_SNAPSHOT_PATH missing)');
    expect(result.stdout).toContain('NNZ_POSTGRES_INTEGRATION_URL: missing');
    expect(result.stdout).toContain('opsRoleSmoke: blocked');
    expect(result.stdout).toContain('NNZ_OPS_VIEWER_TOKEN: missing');
    expect(result.stdout).toContain('runtimeSmokeSuite: blocked');
    expect(result.stdout).toContain('NNZ_POSTGRES_SCOPED_RUNTIME_URL: missing');
    expect(result.stdout).not.toContain('prod-secret');
    expect(result.stdout).not.toContain('llm-secret');
  });

  it('reports all stages ready when local inputs and envs are present', async () => {
    const result = await runReleasePreflightCommand(
      ['--snapshot', '/private/sensitive/snapshot.json'],
      deps({
        env: {
          NNZ_POSTGRES_INTEGRATION_URL: 'postgres://disposable-secret',
          NNZ_POSTGRES_SCOPED_RUNTIME_URL: 'postgres://runtime-secret',
          NNZ_OPS_VIEWER_TOKEN: 'viewer-secret',
          NNZ_OPS_OPERATOR_TOKEN: 'operator-secret',
          NNZ_OPS_ADMIN_TOKEN: 'admin-secret',
        },
        existingPaths: ['/private/sensitive/snapshot.json'],
      }),
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('overall: ready');
    expect(result.stdout).toContain('snapshotInput: ready (--snapshot)');
    expect(result.stdout).toContain('NNZ_POSTGRES_INTEGRATION_URL: set');
    expect(result.stdout).toContain('NNZ_POSTGRES_SCOPED_RUNTIME_URL: set');
    expect(result.stdout).toContain('NNZ_OPS_ADMIN_TOKEN: set');
    expect(result.stdout).not.toContain('/private/sensitive/snapshot.json');
    expect(result.stdout).not.toContain('disposable-secret');
    expect(result.stdout).not.toContain('runtime-secret');
    expect(result.stdout).not.toContain('viewer-secret');
    expect(result.stdout).not.toContain('operator-secret');
    expect(result.stdout).not.toContain('admin-secret');
  });

  it('detects disposable database alias conflicts without printing URLs', async () => {
    const result = await runReleasePreflightCommand(
      ['--snapshot', 'snapshot.json'],
      deps({
        env: {
          DATABASE_URL: 'postgres://shared-secret',
          NNZ_POSTGRES_INTEGRATION_URL: 'postgres://shared-secret',
          NNZ_POSTGRES_SCOPED_RUNTIME_URL: 'postgres://shared-secret',
          NNZ_OPS_VIEWER_TOKEN: 'viewer-secret',
          NNZ_OPS_OPERATOR_TOKEN: 'operator-secret',
          NNZ_OPS_ADMIN_TOKEN: 'admin-secret',
        },
        existingPaths: ['/repo/snapshot.json'],
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('NNZ_POSTGRES_INTEGRATION_URL: blocked (matches DATABASE_URL)');
    expect(result.stdout).toContain('NNZ_POSTGRES_SCOPED_RUNTIME_URL: blocked (matches DATABASE_URL)');
    expect(result.stdout).not.toContain('shared-secret');
  });

  it('refuses production database env keys for disposable stages', async () => {
    const result = await runReleasePreflightCommand(
      [
        '--snapshot',
        'snapshot.json',
        '--migration-database-url-env',
        'DATABASE_URL',
        '--runtime-database-url-env',
        'NNZ_POSTGRES_URL',
      ],
      deps({
        env: {
          DATABASE_URL: 'postgres://prod-secret',
          NNZ_POSTGRES_URL: 'postgres://prod-secret-2',
          NNZ_OPS_VIEWER_TOKEN: 'viewer-secret',
          NNZ_OPS_OPERATOR_TOKEN: 'operator-secret',
          NNZ_OPS_ADMIN_TOKEN: 'admin-secret',
        },
        existingPaths: ['/repo/snapshot.json'],
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('migration database: blocked (DATABASE_URL is a production database env key)');
    expect(result.stdout).toContain('scoped runtime database: blocked (NNZ_POSTGRES_URL is a production database env key)');
    expect(result.stdout).not.toContain('prod-secret');
  });

  it('supports custom env keys and validates ops base URL', async () => {
    const result = await runReleasePreflightCommand(
      [
        '--snapshot-env',
        'LOCAL_SNAPSHOT_PATH',
        '--migration-database-url-env',
        'LOCAL_MIGRATION_DB_URL',
        '--runtime-database-url-env',
        'LOCAL_RUNTIME_DB_URL',
        '--viewer-token-env',
        'LOCAL_VIEWER_TOKEN',
        '--operator-token-env',
        'LOCAL_OPERATOR_TOKEN',
        '--admin-token-env',
        'LOCAL_ADMIN_TOKEN',
        '--ops-base-url',
        'ftp://not-http.example',
      ],
      deps({
        env: {
          LOCAL_SNAPSHOT_PATH: 'local.sqlite',
          LOCAL_MIGRATION_DB_URL: 'postgres://disposable-secret',
          LOCAL_RUNTIME_DB_URL: 'postgres://runtime-secret',
          LOCAL_VIEWER_TOKEN: 'viewer-secret',
          LOCAL_OPERATOR_TOKEN: 'operator-secret',
          LOCAL_ADMIN_TOKEN: 'admin-secret',
        },
        existingPaths: ['/repo/local.sqlite'],
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('snapshotInput: ready (LOCAL_SNAPSHOT_PATH)');
    expect(result.stdout).toContain('LOCAL_MIGRATION_DB_URL: set');
    expect(result.stdout).toContain('LOCAL_RUNTIME_DB_URL: set');
    expect(result.stdout).toContain('LOCAL_ADMIN_TOKEN: set');
    expect(result.stdout).toContain('opsBaseUrl: blocked');
    expect(result.stdout).not.toContain('local.sqlite');
    expect(result.stdout).not.toContain('viewer-secret');
  });

  it('can load release inputs from an explicit env file without printing values', async () => {
    const result = await runReleasePreflightCommand(
      [
        '--env-file',
        '.env.release',
        '--snapshot-env',
        'NNZ_DB_PATH',
      ],
      deps({
        env: {},
        existingPaths: ['/repo/local.sqlite'],
        files: {
          '/repo/.env.release': [
            'NNZ_DB_PATH=local.sqlite',
            'NNZ_POSTGRES_INTEGRATION_URL=postgres://disposable-secret',
            'NNZ_POSTGRES_SCOPED_RUNTIME_URL=postgres://runtime-secret',
            'NNZ_OPS_VIEWER_TOKEN=viewer-secret',
            'NNZ_OPS_OPERATOR_TOKEN=operator-secret',
            'NNZ_OPS_ADMIN_TOKEN=admin-secret',
          ].join('\n'),
        },
      }),
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('overall: ready');
    expect(result.stdout).toContain('snapshotInput: ready (NNZ_DB_PATH)');
    expect(result.stdout).toContain('NNZ_POSTGRES_INTEGRATION_URL: set');
    expect(result.stdout).toContain('NNZ_POSTGRES_SCOPED_RUNTIME_URL: set');
    expect(result.stdout).not.toContain('.env.release');
    expect(result.stdout).not.toContain('local.sqlite');
    expect(result.stdout).not.toContain('disposable-secret');
    expect(result.stdout).not.toContain('runtime-secret');
    expect(result.stdout).not.toContain('viewer-secret');
  });
});

function deps(options: {
  env: Record<string, string | undefined>;
  existingPaths?: string[];
  files?: Record<string, string>;
}): ReleasePreflightCliDeps {
  const existingPaths = new Set(options.existingPaths ?? []);
  return {
    env: options.env,
    cwd: '/repo',
    fileExists: (path) => existingPaths.has(path),
    readTextFile: (path) => {
      const text = options.files?.[path];
      if (text === undefined) throw new Error('missing test file');
      return text;
    },
  };
}
