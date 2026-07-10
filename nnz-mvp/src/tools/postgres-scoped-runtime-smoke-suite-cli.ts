import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findPostgresEnvAliasConflict, readNonEmptyEnv } from '../postgres-env-alias-guard';
import { SCOPED_RUNTIME_POSTGRES_ENV } from '../runtime-persistence-config';
import {
  runScopedRuntimeHttpSmokeCommand,
  type ScopedRuntimeHttpSmokeCliResult,
} from './postgres-scoped-runtime-http-smoke-cli';
import {
  runScopedRuntimeSmokeCommand,
  type ScopedRuntimeSmokeCliResult,
} from './postgres-scoped-runtime-smoke-cli';
import { applyReleaseEnvToProcessEnv, mergeReleaseEnvFile } from './release-env-file';

const ALLOWED_DATABASE_URL_ENV = SCOPED_RUNTIME_POSTGRES_ENV;
const SUITE_CONFIRM = 'RUN_POSTGRES_SCOPED_RUNTIME_SMOKE_SUITE';
const DIRECT_SMOKE_CONFIRM = 'RUN_POSTGRES_SCOPED_RUNTIME_SMOKE';
const HTTP_SMOKE_CONFIRM = 'RUN_POSTGRES_SCOPED_RUNTIME_HTTP_SMOKE';
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3147;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_SERVER_ENTRY = 'dist-cjs/demo-server.js';

const USAGE = `Usage:
  npm run runtime:smoke-suite -- --database-url-env NNZ_POSTGRES_SCOPED_RUNTIME_URL --confirm RUN_POSTGRES_SCOPED_RUNTIME_SMOKE_SUITE
  npm run runtime:smoke-suite -- --env-file .env.release --database-url-env NNZ_POSTGRES_SCOPED_RUNTIME_URL --confirm RUN_POSTGRES_SCOPED_RUNTIME_SMOKE_SUITE

Runs the disposable scoped runtime adapter smoke, builds the demo server, then runs the real /api/me HTTP smoke.
This command refuses DATABASE_URL and NNZ_POSTGRES_URL, never prints env file paths, database URLs, tokens, user content, row payloads, or raw child process details, and uses only NNZ_POSTGRES_SCOPED_RUNTIME_URL.`;

export interface ScopedRuntimeSmokeSuiteCliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ScopedRuntimeSmokeSuiteCliDeps {
  env: Record<string, string | undefined>;
  runDirectSmoke: (args: string[]) => Promise<ScopedRuntimeSmokeCliResult>;
  buildDemo: () => Promise<void>;
  runHttpSmoke: (args: string[]) => Promise<ScopedRuntimeHttpSmokeCliResult>;
  cwd: string;
  readTextFile(path: string): string;
}

type ParsedArgs = {
  help: boolean;
  databaseUrlEnv?: string;
  confirm?: string;
  host: string;
  port: number;
  serverEntry: string;
  timeoutMs: number;
  skipBuild: boolean;
  envFile?: string;
  error?: string;
};

const DEFAULT_DEPS: ScopedRuntimeSmokeSuiteCliDeps = {
  env: process.env,
  runDirectSmoke: (args) => runScopedRuntimeSmokeCommand(args),
  buildDemo: runBuildDemo,
  runHttpSmoke: (args) => runScopedRuntimeHttpSmokeCommand(args),
  cwd: process.cwd(),
  readTextFile: (path) => readFileSync(path, 'utf8'),
};

export async function runScopedRuntimeSmokeSuiteCommand(
  args: string[],
  deps: ScopedRuntimeSmokeSuiteCliDeps = DEFAULT_DEPS,
): Promise<ScopedRuntimeSmokeSuiteCliResult> {
  const parsedArgs = parseArgs(args);
  if (parsedArgs.help) {
    return { exitCode: 0, stdout: `${USAGE}\n`, stderr: '' };
  }
  if (parsedArgs.error) {
    return { exitCode: 1, stdout: '', stderr: `${parsedArgs.error}\n\n${USAGE}\n` };
  }

  const envFileResult = mergeReleaseEnvFile(deps.env, parsedArgs.envFile, deps);
  if (envFileResult.error) {
    return { exitCode: 1, stdout: '', stderr: `${envFileResult.error}\n\n${USAGE}\n` };
  }

  const guardrailError = validateGuardrails(parsedArgs, envFileResult.env);
  if (guardrailError) {
    return { exitCode: 1, stdout: '', stderr: `${guardrailError}\n\n${USAGE}\n` };
  }

  const restoreProcessEnv = applyReleaseEnvToProcessEnv(envFileResult.env);
  try {
    const directResult = await deps.runDirectSmoke(buildDirectSmokeArgs(parsedArgs));
    if (directResult.exitCode !== 0) {
      return failSuite('direct runtime adapter smoke');
    }

    if (!parsedArgs.skipBuild) {
      try {
        await deps.buildDemo();
      } catch {
        return failSuite('demo build');
      }
    }

    const httpResult = await deps.runHttpSmoke(buildHttpSmokeArgs(parsedArgs));
    if (httpResult.exitCode !== 0) {
      return failSuite('HTTP /api/me smoke');
    }

    return {
      exitCode: 0,
      stdout: formatSuiteSummary(parsedArgs),
      stderr: '',
    };
  } finally {
    restoreProcessEnv();
  }
}

function parseArgs(args: string[]): ParsedArgs {
  let databaseUrlEnv: string | undefined;
  let confirm: string | undefined;
  let host = DEFAULT_HOST;
  let port = DEFAULT_PORT;
  let serverEntry = DEFAULT_SERVER_ENTRY;
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  let skipBuild = false;
  let envFile: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === '--help' || arg === '-h') {
      return { help: true, host, port, serverEntry, timeoutMs, skipBuild, ...(envFile ? { envFile } : {}) };
    }
    if (arg === '--skip-build') {
      skipBuild = true;
      continue;
    }
    if (
      arg === '--database-url-env'
      || arg === '--confirm'
      || arg === '--host'
      || arg === '--port'
      || arg === '--server-entry'
      || arg === '--timeout-ms'
      || arg === '--env-file'
    ) {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        return { help: false, host, port, serverEntry, timeoutMs, skipBuild, error: `Missing value after ${arg}.` };
      }
      if (arg === '--database-url-env') databaseUrlEnv = value;
      if (arg === '--confirm') confirm = value;
      if (arg === '--host') host = value;
      if (arg === '--env-file') envFile = value;
      if (arg === '--port') {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65_535) {
          return { help: false, host, port, serverEntry, timeoutMs, skipBuild, error: '--port must be an integer from 1 to 65535.' };
        }
        port = parsed;
      }
      if (arg === '--server-entry') serverEntry = value;
      if (arg === '--timeout-ms') {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed < 1_000 || parsed > 120_000) {
          return { help: false, host, port, serverEntry, timeoutMs, skipBuild, error: '--timeout-ms must be an integer from 1000 to 120000.' };
        }
        timeoutMs = parsed;
      }
      index += 1;
      continue;
    }
    return { help: false, host, port, serverEntry, timeoutMs, skipBuild, error: `Unknown argument: ${arg}.` };
  }

  return {
    help: false,
    host,
    port,
    serverEntry,
    timeoutMs,
    skipBuild,
    ...(envFile ? { envFile } : {}),
    ...(databaseUrlEnv ? { databaseUrlEnv } : {}),
    ...(confirm ? { confirm } : {}),
  };
}

function validateGuardrails(
  parsedArgs: ParsedArgs,
  env: Record<string, string | undefined>,
): string | undefined {
  if (parsedArgs.confirm !== SUITE_CONFIRM) {
    return `Smoke suite requires --confirm ${SUITE_CONFIRM}.`;
  }
  if (parsedArgs.databaseUrlEnv !== ALLOWED_DATABASE_URL_ENV) {
    return `Smoke suite requires --database-url-env ${ALLOWED_DATABASE_URL_ENV}; DATABASE_URL and NNZ_POSTGRES_URL are refused.`;
  }
  if (!readNonEmptyEnv(env, ALLOWED_DATABASE_URL_ENV)) {
    return `${ALLOWED_DATABASE_URL_ENV} is not set. Use a disposable scoped runtime Postgres database only.`;
  }
  const aliasConflict = findPostgresEnvAliasConflict(env, ALLOWED_DATABASE_URL_ENV);
  if (aliasConflict) {
    return `${ALLOWED_DATABASE_URL_ENV} must not match ${aliasConflict}. Use a disposable scoped runtime Postgres database only.`;
  }
  return undefined;
}

function buildDirectSmokeArgs(parsedArgs: ParsedArgs): string[] {
  return [
    '--database-url-env',
    parsedArgs.databaseUrlEnv!,
    '--confirm',
    DIRECT_SMOKE_CONFIRM,
  ];
}

function buildHttpSmokeArgs(parsedArgs: ParsedArgs): string[] {
  return [
    '--database-url-env',
    parsedArgs.databaseUrlEnv!,
    '--confirm',
    HTTP_SMOKE_CONFIRM,
    '--host',
    parsedArgs.host,
    '--port',
    String(parsedArgs.port),
    '--server-entry',
    parsedArgs.serverEntry,
    '--timeout-ms',
    String(parsedArgs.timeoutMs),
  ];
}

function formatSuiteSummary(parsedArgs: ParsedArgs): string {
  const lines = [
    'Postgres scoped runtime smoke suite',
    '',
    'Stages:',
    '- directRuntimeAdapterSmoke: yes',
    `- demoBuild: ${parsedArgs.skipBuild ? 'skipped' : 'yes'}`,
    '- httpApiSmoke: yes',
  ];
  return `${lines.join('\n')}\n`;
}

function failSuite(stage: string): ScopedRuntimeSmokeSuiteCliResult {
  return {
    exitCode: 1,
    stdout: '',
    stderr: `Postgres scoped runtime smoke suite failed during ${stage}.\nNo database URL, token, email, password, memory text, chat content, credential hash, row payload, child process output, server log, or raw error details were printed.\n`,
  };
}

async function runBuildDemo(): Promise<void> {
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  await new Promise<void>((resolveBuild, rejectBuild) => {
    const child = spawn(command, ['run', 'build:demo'], {
      cwd: process.cwd(),
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    child.once('error', rejectBuild);
    child.once('exit', (code) => {
      if (code === 0) {
        resolveBuild();
      } else {
        rejectBuild(new Error('demo build failed'));
      }
    });
  });
}

const currentFilePath = process.argv[1] ? resolve(process.argv[1]) : '';
if (currentFilePath && currentFilePath === fileURLToPath(import.meta.url)) {
  const result = await runScopedRuntimeSmokeSuiteCommand(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
