import { describe, expect, it } from 'vitest';

import {
  runMigrationValidationSuiteCommand,
  type MigrationValidationSuiteCliDeps,
} from './postgres-scoped-migration-validation-suite-cli';

describe('Postgres scoped migration validation suite CLI', () => {
  it('requires explicit suite confirmation before running readiness', async () => {
    const calls: string[] = [];

    const result = await runMigrationValidationSuiteCommand(
      [
        '--from-json',
        'snapshot.json',
        '--snapshot-out',
        'raw.json',
        '--report-out',
        'report.json',
        '--summary-out',
        'summary.json',
        '--database-url-env',
        'NNZ_POSTGRES_INTEGRATION_URL',
      ],
      deps({
        env: { NNZ_POSTGRES_INTEGRATION_URL: 'postgres://disposable-secret' },
        calls,
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('RUN_POSTGRES_SCOPED_MIGRATION_VALIDATION_SUITE');
    expect(result.stderr).not.toContain('disposable-secret');
    expect(calls).toEqual([]);
  });

  it('refuses DATABASE_URL and avoids printing secret values', async () => {
    const calls: string[] = [];

    const result = await runMigrationValidationSuiteCommand(
      [
        '--from-json',
        'snapshot.json',
        '--snapshot-out',
        'raw.json',
        '--report-out',
        'report.json',
        '--summary-out',
        'summary.json',
        '--database-url-env',
        'DATABASE_URL',
        '--confirm',
        'RUN_POSTGRES_SCOPED_MIGRATION_VALIDATION_SUITE',
      ],
      deps({
        env: {
          DATABASE_URL: 'postgres://prod-secret',
          NNZ_POSTGRES_INTEGRATION_URL: 'postgres://disposable-secret',
        },
        calls,
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('NNZ_POSTGRES_INTEGRATION_URL');
    expect(result.stderr).toContain('DATABASE_URL');
    expect(result.stderr).not.toContain('prod-secret');
    expect(result.stderr).not.toContain('disposable-secret');
    expect(calls).toEqual([]);
  });

  it('requires the disposable database env to be set', async () => {
    const result = await runMigrationValidationSuiteCommand(
      [
        '--from-json',
        'snapshot.json',
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
      ],
      deps({ env: {} }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('NNZ_POSTGRES_INTEGRATION_URL is not set');
  });

  it('refuses when the disposable env value matches a production database alias', async () => {
    const calls: string[] = [];

    const result = await runMigrationValidationSuiteCommand(
      [
        '--from-json',
        'snapshot.json',
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
      ],
      deps({
        env: {
          NNZ_POSTGRES_URL: 'postgres://shared-secret',
          NNZ_POSTGRES_INTEGRATION_URL: ' postgres://shared-secret ',
        },
        calls,
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('must not match NNZ_POSTGRES_URL');
    expect(result.stderr).not.toContain('shared-secret');
    expect(calls).toEqual([]);
  });

  it('runs readiness then smoke with translated safe args', async () => {
    const calls: string[] = [];
    const readinessArgs: string[][] = [];
    const smokeArgs: string[][] = [];

    const result = await runMigrationValidationSuiteCommand(
      [
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
      ],
      deps({
        env: { NNZ_POSTGRES_INTEGRATION_URL: 'postgres://disposable-secret' },
        calls,
        readinessArgs,
        smokeArgs,
      }),
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(calls).toEqual(['readiness', 'smoke']);
    expect(readinessArgs).toEqual([[
      '--from-sqlite',
      'nnz.db',
      '--snapshot-out',
      'raw.json',
      '--report-out',
      'report.json',
      '--summary-out',
      'summary.json',
      '--force',
    ]]);
    expect(smokeArgs).toEqual([[
      '--database-url-env',
      'NNZ_POSTGRES_INTEGRATION_URL',
      '--confirm',
      'RUN_POSTGRES_SCOPED_MIGRATION_SMOKE',
    ]]);
    expect(result.stdout).toContain('Postgres scoped migration validation suite');
    expect(result.stdout).toContain('offlineMigrationReadiness: yes');
    expect(result.stdout).toContain('disposablePostgresMigrationSmoke: yes');
    expect(result.stdout).toContain('raw snapshot: raw.json');
    expect(result.stdout).toContain('sanitized report: report.json');
    expect(result.stdout).toContain('sanitized summary: summary.json');
    expect(result.stdout).not.toContain('disposable-secret');
  });

  it('can load the disposable database env from an explicit env file', async () => {
    const calls: string[] = [];
    const smokeArgs: string[][] = [];

    const result = await runMigrationValidationSuiteCommand(
      [
        '--env-file',
        '.env.release',
        '--from-json',
        'snapshot.json',
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
      ],
      deps({
        env: {},
        calls,
        smokeArgs,
        files: {
          '/repo/.env.release': 'NNZ_POSTGRES_INTEGRATION_URL=postgres://disposable-secret\n',
        },
      }),
    );

    expect(result.exitCode).toBe(0);
    expect(calls).toEqual(['readiness', 'smoke']);
    expect(smokeArgs[0]).toContain('NNZ_POSTGRES_INTEGRATION_URL');
    expect(result.stdout).not.toContain('.env.release');
    expect(result.stdout).not.toContain('disposable-secret');
  });

  it('stops before smoke when readiness reports blocking issues', async () => {
    const calls: string[] = [];

    const result = await runMigrationValidationSuiteCommand(
      [
        '--from-json',
        'snapshot.json',
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
      ],
      deps({
        env: { NNZ_POSTGRES_INTEGRATION_URL: 'postgres://disposable-secret' },
        calls,
        readinessResult: {
          exitCode: 2,
          stdout: 'raw readiness output with private memory text',
          stderr: '',
        },
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('offline migration readiness');
    expect(result.stderr).not.toContain('raw readiness output');
    expect(result.stderr).not.toContain('private memory text');
    expect(result.stderr).not.toContain('disposable-secret');
    expect(calls).toEqual(['readiness']);
  });

  it('does not print raw smoke failure output', async () => {
    const calls: string[] = [];

    const result = await runMigrationValidationSuiteCommand(
      [
        '--from-json',
        'snapshot.json',
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
      ],
      deps({
        env: { NNZ_POSTGRES_INTEGRATION_URL: 'postgres://disposable-secret' },
        calls,
        smokeResult: {
          exitCode: 1,
          stdout: '',
          stderr: 'raw database failure with raw-credential-hash and raw-row-payload',
        },
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('disposable Postgres migration smoke');
    expect(result.stderr).not.toContain('raw database failure');
    expect(result.stderr).not.toContain('raw-credential-hash');
    expect(result.stderr).not.toContain('raw-row-payload');
    expect(result.stderr).not.toContain('disposable-secret');
    expect(calls).toEqual(['readiness', 'smoke']);
  });

  it('validates required file arguments before running', async () => {
    const calls: string[] = [];

    const result = await runMigrationValidationSuiteCommand(
      [
        '--from-json',
        'snapshot.json',
        '--snapshot-out',
        'raw.json',
        '--database-url-env',
        'NNZ_POSTGRES_INTEGRATION_URL',
        '--confirm',
        'RUN_POSTGRES_SCOPED_MIGRATION_VALIDATION_SUITE',
      ],
      deps({
        env: { NNZ_POSTGRES_INTEGRATION_URL: 'postgres://disposable-secret' },
        calls,
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Missing sanitized report output path');
    expect(calls).toEqual([]);
  });
});

function deps(options: {
  env: Record<string, string | undefined>;
  calls?: string[];
  readinessArgs?: string[][];
  smokeArgs?: string[][];
  readinessResult?: { exitCode: number; stdout: string; stderr: string };
  smokeResult?: { exitCode: number; stdout: string; stderr: string };
  files?: Record<string, string>;
}): MigrationValidationSuiteCliDeps {
  return {
    env: options.env,
    runReadiness: (args) => {
      options.calls?.push('readiness');
      options.readinessArgs?.push(args);
      return options.readinessResult ?? { exitCode: 0, stdout: 'readiness ok', stderr: '' };
    },
    runSmoke: async (args) => {
      options.calls?.push('smoke');
      options.smokeArgs?.push(args);
      return options.smokeResult ?? { exitCode: 0, stdout: 'smoke ok', stderr: '' };
    },
    cwd: '/repo',
    readTextFile: (path) => {
      const text = options.files?.[path];
      if (text === undefined) throw new Error('missing test file');
      return text;
    },
  };
}
