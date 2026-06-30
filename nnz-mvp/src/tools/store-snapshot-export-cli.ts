import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { StoreSnapshot } from '../domain/persistence';
import { loadStore } from '../domain/persistence';
import { InMemorySoulStore } from '../domain/soul-store';
import { parseSnapshotJson } from './postgres-scoped-migration-plan-cli';

export interface StoreSnapshotExportCliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface StoreSnapshotExportDeps {
  exists: (path: string) => boolean;
  readTextFile: (path: string) => string;
  writeTextFile: (path: string, text: string) => void;
  loadSnapshotFromSqlite: (path: string) => StoreSnapshot | undefined;
}

const USAGE = `Usage:
  npm run snapshot:export -- --from-sqlite <sqlite-db-path> --out <snapshot-json-path>
  npm run snapshot:export -- --from-json <snapshot-or-wrapper-json-path> --out <snapshot-json-path>

This command is offline only: it does not read DATABASE_URL, NNZ_POSTGRES_URL, or connect to Postgres.
The exported snapshot contains raw local memory, chat, credential hashes, and ops audit data. Keep it local.
Use npm run migration:plan -- --report <report-json-path> <snapshot-json-path> for sanitized review.`;

const DEFAULT_DEPS: StoreSnapshotExportDeps = {
  exists: existsSync,
  readTextFile: (path) => readFileSync(path, 'utf8'),
  writeTextFile: (path, text) => writeFileSync(path, text),
  loadSnapshotFromSqlite: loadSnapshotFromSqliteFile,
};

export function runStoreSnapshotExportCommand(
  args: string[],
  deps: StoreSnapshotExportDeps = DEFAULT_DEPS,
): StoreSnapshotExportCliResult {
  const parsedArgs = parseArgs(args);
  if (parsedArgs.help) {
    return { exitCode: 0, stdout: `${USAGE}\n`, stderr: '' };
  }
  if (parsedArgs.error) {
    return { exitCode: 1, stdout: '', stderr: `${parsedArgs.error}\n\n${USAGE}\n` };
  }

  const inputPath = resolve(parsedArgs.inputPath);
  const outputPath = resolve(parsedArgs.outputPath);
  if (!deps.exists(inputPath)) {
    return { exitCode: 1, stdout: '', stderr: `Input file does not exist: ${inputPath}\n` };
  }
  if (deps.exists(outputPath) && !parsedArgs.force) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `Output file already exists: ${outputPath}. Pass --force to overwrite.\n`,
    };
  }

  try {
    const snapshot = parsedArgs.source === 'sqlite'
      ? deps.loadSnapshotFromSqlite(inputPath)
      : parseSnapshotJson(deps.readTextFile(inputPath));

    if (!snapshot) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: `No StoreSnapshot data found in ${inputPath}.\n`,
      };
    }

    deps.writeTextFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`);
    return {
      exitCode: 0,
      stdout: formatExportSummary(snapshot, parsedArgs.source, inputPath, outputPath),
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

function parseArgs(args: string[]): {
  help: boolean;
  source: 'json' | 'sqlite';
  inputPath: string;
  outputPath: string;
  force: boolean;
  error?: string;
} {
  let source: 'json' | 'sqlite' | undefined;
  let inputPath: string | undefined;
  let outputPath: string | undefined;
  let force = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === '--help' || arg === '-h') {
      return { help: true, source: 'json', inputPath: '', outputPath: '', force: false };
    }
    if (arg === '--force') {
      force = true;
      continue;
    }
    if (arg === '--from-json' || arg === '--from-sqlite') {
      if (source) {
        return {
          help: false,
          source: 'json',
          inputPath: '',
          outputPath: '',
          force,
          error: 'Pass exactly one input source: --from-json or --from-sqlite.',
        };
      }
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        return {
          help: false,
          source: 'json',
          inputPath: '',
          outputPath: '',
          force,
          error: `Missing path after ${arg}.`,
        };
      }
      source = arg === '--from-json' ? 'json' : 'sqlite';
      inputPath = value;
      index += 1;
      continue;
    }
    if (arg === '--out') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        return {
          help: false,
          source: 'json',
          inputPath: '',
          outputPath: '',
          force,
          error: 'Missing output JSON path after --out.',
        };
      }
      outputPath = value;
      index += 1;
      continue;
    }
    return {
      help: false,
      source: 'json',
      inputPath: '',
      outputPath: '',
      force,
      error: `Unknown argument: ${arg}.`,
    };
  }

  if (!source || !inputPath) {
    return {
      help: false,
      source: 'json',
      inputPath: '',
      outputPath: '',
      force,
      error: 'Missing input source. Pass --from-json or --from-sqlite.',
    };
  }
  if (!outputPath) {
    return {
      help: false,
      source,
      inputPath,
      outputPath: '',
      force,
      error: 'Missing output path. Pass --out <snapshot-json-path>.',
    };
  }

  return { help: false, source, inputPath, outputPath, force };
}

function loadSnapshotFromSqliteFile(path: string): StoreSnapshot | undefined {
  const store = new InMemorySoulStore();
  return loadStore(store, path) ? store.serialize() : undefined;
}

function formatExportSummary(
  snapshot: StoreSnapshot,
  source: 'json' | 'sqlite',
  inputPath: string,
  outputPath: string,
): string {
  const lines = [
    'StoreSnapshot export',
    `source: ${source}`,
    `input: ${inputPath}`,
    `output: ${outputPath}`,
    '',
    'Counts:',
    `- users: ${snapshot.users.length}`,
    `- personas: ${snapshot.personas.length}`,
    `- soulVersions: ${snapshot.soulVersions.length}`,
    `- soulSnapshots: ${snapshot.soulSnapshots.length}`,
    `- memoryItems: ${snapshot.memoryItems.length}`,
    `- soulUpdateProposals: ${snapshot.soulUpdateProposals.length}`,
    `- nodeEvents: ${snapshot.nodeEvents.length}`,
    `- conversationMessages: ${snapshot.conversationMessages.length}`,
    `- sessions: ${snapshot.sessions.length}`,
    `- credentials: ${snapshot.credentials.length}`,
    `- opsAuditEvents: ${snapshot.opsAuditEvents.length}`,
    '',
    'Next:',
    `npm run migration:plan -- --report <report-json-path> ${outputPath}`,
  ];
  return `${lines.join('\n')}\n`;
}

const currentFilePath = process.argv[1] ? resolve(process.argv[1]) : '';
if (currentFilePath && currentFilePath === fileURLToPath(import.meta.url)) {
  const result = runStoreSnapshotExportCommand(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
