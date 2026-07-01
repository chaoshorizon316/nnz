import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

import type { StoreSnapshot } from '../domain/persistence';
import type {
  ExecutePostgresScopedMigrationOptions,
  ExecutePostgresScopedMigrationResult,
  PostgresScopedMigrationPool,
} from '../domain/postgres-scoped-migration-executor';
import {
  EXECUTE_POSTGRES_SCOPED_MIGRATION_CONFIRM,
  executePostgresScopedMigration,
} from '../domain/postgres-scoped-migration-executor';
import type { PostgresScopedMigrationIssue, PostgresScopedMigrationPlan } from '../domain/postgres-scoped-migration-plan';
import { planPostgresScopedMigration } from '../domain/postgres-scoped-migration-plan';
import { buildPostgresScopedMigrationRows } from '../domain/postgres-scoped-migration-rows';
import {
  createSanitizedSummary,
  parseSnapshotJson,
} from './postgres-scoped-migration-plan-cli';

const { Pool } = pg;

export interface MigrationExecuteCliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface MigrationExecuteCliDeps {
  env: Record<string, string | undefined>;
  readTextFile: (path: string) => string;
  writeTextFile: (path: string, text: string) => void;
  createPool: (connectionString: string) => PostgresScopedMigrationPool & { end(): Promise<void> };
  executeMigration: (
    pool: PostgresScopedMigrationPool,
    snapshot: StoreSnapshot,
    options: ExecutePostgresScopedMigrationOptions,
  ) => Promise<ExecutePostgresScopedMigrationResult>;
}

const ALLOWED_DATABASE_URL_ENV = 'NNZ_POSTGRES_INTEGRATION_URL';

const USAGE = `Usage:
  npm run migration:execute -- --snapshot <snapshot-json-path>
  npm run migration:execute -- --snapshot <snapshot-json-path> --execute --database-url-env NNZ_POSTGRES_INTEGRATION_URL --confirm EXECUTE_POSTGRES_SCOPED_MIGRATION

Default mode is a protected dry-run. It reads only the explicit local snapshot file and prints sanitized counts.
Execution mode is for disposable databases only. It refuses DATABASE_URL and only reads NNZ_POSTGRES_INTEGRATION_URL.
Reports are sanitized: they include counts, issue codes, tables, and execution status, but never rows, memory text, chat content, credential hashes, or database URLs.`;

const DEFAULT_DEPS: MigrationExecuteCliDeps = {
  env: process.env,
  readTextFile: (path) => readFileSync(path, 'utf8'),
  writeTextFile: (path, text) => writeFileSync(path, text),
  createPool: (connectionString) => new Pool({
    connectionString,
    ssl: shouldUseSsl(connectionString) ? { rejectUnauthorized: false } : undefined,
  }) as unknown as PostgresScopedMigrationPool & { end(): Promise<void> },
  executeMigration: executePostgresScopedMigration,
};

export async function runMigrationExecuteCommand(
  args: string[],
  deps: MigrationExecuteCliDeps = DEFAULT_DEPS,
): Promise<MigrationExecuteCliResult> {
  const parsedArgs = parseArgs(args);
  if (parsedArgs.help) {
    return { exitCode: 0, stdout: `${USAGE}\n`, stderr: '' };
  }
  if (parsedArgs.error) {
    return { exitCode: 1, stdout: '', stderr: `${parsedArgs.error}\n\n${USAGE}\n` };
  }

  if (parsedArgs.execute) {
    const guardrailError = validateExecutionGuardrails(parsedArgs, deps.env);
    if (guardrailError) {
      return { exitCode: 1, stdout: '', stderr: `${guardrailError}\n\n${USAGE}\n` };
    }
  }

  try {
    const snapshotPath = resolve(parsedArgs.snapshotPath);
    const snapshot = parseSnapshotJson(deps.readTextFile(snapshotPath));
    const plan = planPostgresScopedMigration(snapshot);
    const rows = plan.ready
      ? buildPostgresScopedMigrationRows(snapshot, migrationOptions(parsedArgs))
      : undefined;

    if (!parsedArgs.execute) {
      const report = createExecutionReport({
        mode: 'dry-run',
        snapshotPath,
        plan,
        rows,
        parsedArgs,
      });
      writeReportIfRequested(parsedArgs.reportPath, report, deps);
      return {
        exitCode: plan.ready ? 0 : 2,
        stdout: formatExecutionSummary(report),
        stderr: '',
      };
    }

    if (!plan.ready) {
      const report = createExecutionReport({
        mode: 'execute',
        snapshotPath,
        plan,
        rows,
        parsedArgs,
      });
      writeReportIfRequested(parsedArgs.reportPath, report, deps);
      return {
        exitCode: 2,
        stdout: formatExecutionSummary(report),
        stderr: 'Migration execution refused because the snapshot has blocking errors.\n',
      };
    }

    if (plan.warnings.length > 0 && !parsedArgs.allowWarnings) {
      const report = createExecutionReport({
        mode: 'execute',
        snapshotPath,
        plan,
        rows,
        parsedArgs,
      });
      writeReportIfRequested(parsedArgs.reportPath, report, deps);
      return {
        exitCode: 2,
        stdout: formatExecutionSummary(report),
        stderr: 'Migration execution refused because warnings are present. Review the sanitized report, then pass --allow-warnings only for a disposable database.\n',
      };
    }

    const connectionString = deps.env[ALLOWED_DATABASE_URL_ENV]!;
    const pool = deps.createPool(connectionString);
    try {
      const execution = await deps.executeMigration(pool, snapshot, migrationOptions(parsedArgs));
      const report = createExecutionReport({
        mode: 'execute',
        snapshotPath,
        plan,
        rows,
        parsedArgs,
        execution,
      });
      writeReportIfRequested(parsedArgs.reportPath, report, deps);
      return {
        exitCode: 0,
        stdout: formatExecutionSummary(report),
        stderr: '',
      };
    } catch (error) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: formatExecutionError(error),
      };
    } finally {
      await pool.end();
    }
  } catch (error) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `${error instanceof Error ? error.message : String(error)}\n`,
    };
  }
}

type ParsedArgs = {
  help: boolean;
  snapshotPath: string;
  reportPath?: string;
  execute: boolean;
  confirm?: string;
  databaseUrlEnv?: string;
  allowWarnings: boolean;
  skipSchema: boolean;
  migratedAt?: string;
  error?: string;
};

function parseArgs(args: string[]): ParsedArgs {
  let snapshotPath: string | undefined;
  let reportPath: string | undefined;
  let confirm: string | undefined;
  let databaseUrlEnv: string | undefined;
  let migratedAt: string | undefined;
  let execute = false;
  let allowWarnings = false;
  let skipSchema = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === '--help' || arg === '-h') {
      return { help: true, snapshotPath: '', execute: false, allowWarnings: false, skipSchema: false };
    }
    if (arg === '--execute') {
      execute = true;
      continue;
    }
    if (arg === '--allow-warnings') {
      allowWarnings = true;
      continue;
    }
    if (arg === '--skip-schema') {
      skipSchema = true;
      continue;
    }
    if (arg === '--snapshot' || arg === '--report' || arg === '--confirm' || arg === '--database-url-env' || arg === '--migrated-at') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        return errorResult(`Missing value after ${arg}.`, {
          execute,
          allowWarnings,
          skipSchema,
        });
      }
      if (arg === '--snapshot') snapshotPath = value;
      if (arg === '--report') reportPath = value;
      if (arg === '--confirm') confirm = value;
      if (arg === '--database-url-env') databaseUrlEnv = value;
      if (arg === '--migrated-at') migratedAt = value;
      index += 1;
      continue;
    }
    return errorResult(`Unknown argument: ${arg}.`, { execute, allowWarnings, skipSchema });
  }

  if (!snapshotPath) {
    return errorResult('Missing snapshot path. Pass --snapshot <snapshot-json-path>.', {
      execute,
      allowWarnings,
      skipSchema,
    });
  }

  return {
    help: false,
    snapshotPath,
    ...(reportPath ? { reportPath } : {}),
    execute,
    ...(confirm ? { confirm } : {}),
    ...(databaseUrlEnv ? { databaseUrlEnv } : {}),
    allowWarnings,
    skipSchema,
    ...(migratedAt ? { migratedAt } : {}),
  };
}

function errorResult(
  error: string,
  flags: { execute: boolean; allowWarnings: boolean; skipSchema: boolean },
): ParsedArgs {
  return {
    help: false,
    snapshotPath: '',
    execute: flags.execute,
    allowWarnings: flags.allowWarnings,
    skipSchema: flags.skipSchema,
    error,
  };
}

function validateExecutionGuardrails(parsedArgs: ParsedArgs, env: Record<string, string | undefined>): string | undefined {
  if (parsedArgs.confirm !== EXECUTE_POSTGRES_SCOPED_MIGRATION_CONFIRM) {
    return `Execution requires --confirm ${EXECUTE_POSTGRES_SCOPED_MIGRATION_CONFIRM}.`;
  }
  if (parsedArgs.databaseUrlEnv !== ALLOWED_DATABASE_URL_ENV) {
    return `Execution requires --database-url-env ${ALLOWED_DATABASE_URL_ENV}; DATABASE_URL and NNZ_POSTGRES_URL are refused.`;
  }
  if (!env[ALLOWED_DATABASE_URL_ENV]) {
    return `${ALLOWED_DATABASE_URL_ENV} is not set. Use a disposable Postgres database only.`;
  }
  return undefined;
}

function migrationOptions(parsedArgs: ParsedArgs): ExecutePostgresScopedMigrationOptions {
  return {
    confirm: EXECUTE_POSTGRES_SCOPED_MIGRATION_CONFIRM,
    ensureSchema: !parsedArgs.skipSchema,
    ...(parsedArgs.migratedAt ? { migratedAt: parsedArgs.migratedAt } : {}),
  };
}

function createExecutionReport(input: {
  mode: 'dry-run' | 'execute';
  snapshotPath: string;
  plan: PostgresScopedMigrationPlan;
  rows: ReturnType<typeof buildPostgresScopedMigrationRows> | undefined;
  parsedArgs: ParsedArgs;
  execution?: ExecutePostgresScopedMigrationResult;
}): Record<string, unknown> {
  return {
    kind: 'postgres-scoped-migration-execution',
    mode: input.mode,
    snapshotPath: input.snapshotPath,
    databaseUrlEnv: input.mode === 'execute' ? ALLOWED_DATABASE_URL_ENV : undefined,
    ready: input.plan.ready,
    totalRows: input.plan.totalRows,
    summary: createSanitizedSummary(input.plan, input.rows),
    rowBuild: input.rows
      ? {
        ready: true,
        totalRows: input.rows.totalRows,
        tables: input.rows.tables.map((table) => ({ table: table.table, count: table.rows.length })),
      }
      : {
        ready: false,
        totalRows: 0,
        tables: [],
      },
    executor: {
      readyForExecution: Boolean(input.rows) && input.plan.ready,
      executed: input.execution?.committed === true,
      requiredConfirm: EXECUTE_POSTGRES_SCOPED_MIGRATION_CONFIRM,
      allowWarnings: input.parsedArgs.allowWarnings,
      ensureSchema: !input.parsedArgs.skipSchema,
    },
    result: input.execution
      ? {
        committed: input.execution.committed,
        totalRows: input.execution.totalRows,
        tables: input.execution.tables,
      }
      : undefined,
    warnings: input.plan.warnings.map(sanitizeIssue),
    errors: input.plan.errors.map(sanitizeIssue),
  };
}

function writeReportIfRequested(
  reportPath: string | undefined,
  report: Record<string, unknown>,
  deps: MigrationExecuteCliDeps,
): void {
  if (!reportPath) return;
  deps.writeTextFile(resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`);
}

function formatExecutionSummary(report: Record<string, unknown>): string {
  const summary = report['summary'] as Record<string, unknown>;
  const executor = report['executor'] as Record<string, unknown>;
  const lines = [
    'Postgres scoped migration protected execution',
    `mode: ${report['mode']}`,
    `snapshot: ${report['snapshotPath']}`,
    `databaseUrlEnv: ${report['databaseUrlEnv'] ?? 'none'}`,
    `ready: ${report['ready'] === true ? 'yes' : 'no'}`,
    `totalRows: ${report['totalRows']}`,
    `warningCount: ${summary['warningCount']}`,
    `errorCount: ${summary['errorCount']}`,
    `rowBuildReady: ${summary['rowBuildReady'] === true ? 'yes' : 'no'}`,
    `executorReady: ${summary['executorReady'] === true ? 'yes' : 'no'}`,
    `executed: ${executor['executed'] === true ? 'yes' : 'no'}`,
    `nextAction: ${summary['nextAction']}`,
    '',
    'Tables:',
  ];
  const rowBuild = report['rowBuild'] as Record<string, unknown>;
  const tables = Array.isArray(rowBuild['tables']) ? rowBuild['tables'] : [];
  if (tables.length === 0) {
    lines.push('- none');
  } else {
    for (const table of tables) {
      if (!isRecord(table)) continue;
      lines.push(`- ${table['table']}: ${table['count']}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function sanitizeIssue(issue: PostgresScopedMigrationIssue): Record<string, string> {
  const result: Record<string, string> = { code: issue.code };
  if (issue.table) result['table'] = issue.table;
  if (issue.id) result['id'] = issue.id;
  return result;
}

function formatExecutionError(error: unknown): string {
  const code = isRecord(error) && typeof error['code'] === 'string' ? ` errorCode=${error['code']}` : '';
  return `Migration execution failed during protected execution.${code}\nNo snapshot rows, private content, credential hashes, database URLs, or raw database error details were printed.\n`;
}

function shouldUseSsl(connectionString: string): boolean {
  return !connectionString.includes('localhost') && !connectionString.includes('127.0.0.1');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const currentFilePath = process.argv[1] ? resolve(process.argv[1]) : '';
if (currentFilePath && currentFilePath === fileURLToPath(import.meta.url)) {
  const result = await runMigrationExecuteCommand(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
