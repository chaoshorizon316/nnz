import { describe, expect, it } from 'vitest';

import {
  runReleaseValidationSuiteCommand,
  type ReleaseValidationSuiteCliDeps,
} from './release-validation-suite-cli';

describe('NNZ release validation suite CLI', () => {
  it('requires explicit release confirmation before running any stage', async () => {
    const calls: string[] = [];

    const result = await runReleaseValidationSuiteCommand(
      [
        '--from-json',
        'snapshot.json',
        '--snapshot-out',
        'raw.json',
        '--report-out',
        'report.json',
        '--summary-out',
        'summary.json',
      ],
      deps({ calls }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('RUN_NNZ_RELEASE_VALIDATION_SUITE');
    expect(calls).toEqual([]);
  });

  it('runs preflight, migration, ops, and runtime suites with translated safe args', async () => {
    const calls: string[] = [];
    const preflightArgs: string[][] = [];
    const migrationArgs: string[][] = [];
    const opsArgs: string[][] = [];
    const runtimeArgs: string[][] = [];

    const result = await runReleaseValidationSuiteCommand(
      [
        '--from-sqlite',
        'nnz.db',
        '--snapshot-out',
        'raw.json',
        '--report-out',
        'report.json',
        '--summary-out',
        'summary.json',
        '--confirm',
        'RUN_NNZ_RELEASE_VALIDATION_SUITE',
        '--ops-base-url',
        'https://nnz.example.test',
        '--host',
        '127.0.0.1',
        '--port',
        '3999',
        '--server-entry',
        'dist-cjs/demo-server.js',
        '--timeout-ms',
        '2000',
        '--force',
      ],
      deps({ calls, preflightArgs, migrationArgs, opsArgs, runtimeArgs }),
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(calls).toEqual(['preflight', 'migration', 'ops', 'runtime']);
    expect(preflightArgs).toEqual([[
      '--snapshot',
      'nnz.db',
      '--migration-database-url-env',
      'NNZ_POSTGRES_INTEGRATION_URL',
      '--runtime-database-url-env',
      'NNZ_POSTGRES_SCOPED_RUNTIME_URL',
      '--ops-base-url',
      'https://nnz.example.test',
    ]]);
    expect(migrationArgs).toEqual([[
      '--from-sqlite',
      'nnz.db',
      '--snapshot-out',
      'raw.json',
      '--report-out',
      'report.json',
      '--summary-out',
      'summary.json',
      '--database-url-env',
      'NNZ_POSTGRES_INTEGRATION_URL',
      '--confirm',
      'RUN_POSTGRES_SCOPED_MIGRATION_VALIDATION_SUITE',
      '--force',
    ]]);
    expect(opsArgs).toEqual([[
      '--base-url',
      'https://nnz.example.test',
      '--confirm',
      'RUN_OPS_ROLE_TOKEN_SMOKE',
    ]]);
    expect(runtimeArgs).toEqual([[
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
    ]]);
    expect(result.stdout).toContain('NNZ release validation suite');
    expect(result.stdout).toContain('migrationValidationSuite: yes');
    expect(result.stdout).toContain('opsRoleSmoke: yes');
    expect(result.stdout).toContain('runtimeSmokeSuite: yes');
    expect(result.stdout).not.toContain('postgres://secret');
    expect(result.stdout).not.toContain('token-secret');
    expect(result.stdout).not.toContain('private memory');
  });

  it('supports skipping runtime build while still running all stages', async () => {
    const runtimeArgs: string[][] = [];

    const result = await runReleaseValidationSuiteCommand(
      [
        '--from-json',
        'snapshot.json',
        '--snapshot-out',
        'raw.json',
        '--report-out',
        'report.json',
        '--summary-out',
        'summary.json',
        '--confirm',
        'RUN_NNZ_RELEASE_VALIDATION_SUITE',
        '--skip-build',
      ],
      deps({ runtimeArgs }),
    );

    expect(result.exitCode).toBe(0);
    expect(runtimeArgs[0]).toContain('--skip-build');
    expect(result.stdout).toContain('runtimeDemoBuild: skipped');
  });

  it('stops before validation stages when preflight is blocked', async () => {
    const calls: string[] = [];

    const result = await runReleaseValidationSuiteCommand(
      validArgs(),
      deps({
        calls,
        preflightResult: {
          exitCode: 1,
          stdout: 'raw preflight output with postgres://secret and token-secret',
          stderr: '',
        },
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('release preflight');
    expect(result.stderr).not.toContain('postgres://secret');
    expect(result.stderr).not.toContain('token-secret');
    expect(calls).toEqual(['preflight']);
  });

  it('stops before ops and runtime when migration validation fails', async () => {
    const calls: string[] = [];

    const result = await runReleaseValidationSuiteCommand(
      validArgs(),
      deps({
        calls,
        migrationResult: {
          exitCode: 1,
          stdout: '',
          stderr: 'raw migration failure with private memory',
        },
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('migration validation suite');
    expect(result.stderr).not.toContain('private memory');
    expect(calls).toEqual(['preflight', 'migration']);
  });

  it('stops before runtime when ops role smoke fails', async () => {
    const calls: string[] = [];

    const result = await runReleaseValidationSuiteCommand(
      validArgs(),
      deps({
        calls,
        opsResult: {
          exitCode: 1,
          stdout: '',
          stderr: 'raw ops response with token-secret',
        },
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Ops role token smoke');
    expect(result.stderr).not.toContain('token-secret');
    expect(calls).toEqual(['preflight', 'migration', 'ops']);
  });

  it('sanitizes runtime suite failures', async () => {
    const calls: string[] = [];

    const result = await runReleaseValidationSuiteCommand(
      validArgs(),
      deps({
        calls,
        runtimeResult: {
          exitCode: 1,
          stdout: '',
          stderr: 'raw runtime server log with postgres://secret',
        },
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('scoped runtime smoke suite');
    expect(result.stderr).not.toContain('postgres://secret');
    expect(result.stderr).not.toContain('raw runtime server log');
    expect(calls).toEqual(['preflight', 'migration', 'ops', 'runtime']);
  });

  it('validates numeric options before any stage runs', async () => {
    const calls: string[] = [];

    const result = await runReleaseValidationSuiteCommand(
      [
        '--from-json',
        'snapshot.json',
        '--snapshot-out',
        'raw.json',
        '--report-out',
        'report.json',
        '--summary-out',
        'summary.json',
        '--confirm',
        'RUN_NNZ_RELEASE_VALIDATION_SUITE',
        '--timeout-ms',
        '999',
      ],
      deps({ calls }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('--timeout-ms must be an integer');
    expect(calls).toEqual([]);
  });
});

function validArgs(): string[] {
  return [
    '--from-json',
    'snapshot.json',
    '--snapshot-out',
    'raw.json',
    '--report-out',
    'report.json',
    '--summary-out',
    'summary.json',
    '--confirm',
    'RUN_NNZ_RELEASE_VALIDATION_SUITE',
  ];
}

function deps(options: {
  calls?: string[];
  preflightArgs?: string[][];
  migrationArgs?: string[][];
  opsArgs?: string[][];
  runtimeArgs?: string[][];
  preflightResult?: { exitCode: number; stdout: string; stderr: string };
  migrationResult?: { exitCode: number; stdout: string; stderr: string };
  opsResult?: { exitCode: number; stdout: string; stderr: string };
  runtimeResult?: { exitCode: number; stdout: string; stderr: string };
}): ReleaseValidationSuiteCliDeps {
  return {
    env: {},
    runPreflight: async (args) => {
      options.calls?.push('preflight');
      options.preflightArgs?.push(args);
      return options.preflightResult ?? { exitCode: 0, stdout: 'preflight ok', stderr: '' };
    },
    runMigrationValidation: async (args) => {
      options.calls?.push('migration');
      options.migrationArgs?.push(args);
      return options.migrationResult ?? { exitCode: 0, stdout: 'migration ok', stderr: '' };
    },
    runOpsRoleSmoke: async (args) => {
      options.calls?.push('ops');
      options.opsArgs?.push(args);
      return options.opsResult ?? { exitCode: 0, stdout: 'ops ok', stderr: '' };
    },
    runRuntimeSmokeSuite: async (args) => {
      options.calls?.push('runtime');
      options.runtimeArgs?.push(args);
      return options.runtimeResult ?? { exitCode: 0, stdout: 'runtime ok', stderr: '' };
    },
  };
}
