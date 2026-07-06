import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DISPOSABLE_POSTGRES_ENV,
  findDisposablePostgresAliasConflict,
  readNonEmptyEnv,
} from './postgres-disposable-env-guard';
import {
  runMigrationReadinessCommand,
  type MigrationReadinessCliResult,
} from './postgres-scoped-migration-readiness-cli';
import {
  runMigrationSmokeCommand,
  type MigrationSmokeCliResult,
} from './postgres-scoped-migration-smoke-cli';

const ALLOWED_DATABASE_URL_ENV = DISPOSABLE_POSTGRES_ENV;
const SUITE_CONFIRM = 'RUN_POSTGRES_SCOPED_MIGRATION_VALIDATION_SUITE';
const SMOKE_CONFIRM = 'RUN_POSTGRES_SCOPED_MIGRATION_SMOKE';

const USAGE = `Usage:
  npm run migration:validation-suite -- --from-json <snapshot-or-wrapper-json-path> --snapshot-out <raw-snapshot-json-path> --report-out <sanitized-report-json-path> --summary-out <sanitized-summary-json-path> --database-url-env NNZ_POSTGRES_INTEGRATION_URL --confirm RUN_POSTGRES_SCOPED_MIGRATION_VALIDATION_SUITE
  npm run migration:validation-suite -- --from-sqlite <sqlite-db-path> --snapshot-out <raw-snapshot-json-path> --report-out <sanitized-report-json-path> --summary-out <sanitized-summary-json-path> --database-url-env NNZ_POSTGRES_INTEGRATION_URL --confirm RUN_POSTGRES_SCOPED_MIGRATION_VALIDATION_SUITE

Runs offline migration readiness, then a disposable Postgres migration smoke only if readiness is clean.
This command refuses DATABASE_URL and NNZ_POSTGRES_URL, never prints database URLs, memory text, chat content, credential hashes, raw snapshot data, row payloads, or raw child command details.`;

export interface MigrationValidationSuiteCliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface MigrationValidationSuiteCliDeps {
  env: Record<string, string | undefined>;
  runReadiness: (args: string[]) => MigrationReadinessCliResult;
  runSmoke: (args: string[]) => Promise<MigrationSmokeCliResult>;
}

type ParsedArgs = {
  help: boolean;
  source: 'json' | 'sqlite';
  inputPath: string;
  snapshotOut: string;
  reportOut: string;
  summaryOut: string;
  databaseUrlEnv?: string;
  confirm?: string;
  force: boolean;
  error?: string;
};

const DEFAULT_DEPS: MigrationValidationSuiteCliDeps = {
  env: process.env,
  runReadiness: (args) => runMigrationReadinessCommand(args),
  runSmoke: (args) => runMigrationSmokeCommand(args),
};

export async function runMigrationValidationSuiteCommand(
  args: string[],
  deps: MigrationValidationSuiteCliDeps = DEFAULT_DEPS,
): Promise<MigrationValidationSuiteCliResult> {
  const parsedArgs = parseArgs(args);
  if (parsedArgs.help) {
    return { exitCode: 0, stdout: `${USAGE}\n`, stderr: '' };
  }
  if (parsedArgs.error) {
    return { exitCode: 1, stdout: '', stderr: `${parsedArgs.error}\n\n${USAGE}\n` };
  }

  const guardrailError = validateGuardrails(parsedArgs, deps.env);
  if (guardrailError) {
    return { exitCode: 1, stdout: '', stderr: `${guardrailError}\n\n${USAGE}\n` };
  }

  const readinessResult = deps.runReadiness(buildReadinessArgs(parsedArgs));
  if (readinessResult.exitCode !== 0) {
    return failSuite('offline migration readiness');
  }

  const smokeResult = await deps.runSmoke(buildSmokeArgs(parsedArgs));
  if (smokeResult.exitCode !== 0) {
    return failSuite('disposable Postgres migration smoke');
  }

  return {
    exitCode: 0,
    stdout: formatSuiteSummary(parsedArgs),
    stderr: '',
  };
}

function parseArgs(args: string[]): ParsedArgs {
  let source: 'json' | 'sqlite' | undefined;
  let inputPath: string | undefined;
  let snapshotOut: string | undefined;
  let reportOut: string | undefined;
  let summaryOut: string | undefined;
  let databaseUrlEnv: string | undefined;
  let confirm: string | undefined;
  let force = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === '--help' || arg === '-h') {
      return {
        help: true,
        source: 'json',
        inputPath: '',
        snapshotOut: '',
        reportOut: '',
        summaryOut: '',
        force: false,
      };
    }
    if (arg === '--force') {
      force = true;
      continue;
    }
    if (arg === '--from-json' || arg === '--from-sqlite') {
      if (source) {
        return errorResult('Pass exactly one input source: --from-json or --from-sqlite.', force);
      }
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        return errorResult(`Missing path after ${arg}.`, force);
      }
      source = arg === '--from-json' ? 'json' : 'sqlite';
      inputPath = value;
      index += 1;
      continue;
    }
    if (
      arg === '--snapshot-out'
      || arg === '--report-out'
      || arg === '--summary-out'
      || arg === '--database-url-env'
      || arg === '--confirm'
    ) {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        return errorResult(`Missing value after ${arg}.`, force);
      }
      if (arg === '--snapshot-out') snapshotOut = value;
      if (arg === '--report-out') reportOut = value;
      if (arg === '--summary-out') summaryOut = value;
      if (arg === '--database-url-env') databaseUrlEnv = value;
      if (arg === '--confirm') confirm = value;
      index += 1;
      continue;
    }
    return errorResult(`Unknown argument: ${arg}.`, force);
  }

  if (!source || !inputPath) return errorResult('Missing input source. Pass --from-json or --from-sqlite.', force);
  if (!snapshotOut) return errorResult('Missing raw snapshot output path. Pass --snapshot-out <raw-snapshot-json-path>.', force);
  if (!reportOut) return errorResult('Missing sanitized report output path. Pass --report-out <sanitized-report-json-path>.', force);
  if (!summaryOut) return errorResult('Missing sanitized summary output path. Pass --summary-out <sanitized-summary-json-path>.', force);

  return {
    help: false,
    source,
    inputPath,
    snapshotOut,
    reportOut,
    summaryOut,
    force,
    ...(databaseUrlEnv ? { databaseUrlEnv } : {}),
    ...(confirm ? { confirm } : {}),
  };
}

function errorResult(error: string, force: boolean): ParsedArgs {
  return {
    help: false,
    source: 'json',
    inputPath: '',
    snapshotOut: '',
    reportOut: '',
    summaryOut: '',
    force,
    error,
  };
}

function validateGuardrails(
  parsedArgs: ParsedArgs,
  env: Record<string, string | undefined>,
): string | undefined {
  if (parsedArgs.confirm !== SUITE_CONFIRM) {
    return `Migration validation suite requires --confirm ${SUITE_CONFIRM}.`;
  }
  if (parsedArgs.databaseUrlEnv !== ALLOWED_DATABASE_URL_ENV) {
    return `Migration validation suite requires --database-url-env ${ALLOWED_DATABASE_URL_ENV}; DATABASE_URL and NNZ_POSTGRES_URL are refused.`;
  }
  if (!readNonEmptyEnv(env, ALLOWED_DATABASE_URL_ENV)) {
    return `${ALLOWED_DATABASE_URL_ENV} is not set. Use a disposable Postgres database only.`;
  }
  const aliasConflict = findDisposablePostgresAliasConflict(env, ALLOWED_DATABASE_URL_ENV);
  if (aliasConflict) {
    return `${ALLOWED_DATABASE_URL_ENV} must not match ${aliasConflict}. Use a disposable Postgres database only.`;
  }
  return undefined;
}

function buildReadinessArgs(parsedArgs: ParsedArgs): string[] {
  return [
    parsedArgs.source === 'json' ? '--from-json' : '--from-sqlite',
    parsedArgs.inputPath,
    '--snapshot-out',
    parsedArgs.snapshotOut,
    '--report-out',
    parsedArgs.reportOut,
    '--summary-out',
    parsedArgs.summaryOut,
    ...(parsedArgs.force ? ['--force'] : []),
  ];
}

function buildSmokeArgs(parsedArgs: ParsedArgs): string[] {
  return [
    '--database-url-env',
    parsedArgs.databaseUrlEnv!,
    '--confirm',
    SMOKE_CONFIRM,
  ];
}

function formatSuiteSummary(parsedArgs: ParsedArgs): string {
  const lines = [
    'Postgres scoped migration validation suite',
    '',
    'Stages:',
    '- offlineMigrationReadiness: yes',
    '- disposablePostgresMigrationSmoke: yes',
    '',
    'Outputs:',
    `- raw snapshot: ${parsedArgs.snapshotOut}`,
    `- sanitized report: ${parsedArgs.reportOut}`,
    `- sanitized summary: ${parsedArgs.summaryOut}`,
  ];
  return `${lines.join('\n')}\n`;
}

function failSuite(stage: string): MigrationValidationSuiteCliResult {
  return {
    exitCode: 1,
    stdout: '',
    stderr: `Postgres scoped migration validation suite failed during ${stage}.\nNo database URL, memory text, chat content, credential hash, raw snapshot data, row payload, child command output, or raw error details were printed.\n`,
  };
}

const currentFilePath = process.argv[1] ? resolve(process.argv[1]) : '';
if (currentFilePath && currentFilePath === fileURLToPath(import.meta.url)) {
  const result = await runMigrationValidationSuiteCommand(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
