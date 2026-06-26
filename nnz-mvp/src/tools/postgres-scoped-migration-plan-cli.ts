import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { StoreSnapshot } from '../domain/persistence';
import type { PostgresScopedMigrationIssue, PostgresScopedMigrationPlan } from '../domain/postgres-scoped-migration-plan';
import { planPostgresScopedMigration } from '../domain/postgres-scoped-migration-plan';
import { buildPostgresScopedMigrationRows } from '../domain/postgres-scoped-migration-rows';
import { EXECUTE_POSTGRES_SCOPED_MIGRATION_CONFIRM } from '../domain/postgres-scoped-migration-executor';

export interface MigrationPlanCliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

type ReadTextFile = (path: string) => string;
type WriteTextFile = (path: string, text: string) => void;

const USAGE = `Usage:
  npm run migration:plan -- <snapshot-json-path>
  npm run migration:plan -- --json <snapshot-json-path>
  npm run migration:plan -- --report <report-json-path> <snapshot-json-path>

Input may be a raw StoreSnapshot JSON object or an object with a snapshot_json field.
This command is offline only: it does not read DATABASE_URL or connect to Postgres.
Reports are sanitized: they include counts, issue codes, tables, and ids, but never memory or chat content.`;

export function runMigrationPlanCommand(
  args: string[],
  readTextFile: ReadTextFile = (path) => readFileSync(path, 'utf8'),
  writeTextFile: WriteTextFile = (path, text) => writeFileSync(path, text),
): MigrationPlanCliResult {
  const parsedArgs = parseArgs(args);
  if (parsedArgs.help) {
    return { exitCode: 0, stdout: `${USAGE}\n`, stderr: '' };
  }
  if (parsedArgs.error) {
    return { exitCode: 1, stdout: '', stderr: `${parsedArgs.error}\n\n${USAGE}\n` };
  }

  try {
    const snapshotPath = resolve(parsedArgs.snapshotPath);
    const snapshot = parseSnapshotJson(readTextFile(snapshotPath));
    const plan = planPostgresScopedMigration(snapshot);
    if (parsedArgs.reportPath) {
      const rows = plan.ready ? buildPostgresScopedMigrationRows(snapshot) : undefined;
      writeTextFile(resolve(parsedArgs.reportPath), `${JSON.stringify(createSanitizedReport(plan, snapshotPath, rows), null, 2)}\n`);
    }
    return {
      exitCode: plan.ready ? 0 : 2,
      stdout: parsedArgs.json ? `${JSON.stringify(plan, null, 2)}\n` : formatPlan(plan, snapshotPath),
      stderr: '',
    };
  } catch (error) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `${error instanceof Error ? error.message : String(error)}\n`,
    };
  }
}

export function parseSnapshotJson(text: string): StoreSnapshot {
  const parsed = JSON.parse(text) as unknown;
  const snapshot = unwrapSnapshot(parsed);
  if (!isRecord(snapshot)) {
    throw new Error('Snapshot JSON must be an object.');
  }

  const requiredArrays = [
    'users',
    'personas',
    'soulVersions',
    'soulSnapshots',
    'memoryItems',
    'soulUpdateProposals',
    'nodeEvents',
    'conversationMessages',
    'sessions',
    'credentials',
  ];
  for (const key of requiredArrays) {
    if (!Array.isArray(snapshot[key])) {
      throw new Error(`Snapshot JSON missing array "${key}".`);
    }
  }

  return {
    ...(snapshot as unknown as StoreSnapshot),
    opsAuditEvents: Array.isArray(snapshot['opsAuditEvents']) ? snapshot['opsAuditEvents'] : [],
  };
}

export function formatPlan(plan: PostgresScopedMigrationPlan, snapshotPath: string): string {
  const lines = [
    'Postgres scoped migration dry-run',
    `snapshot: ${snapshotPath}`,
    `ready: ${plan.ready ? 'yes' : 'no'}`,
    `totalRows: ${plan.totalRows}`,
    '',
    'Tables:',
    ...plan.tables.map((table) => `- ${table.table}: ${table.count}`),
  ];

  appendIssues(lines, 'Warnings', plan.warnings);
  appendIssues(lines, 'Errors', plan.errors);

  return `${lines.join('\n')}\n`;
}

export function createSanitizedReport(
  plan: PostgresScopedMigrationPlan,
  snapshotPath: string,
  rows?: ReturnType<typeof buildPostgresScopedMigrationRows>,
): Record<string, unknown> {
  const rowBuild = rows
    ? {
      ready: true,
      totalRows: rows.totalRows,
      tables: rows.tables.map((table) => ({ table: table.table, count: table.rows.length })),
    }
    : {
      ready: false,
      totalRows: 0,
      tables: [],
    };
  return {
    kind: 'postgres-scoped-migration-dry-run',
    snapshotPath,
    ready: plan.ready,
    totalRows: plan.totalRows,
    tables: plan.tables,
    rowBuild,
    executor: {
      readyForExecution: Boolean(rows),
      executed: false,
      requiredConfirm: EXECUTE_POSTGRES_SCOPED_MIGRATION_CONFIRM,
    },
    warnings: plan.warnings.map(sanitizeIssue),
    errors: plan.errors.map(sanitizeIssue),
  };
}

function parseArgs(args: string[]): {
  help: boolean;
  json: boolean;
  snapshotPath: string;
  reportPath?: string;
  error?: string;
} {
  const rest: string[] = [];
  let json = false;
  let reportPath: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === '--help' || arg === '-h') return { help: true, json: false, snapshotPath: '' };
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--report') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        return {
          help: false,
          json,
          snapshotPath: '',
          error: 'Missing report JSON path after --report.',
        };
      }
      reportPath = value;
      index += 1;
      continue;
    }
    rest.push(arg);
  }

  if (rest.length !== 1) {
    return {
      help: false,
      json,
      snapshotPath: '',
      ...(reportPath ? { reportPath } : {}),
      error: rest.length === 0 ? 'Missing snapshot JSON path.' : 'Expected exactly one snapshot JSON path.',
    };
  }

  return {
    help: false,
    json,
    snapshotPath: rest[0]!,
    ...(reportPath ? { reportPath } : {}),
  };
}

function unwrapSnapshot(value: unknown): unknown {
  if (!isRecord(value)) return value;
  if (isRecord(value['snapshot_json'])) return value['snapshot_json'];
  if (Array.isArray(value['rows']) && isRecord(value['rows'][0]) && isRecord(value['rows'][0]['snapshot_json'])) {
    return value['rows'][0]['snapshot_json'];
  }
  return value;
}

function appendIssues(lines: string[], title: string, issues: PostgresScopedMigrationIssue[]): void {
  lines.push('', `${title}:`);
  if (issues.length === 0) {
    lines.push('- none');
    return;
  }
  for (const issue of issues) {
    const location = [issue.table, issue.id].filter(Boolean).join(' ');
    lines.push(`- [${issue.code}]${location ? ` ${location}` : ''}: ${issue.message}`);
  }
}

function sanitizeIssue(issue: PostgresScopedMigrationIssue): Record<string, string> {
  const result: Record<string, string> = { code: issue.code };
  if (issue.table) result['table'] = issue.table;
  if (issue.id) result['id'] = issue.id;
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const currentFilePath = process.argv[1] ? resolve(process.argv[1]) : '';
if (currentFilePath && currentFilePath === fileURLToPath(import.meta.url)) {
  const result = runMigrationPlanCommand(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
