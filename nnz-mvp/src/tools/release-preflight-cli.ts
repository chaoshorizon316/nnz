import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PRODUCTION_POSTGRES_ENV_KEYS,
  findPostgresEnvAliasConflict,
  readNonEmptyEnv,
} from '../postgres-env-alias-guard';

const DEFAULT_SNAPSHOT_ENV = 'NNZ_MIGRATION_SNAPSHOT_PATH';
const DEFAULT_MIGRATION_DATABASE_URL_ENV = 'NNZ_POSTGRES_INTEGRATION_URL';
const DEFAULT_RUNTIME_DATABASE_URL_ENV = 'NNZ_POSTGRES_SCOPED_RUNTIME_URL';
const DEFAULT_OPS_BASE_URL = 'https://nnz-kego.onrender.com';
const DEFAULT_VIEWER_TOKEN_ENV = 'NNZ_OPS_VIEWER_TOKEN';
const DEFAULT_OPERATOR_TOKEN_ENV = 'NNZ_OPS_OPERATOR_TOKEN';
const DEFAULT_ADMIN_TOKEN_ENV = 'NNZ_OPS_ADMIN_TOKEN';

const USAGE = `Usage:
  npm run release:preflight -- --snapshot <sqlite-or-snapshot-json-path>
  npm run release:preflight -- --snapshot-env NNZ_MIGRATION_SNAPSHOT_PATH --ops-base-url https://nnz-kego.onrender.com

Optional env key overrides:
  npm run release:preflight -- --migration-database-url-env NNZ_POSTGRES_INTEGRATION_URL --runtime-database-url-env NNZ_POSTGRES_SCOPED_RUNTIME_URL --viewer-token-env NNZ_OPS_VIEWER_TOKEN --operator-token-env NNZ_OPS_OPERATOR_TOKEN --admin-token-env NNZ_OPS_ADMIN_TOKEN

Checks launch-blocking external inputs without reading snapshot contents, connecting to databases, sending network requests, or printing secret values.`;

type CheckStatus = 'ready' | 'blocked';
type CheckName = 'migrationValidationSuite' | 'opsRoleSmoke' | 'runtimeSmokeSuite';

export interface ReleasePreflightCliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ReleasePreflightCliDeps {
  env: Record<string, string | undefined>;
  cwd: string;
  fileExists(path: string): boolean;
}

export interface ReleasePreflightResult {
  kind: 'release-preflight';
  overall: CheckStatus;
  checks: ReleasePreflightCheck[];
}

interface ReleasePreflightCheck {
  name: CheckName;
  status: CheckStatus;
  details: string[];
  command: string;
}

type ParsedArgs = {
  help: boolean;
  snapshotPath?: string;
  snapshotEnv: string;
  migrationDatabaseUrlEnv: string;
  runtimeDatabaseUrlEnv: string;
  opsBaseUrl: string;
  viewerTokenEnv: string;
  operatorTokenEnv: string;
  adminTokenEnv: string;
  error?: string;
};

const DEFAULT_DEPS: ReleasePreflightCliDeps = {
  env: process.env,
  cwd: process.cwd(),
  fileExists: existsSync,
};

export async function runReleasePreflightCommand(
  args: string[],
  deps: ReleasePreflightCliDeps = DEFAULT_DEPS,
): Promise<ReleasePreflightCliResult> {
  const parsedArgs = parseArgs(args);
  if (parsedArgs.help) {
    return { exitCode: 0, stdout: `${USAGE}\n`, stderr: '' };
  }
  if (parsedArgs.error) {
    return { exitCode: 1, stdout: '', stderr: `${parsedArgs.error}\n\n${USAGE}\n` };
  }

  const result = buildReleasePreflight(parsedArgs, deps);
  return {
    exitCode: result.overall === 'ready' ? 0 : 1,
    stdout: formatReleasePreflight(result),
    stderr: '',
  };
}

function buildReleasePreflight(args: ParsedArgs, deps: ReleasePreflightCliDeps): ReleasePreflightResult {
  const checks = [
    buildMigrationValidationCheck(args, deps),
    buildOpsRoleSmokeCheck(args, deps),
    buildRuntimeSmokeSuiteCheck(args, deps),
  ];
  return {
    kind: 'release-preflight',
    overall: checks.every((check) => check.status === 'ready') ? 'ready' : 'blocked',
    checks,
  };
}

function buildMigrationValidationCheck(
  args: ParsedArgs,
  deps: ReleasePreflightCliDeps,
): ReleasePreflightCheck {
  const details: string[] = [];
  const snapshot = resolveSnapshotInput(args, deps);
  details.push(`snapshotInput: ${snapshot.status} (${snapshot.source})`);

  addDisposableDatabaseEnvDetails(details, deps.env, args.migrationDatabaseUrlEnv, 'migration database');

  const status = details.every((detail) => detail.includes(': ready') || detail.includes(': set')) ? 'ready' : 'blocked';
  return {
    name: 'migrationValidationSuite',
    status,
    details,
    command: 'npm run migration:validation-suite -- --from-json|--from-sqlite <local-snapshot-or-sqlite> --snapshot-out <raw-snapshot-json> --report-out <sanitized-report-json> --summary-out <sanitized-summary-json> --database-url-env NNZ_POSTGRES_INTEGRATION_URL --confirm RUN_POSTGRES_SCOPED_MIGRATION_VALIDATION_SUITE',
  };
}

function buildOpsRoleSmokeCheck(args: ParsedArgs, deps: ReleasePreflightCliDeps): ReleasePreflightCheck {
  const details: string[] = [];
  details.push(`opsBaseUrl: ${validateBaseUrl(args.opsBaseUrl) ? 'blocked' : 'ready'}`);
  for (const envKey of [args.viewerTokenEnv, args.operatorTokenEnv, args.adminTokenEnv]) {
    details.push(`${envKey}: ${readNonEmptyEnv(deps.env, envKey) ? 'set' : 'missing'}`);
  }

  const status = details.every((detail) => detail.includes(': ready') || detail.includes(': set')) ? 'ready' : 'blocked';
  return {
    name: 'opsRoleSmoke',
    status,
    details,
    command: 'npm run ops:role-smoke -- --base-url <render-service-url> --confirm RUN_OPS_ROLE_TOKEN_SMOKE',
  };
}

function buildRuntimeSmokeSuiteCheck(args: ParsedArgs, deps: ReleasePreflightCliDeps): ReleasePreflightCheck {
  const details: string[] = [];
  addDisposableDatabaseEnvDetails(details, deps.env, args.runtimeDatabaseUrlEnv, 'scoped runtime database');

  const status = details.every((detail) => detail.includes(': set')) ? 'ready' : 'blocked';
  return {
    name: 'runtimeSmokeSuite',
    status,
    details,
    command: 'npm run runtime:smoke-suite -- --database-url-env NNZ_POSTGRES_SCOPED_RUNTIME_URL --confirm RUN_POSTGRES_SCOPED_RUNTIME_SMOKE_SUITE',
  };
}

function addDisposableDatabaseEnvDetails(
  details: string[],
  env: Record<string, string | undefined>,
  envKey: string,
  label: string,
): void {
  if (PRODUCTION_POSTGRES_ENV_KEYS.includes(envKey as typeof PRODUCTION_POSTGRES_ENV_KEYS[number])) {
    details.push(`${label}: blocked (${envKey} is a production database env key)`);
    return;
  }
  if (!readNonEmptyEnv(env, envKey)) {
    details.push(`${envKey}: missing`);
    return;
  }
  const aliasConflict = findPostgresEnvAliasConflict(env, envKey);
  if (aliasConflict) {
    details.push(`${envKey}: blocked (matches ${aliasConflict})`);
    return;
  }
  details.push(`${envKey}: set`);
}

function resolveSnapshotInput(args: ParsedArgs, deps: ReleasePreflightCliDeps): { source: string; status: CheckStatus } {
  const fromArg = args.snapshotPath;
  if (fromArg) {
    return {
      source: '--snapshot',
      status: deps.fileExists(resolveInputPath(deps.cwd, fromArg)) ? 'ready' : 'blocked',
    };
  }

  const fromEnv = readNonEmptyEnv(deps.env, args.snapshotEnv);
  if (!fromEnv) {
    return { source: `${args.snapshotEnv} missing`, status: 'blocked' };
  }
  return {
    source: args.snapshotEnv,
    status: deps.fileExists(resolveInputPath(deps.cwd, fromEnv)) ? 'ready' : 'blocked',
  };
}

function resolveInputPath(cwd: string, inputPath: string): string {
  return isAbsolute(inputPath) ? inputPath : resolve(cwd, inputPath);
}

function parseArgs(args: string[]): ParsedArgs {
  let snapshotPath: string | undefined;
  let snapshotEnv = DEFAULT_SNAPSHOT_ENV;
  let migrationDatabaseUrlEnv = DEFAULT_MIGRATION_DATABASE_URL_ENV;
  let runtimeDatabaseUrlEnv = DEFAULT_RUNTIME_DATABASE_URL_ENV;
  let opsBaseUrl = DEFAULT_OPS_BASE_URL;
  let viewerTokenEnv = DEFAULT_VIEWER_TOKEN_ENV;
  let operatorTokenEnv = DEFAULT_OPERATOR_TOKEN_ENV;
  let adminTokenEnv = DEFAULT_ADMIN_TOKEN_ENV;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === '--help' || arg === '-h') {
      return {
        help: true,
        snapshotEnv,
        migrationDatabaseUrlEnv,
        runtimeDatabaseUrlEnv,
        opsBaseUrl,
        viewerTokenEnv,
        operatorTokenEnv,
        adminTokenEnv,
      };
    }
    if (
      arg === '--snapshot'
      || arg === '--snapshot-env'
      || arg === '--migration-database-url-env'
      || arg === '--runtime-database-url-env'
      || arg === '--ops-base-url'
      || arg === '--viewer-token-env'
      || arg === '--operator-token-env'
      || arg === '--admin-token-env'
    ) {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        return createParsedArgError(`Missing value after ${arg}.`, {
          snapshotEnv,
          migrationDatabaseUrlEnv,
          runtimeDatabaseUrlEnv,
          opsBaseUrl,
          viewerTokenEnv,
          operatorTokenEnv,
          adminTokenEnv,
        });
      }
      if (arg === '--snapshot') snapshotPath = value;
      if (arg === '--snapshot-env') snapshotEnv = value;
      if (arg === '--migration-database-url-env') migrationDatabaseUrlEnv = value;
      if (arg === '--runtime-database-url-env') runtimeDatabaseUrlEnv = value;
      if (arg === '--ops-base-url') opsBaseUrl = value;
      if (arg === '--viewer-token-env') viewerTokenEnv = value;
      if (arg === '--operator-token-env') operatorTokenEnv = value;
      if (arg === '--admin-token-env') adminTokenEnv = value;
      index += 1;
      continue;
    }
    return createParsedArgError(`Unknown argument: ${arg}.`, {
      snapshotEnv,
      migrationDatabaseUrlEnv,
      runtimeDatabaseUrlEnv,
      opsBaseUrl,
      viewerTokenEnv,
      operatorTokenEnv,
      adminTokenEnv,
    });
  }

  return {
    help: false,
    snapshotEnv,
    migrationDatabaseUrlEnv,
    runtimeDatabaseUrlEnv,
    opsBaseUrl,
    viewerTokenEnv,
    operatorTokenEnv,
    adminTokenEnv,
    ...(snapshotPath ? { snapshotPath } : {}),
  };
}

function createParsedArgError(
  error: string,
  defaults: Omit<ParsedArgs, 'help' | 'error' | 'snapshotPath'>,
): ParsedArgs {
  return { help: false, ...defaults, error };
}

function validateBaseUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return 'must start with http:// or https://';
    }
    if (!url.hostname) return 'must include hostname';
    return undefined;
  } catch {
    return 'must be a valid URL';
  }
}

function formatReleasePreflight(result: ReleasePreflightResult): string {
  const lines = [
    'NNZ release preflight',
    `overall: ${result.overall}`,
    'network: not-run',
    'database: not-run',
    'snapshot: not-read',
    '',
    'Checks:',
  ];

  for (const check of result.checks) {
    lines.push(`- ${check.name}: ${check.status}`);
    for (const detail of check.details) {
      lines.push(`  - ${detail}`);
    }
    lines.push(`  - command: ${check.command}`);
  }

  lines.push(
    '',
    'No secret values, snapshot content, database URL, token value, user content, cleanup receipt, server log, or raw network details were printed.',
  );
  return `${lines.join('\n')}\n`;
}

const currentFilePath = process.argv[1] ? resolve(process.argv[1]) : '';
if (currentFilePath && currentFilePath === fileURLToPath(import.meta.url)) {
  const result = await runReleasePreflightCommand(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
