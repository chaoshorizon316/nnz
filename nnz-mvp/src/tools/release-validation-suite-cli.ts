import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  runMigrationValidationSuiteCommand,
  type MigrationValidationSuiteCliResult,
} from './postgres-scoped-migration-validation-suite-cli';
import {
  runScopedRuntimeSmokeSuiteCommand,
  type ScopedRuntimeSmokeSuiteCliResult,
} from './postgres-scoped-runtime-smoke-suite-cli';
import {
  runOpsRoleSmokeCommand,
  type OpsRoleSmokeCliResult,
} from './ops-role-token-smoke-cli';
import {
  runReleasePreflightCommand,
  type ReleasePreflightCliResult,
} from './release-preflight-cli';

const RELEASE_CONFIRM = 'RUN_NNZ_RELEASE_VALIDATION_SUITE';
const MIGRATION_DATABASE_URL_ENV = 'NNZ_POSTGRES_INTEGRATION_URL';
const RUNTIME_DATABASE_URL_ENV = 'NNZ_POSTGRES_SCOPED_RUNTIME_URL';
const MIGRATION_CONFIRM = 'RUN_POSTGRES_SCOPED_MIGRATION_VALIDATION_SUITE';
const OPS_CONFIRM = 'RUN_OPS_ROLE_TOKEN_SMOKE';
const RUNTIME_CONFIRM = 'RUN_POSTGRES_SCOPED_RUNTIME_SMOKE_SUITE';
const DEFAULT_OPS_BASE_URL = 'https://nnz-kego.onrender.com';
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3147;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_SERVER_ENTRY = 'dist-cjs/demo-server.js';

const USAGE = `Usage:
  npm run release:validation-suite -- --from-json <snapshot-or-wrapper-json-path> --snapshot-out <raw-snapshot-json-path> --report-out <sanitized-report-json-path> --summary-out <sanitized-summary-json-path> --confirm RUN_NNZ_RELEASE_VALIDATION_SUITE
  npm run release:validation-suite -- --from-sqlite <sqlite-db-path> --snapshot-out <raw-snapshot-json-path> --report-out <sanitized-report-json-path> --summary-out <sanitized-summary-json-path> --confirm RUN_NNZ_RELEASE_VALIDATION_SUITE

Runs release preflight, migration validation suite, non-destructive Ops role token smoke, and scoped runtime smoke suite in order.
This command does not run confirmed Ops cleanup deletion and does not print database URLs, token values, snapshot contents, user content, child command output, server logs, or raw error details.`;

export interface ReleaseValidationSuiteCliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ReleaseValidationSuiteCliDeps {
  env: Record<string, string | undefined>;
  runPreflight: (args: string[]) => Promise<ReleasePreflightCliResult>;
  runMigrationValidation: (args: string[]) => Promise<MigrationValidationSuiteCliResult>;
  runOpsRoleSmoke: (args: string[]) => Promise<OpsRoleSmokeCliResult>;
  runRuntimeSmokeSuite: (args: string[]) => Promise<ScopedRuntimeSmokeSuiteCliResult>;
}

type ParsedArgs = {
  help: boolean;
  source: 'json' | 'sqlite';
  inputPath: string;
  snapshotOut: string;
  reportOut: string;
  summaryOut: string;
  confirm?: string;
  force: boolean;
  opsBaseUrl: string;
  host: string;
  port: number;
  serverEntry: string;
  timeoutMs: number;
  skipBuild: boolean;
  error?: string;
};

const DEFAULT_DEPS: ReleaseValidationSuiteCliDeps = {
  env: process.env,
  runPreflight: (args) => runReleasePreflightCommand(args),
  runMigrationValidation: (args) => runMigrationValidationSuiteCommand(args),
  runOpsRoleSmoke: (args) => runOpsRoleSmokeCommand(args),
  runRuntimeSmokeSuite: (args) => runScopedRuntimeSmokeSuiteCommand(args),
};

export async function runReleaseValidationSuiteCommand(
  args: string[],
  deps: ReleaseValidationSuiteCliDeps = DEFAULT_DEPS,
): Promise<ReleaseValidationSuiteCliResult> {
  const parsedArgs = parseArgs(args);
  if (parsedArgs.help) {
    return { exitCode: 0, stdout: `${USAGE}\n`, stderr: '' };
  }
  if (parsedArgs.error) {
    return { exitCode: 1, stdout: '', stderr: `${parsedArgs.error}\n\n${USAGE}\n` };
  }
  if (parsedArgs.confirm !== RELEASE_CONFIRM) {
    return { exitCode: 1, stdout: '', stderr: `Release validation suite requires --confirm ${RELEASE_CONFIRM}.\n\n${USAGE}\n` };
  }

  const preflightResult = await deps.runPreflight(buildPreflightArgs(parsedArgs));
  if (preflightResult.exitCode !== 0) {
    return failSuite('release preflight');
  }

  const migrationResult = await deps.runMigrationValidation(buildMigrationValidationArgs(parsedArgs));
  if (migrationResult.exitCode !== 0) {
    return failSuite('migration validation suite');
  }

  const opsResult = await deps.runOpsRoleSmoke(buildOpsRoleSmokeArgs(parsedArgs));
  if (opsResult.exitCode !== 0) {
    return failSuite('Ops role token smoke');
  }

  const runtimeResult = await deps.runRuntimeSmokeSuite(buildRuntimeSmokeSuiteArgs(parsedArgs));
  if (runtimeResult.exitCode !== 0) {
    return failSuite('scoped runtime smoke suite');
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
  let confirm: string | undefined;
  let force = false;
  let opsBaseUrl = DEFAULT_OPS_BASE_URL;
  let host = DEFAULT_HOST;
  let port = DEFAULT_PORT;
  let serverEntry = DEFAULT_SERVER_ENTRY;
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  let skipBuild = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === '--help' || arg === '-h') {
      return createParsedArgs({ help: true, force, opsBaseUrl, host, port, serverEntry, timeoutMs, skipBuild });
    }
    if (arg === '--force') {
      force = true;
      continue;
    }
    if (arg === '--skip-build') {
      skipBuild = true;
      continue;
    }
    if (arg === '--from-json' || arg === '--from-sqlite') {
      if (source) {
        return errorResult('Pass exactly one input source: --from-json or --from-sqlite.', { force, opsBaseUrl, host, port, serverEntry, timeoutMs, skipBuild });
      }
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        return errorResult(`Missing path after ${arg}.`, { force, opsBaseUrl, host, port, serverEntry, timeoutMs, skipBuild });
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
      || arg === '--confirm'
      || arg === '--ops-base-url'
      || arg === '--host'
      || arg === '--port'
      || arg === '--server-entry'
      || arg === '--timeout-ms'
    ) {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        return errorResult(`Missing value after ${arg}.`, { force, opsBaseUrl, host, port, serverEntry, timeoutMs, skipBuild });
      }
      if (arg === '--snapshot-out') snapshotOut = value;
      if (arg === '--report-out') reportOut = value;
      if (arg === '--summary-out') summaryOut = value;
      if (arg === '--confirm') confirm = value;
      if (arg === '--ops-base-url') opsBaseUrl = value;
      if (arg === '--host') host = value;
      if (arg === '--port') {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65_535) {
          return errorResult('--port must be an integer from 1 to 65535.', { force, opsBaseUrl, host, port, serverEntry, timeoutMs, skipBuild });
        }
        port = parsed;
      }
      if (arg === '--server-entry') serverEntry = value;
      if (arg === '--timeout-ms') {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed < 1_000 || parsed > 120_000) {
          return errorResult('--timeout-ms must be an integer from 1000 to 120000.', { force, opsBaseUrl, host, port, serverEntry, timeoutMs, skipBuild });
        }
        timeoutMs = parsed;
      }
      index += 1;
      continue;
    }
    return errorResult(`Unknown argument: ${arg}.`, { force, opsBaseUrl, host, port, serverEntry, timeoutMs, skipBuild });
  }

  if (!source || !inputPath) return errorResult('Missing input source. Pass --from-json or --from-sqlite.', { force, opsBaseUrl, host, port, serverEntry, timeoutMs, skipBuild });
  if (!snapshotOut) return errorResult('Missing raw snapshot output path. Pass --snapshot-out <raw-snapshot-json-path>.', { force, opsBaseUrl, host, port, serverEntry, timeoutMs, skipBuild });
  if (!reportOut) return errorResult('Missing sanitized report output path. Pass --report-out <sanitized-report-json-path>.', { force, opsBaseUrl, host, port, serverEntry, timeoutMs, skipBuild });
  if (!summaryOut) return errorResult('Missing sanitized summary output path. Pass --summary-out <sanitized-summary-json-path>.', { force, opsBaseUrl, host, port, serverEntry, timeoutMs, skipBuild });

  return {
    help: false,
    source,
    inputPath,
    snapshotOut,
    reportOut,
    summaryOut,
    force,
    opsBaseUrl,
    host,
    port,
    serverEntry,
    timeoutMs,
    skipBuild,
    ...(confirm ? { confirm } : {}),
  };
}

function createParsedArgs(input: {
  help: boolean;
  force: boolean;
  opsBaseUrl: string;
  host: string;
  port: number;
  serverEntry: string;
  timeoutMs: number;
  skipBuild: boolean;
  error?: string;
}): ParsedArgs {
  return {
    help: input.help,
    source: 'json',
    inputPath: '',
    snapshotOut: '',
    reportOut: '',
    summaryOut: '',
    force: input.force,
    opsBaseUrl: input.opsBaseUrl,
    host: input.host,
    port: input.port,
    serverEntry: input.serverEntry,
    timeoutMs: input.timeoutMs,
    skipBuild: input.skipBuild,
    ...(input.error ? { error: input.error } : {}),
  };
}

function errorResult(
  error: string,
  defaults: {
    force: boolean;
    opsBaseUrl: string;
    host: string;
    port: number;
    serverEntry: string;
    timeoutMs: number;
    skipBuild: boolean;
  },
): ParsedArgs {
  return createParsedArgs({ help: false, ...defaults, error });
}

function buildPreflightArgs(parsedArgs: ParsedArgs): string[] {
  return [
    '--snapshot',
    parsedArgs.inputPath,
    '--migration-database-url-env',
    MIGRATION_DATABASE_URL_ENV,
    '--runtime-database-url-env',
    RUNTIME_DATABASE_URL_ENV,
    '--ops-base-url',
    parsedArgs.opsBaseUrl,
  ];
}

function buildMigrationValidationArgs(parsedArgs: ParsedArgs): string[] {
  return [
    parsedArgs.source === 'json' ? '--from-json' : '--from-sqlite',
    parsedArgs.inputPath,
    '--snapshot-out',
    parsedArgs.snapshotOut,
    '--report-out',
    parsedArgs.reportOut,
    '--summary-out',
    parsedArgs.summaryOut,
    '--database-url-env',
    MIGRATION_DATABASE_URL_ENV,
    '--confirm',
    MIGRATION_CONFIRM,
    ...(parsedArgs.force ? ['--force'] : []),
  ];
}

function buildOpsRoleSmokeArgs(parsedArgs: ParsedArgs): string[] {
  return [
    '--base-url',
    parsedArgs.opsBaseUrl,
    '--confirm',
    OPS_CONFIRM,
  ];
}

function buildRuntimeSmokeSuiteArgs(parsedArgs: ParsedArgs): string[] {
  return [
    '--database-url-env',
    RUNTIME_DATABASE_URL_ENV,
    '--confirm',
    RUNTIME_CONFIRM,
    '--host',
    parsedArgs.host,
    '--port',
    String(parsedArgs.port),
    '--server-entry',
    parsedArgs.serverEntry,
    '--timeout-ms',
    String(parsedArgs.timeoutMs),
    ...(parsedArgs.skipBuild ? ['--skip-build'] : []),
  ];
}

function formatSuiteSummary(parsedArgs: ParsedArgs): string {
  const lines = [
    'NNZ release validation suite',
    '',
    'Stages:',
    '- releasePreflight: yes',
    '- migrationValidationSuite: yes',
    '- opsRoleSmoke: yes',
    '- runtimeSmokeSuite: yes',
    '',
    'Inputs:',
    `- snapshotSource: ${parsedArgs.source}`,
    '- migrationDatabaseEnv: NNZ_POSTGRES_INTEGRATION_URL',
    '- opsRoleTokenEnvs: configured',
    '- runtimeDatabaseEnv: NNZ_POSTGRES_SCOPED_RUNTIME_URL',
    `- runtimeDemoBuild: ${parsedArgs.skipBuild ? 'skipped' : 'yes'}`,
  ];
  return `${lines.join('\n')}\n`;
}

function failSuite(stage: string): ReleaseValidationSuiteCliResult {
  return {
    exitCode: 1,
    stdout: '',
    stderr: `NNZ release validation suite failed during ${stage}.\nNo database URL, token value, snapshot content, user content, cleanup receipt, child command output, server log, or raw error details were printed.\n`,
  };
}

const currentFilePath = process.argv[1] ? resolve(process.argv[1]) : '';
if (currentFilePath && currentFilePath === fileURLToPath(import.meta.url)) {
  const result = await runReleaseValidationSuiteCommand(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
