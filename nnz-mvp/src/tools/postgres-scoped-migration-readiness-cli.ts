import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { StoreSnapshot } from '../domain/persistence';
import { loadStore } from '../domain/persistence';
import { planPostgresScopedMigration } from '../domain/postgres-scoped-migration-plan';
import { buildPostgresScopedMigrationRows } from '../domain/postgres-scoped-migration-rows';
import { InMemorySoulStore } from '../domain/soul-store';
import {
  createSanitizedReport,
  createSanitizedSummary,
  parseSnapshotJson,
} from './postgres-scoped-migration-plan-cli';

export interface MigrationReadinessCliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface MigrationReadinessCliDeps {
  exists: (path: string) => boolean;
  readTextFile: (path: string) => string;
  writeTextFile: (path: string, text: string) => void;
  loadSnapshotFromSqlite: (path: string) => StoreSnapshot | undefined;
}

const USAGE = `Usage:
  npm run migration:readiness -- --from-json <snapshot-or-wrapper-json-path> --snapshot-out <raw-snapshot-json-path> --report-out <sanitized-report-json-path> --summary-out <sanitized-summary-json-path>
  npm run migration:readiness -- --from-sqlite <sqlite-db-path> --snapshot-out <raw-snapshot-json-path> --report-out <sanitized-report-json-path> --summary-out <sanitized-summary-json-path>

This command is offline only: it does not read DATABASE_URL, NNZ_POSTGRES_URL, NNZ_POSTGRES_INTEGRATION_URL, or connect to Postgres.
The snapshot output is a raw local StoreSnapshot and may contain memory text, chat content, credential hashes, and ops audit metadata.
The report and summary outputs are sanitized and contain counts, issue codes, table names, and execution readiness only.`;

const DEFAULT_DEPS: MigrationReadinessCliDeps = {
  exists: existsSync,
  readTextFile: (path) => readFileSync(path, 'utf8'),
  writeTextFile: (path, text) => writeFileSync(path, text),
  loadSnapshotFromSqlite: loadSnapshotFromSqliteFile,
};

export function runMigrationReadinessCommand(
  args: string[],
  deps: MigrationReadinessCliDeps = DEFAULT_DEPS,
): MigrationReadinessCliResult {
  const parsedArgs = parseArgs(args);
  if (parsedArgs.help) {
    return { exitCode: 0, stdout: `${USAGE}\n`, stderr: '' };
  }
  if (parsedArgs.error) {
    return { exitCode: 1, stdout: '', stderr: `${parsedArgs.error}\n\n${USAGE}\n` };
  }

  const inputPath = resolve(parsedArgs.inputPath);
  const snapshotOut = resolve(parsedArgs.snapshotOut);
  const reportOut = resolve(parsedArgs.reportOut);
  const summaryOut = resolve(parsedArgs.summaryOut);
  const outputPaths = [snapshotOut, reportOut, summaryOut];

  if (!deps.exists(inputPath)) {
    return { exitCode: 1, stdout: '', stderr: `Input file does not exist: ${inputPath}\n` };
  }
  if (new Set(outputPaths).size !== outputPaths.length) {
    return { exitCode: 1, stdout: '', stderr: 'Output paths must be distinct.\n' };
  }
  if (outputPaths.includes(inputPath)) {
    return { exitCode: 1, stdout: '', stderr: 'Output paths must not overwrite the input path.\n' };
  }
  if (!parsedArgs.force) {
    const existingOutput = outputPaths.find((path) => deps.exists(path));
    if (existingOutput) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: `Output file already exists: ${existingOutput}. Pass --force to overwrite readiness outputs.\n`,
      };
    }
  }

  try {
    const snapshot = parsedArgs.source === 'sqlite'
      ? deps.loadSnapshotFromSqlite(inputPath)
      : parseSnapshotJson(deps.readTextFile(inputPath));

    if (!snapshot) {
      return { exitCode: 1, stdout: '', stderr: `No StoreSnapshot data found in ${inputPath}.\n` };
    }

    const plan = planPostgresScopedMigration(snapshot);
    const rows = plan.ready ? buildPostgresScopedMigrationRows(snapshot) : undefined;
    const summary = createReadinessSummary({
      source: parsedArgs.source,
      inputPath,
      snapshotOut,
      reportOut,
      summaryOut,
      summary: createSanitizedSummary(plan, rows),
    });
    const report = createSanitizedReport(plan, snapshotOut, rows);

    deps.writeTextFile(snapshotOut, `${JSON.stringify(snapshot, null, 2)}\n`);
    deps.writeTextFile(reportOut, `${JSON.stringify(report, null, 2)}\n`);
    deps.writeTextFile(summaryOut, `${JSON.stringify(summary, null, 2)}\n`);

    return {
      exitCode: plan.ready ? 0 : 2,
      stdout: formatReadinessSummary(summary),
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

type ParsedArgs = {
  help: boolean;
  source: 'json' | 'sqlite';
  inputPath: string;
  snapshotOut: string;
  reportOut: string;
  summaryOut: string;
  force: boolean;
  error?: string;
};

function parseArgs(args: string[]): ParsedArgs {
  let source: 'json' | 'sqlite' | undefined;
  let inputPath: string | undefined;
  let snapshotOut: string | undefined;
  let reportOut: string | undefined;
  let summaryOut: string | undefined;
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
    if (arg === '--snapshot-out' || arg === '--report-out' || arg === '--summary-out') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        return errorResult(`Missing path after ${arg}.`, force);
      }
      if (arg === '--snapshot-out') snapshotOut = value;
      if (arg === '--report-out') reportOut = value;
      if (arg === '--summary-out') summaryOut = value;
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

function createReadinessSummary(input: {
  source: 'json' | 'sqlite';
  inputPath: string;
  snapshotOut: string;
  reportOut: string;
  summaryOut: string;
  summary: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    source: input.source,
    inputPath: input.inputPath,
    snapshotPath: input.snapshotOut,
    reportPath: input.reportOut,
    summaryPath: input.summaryOut,
    ...input.summary,
    kind: 'postgres-scoped-migration-readiness-summary',
    nextCommands: {
      reviewReport: `open ${input.reportOut}`,
      protectedDryRun: `npm run migration:execute -- --snapshot ${input.snapshotOut}`,
      disposableExecution: `NNZ_POSTGRES_INTEGRATION_URL=<disposable-postgres-url> npm run migration:execute -- --snapshot ${input.snapshotOut} --execute --database-url-env NNZ_POSTGRES_INTEGRATION_URL --confirm EXECUTE_POSTGRES_SCOPED_MIGRATION`,
    },
  };
}

function formatReadinessSummary(summary: Record<string, unknown>): string {
  const lines = [
    'Postgres scoped migration readiness',
    `source: ${summary['source']}`,
    `input: ${summary['inputPath']}`,
    `snapshotOut: ${summary['snapshotPath']}`,
    `reportOut: ${summary['reportPath']}`,
    `summaryOut: ${summary['summaryPath']}`,
    `ready: ${summary['ready'] === true ? 'yes' : 'no'}`,
    `totalRows: ${summary['totalRows']}`,
    `warningCount: ${summary['warningCount']}`,
    `errorCount: ${summary['errorCount']}`,
    `rowBuildReady: ${summary['rowBuildReady'] === true ? 'yes' : 'no'}`,
    `executorReady: ${summary['executorReady'] === true ? 'yes' : 'no'}`,
    `nextAction: ${summary['nextAction']}`,
    '',
    'Outputs:',
    `- raw snapshot: ${summary['snapshotPath']}`,
    `- sanitized report: ${summary['reportPath']}`,
    `- sanitized summary: ${summary['summaryPath']}`,
  ];
  return `${lines.join('\n')}\n`;
}

function loadSnapshotFromSqliteFile(path: string): StoreSnapshot | undefined {
  const store = new InMemorySoulStore();
  return loadStore(store, path) ? store.serialize() : undefined;
}

const currentFilePath = process.argv[1] ? resolve(process.argv[1]) : '';
if (currentFilePath && currentFilePath === fileURLToPath(import.meta.url)) {
  const result = runMigrationReadinessCommand(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
