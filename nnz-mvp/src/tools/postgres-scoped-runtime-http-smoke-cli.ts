import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findPostgresEnvAliasConflict, readNonEmptyEnv } from '../postgres-env-alias-guard';
import {
  RUNTIME_PERSISTENCE_MODE_ENV,
  SCOPED_RUNTIME_POSTGRES_ENV,
} from '../runtime-persistence-config';

const ALLOWED_DATABASE_URL_ENV = SCOPED_RUNTIME_POSTGRES_ENV;
const HTTP_SMOKE_CONFIRM = 'RUN_POSTGRES_SCOPED_RUNTIME_HTTP_SMOKE';
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3147;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_SERVER_ENTRY = 'dist-cjs/demo-server.js';

const USAGE = `Usage:
  npm run runtime:http-smoke -- --database-url-env NNZ_POSTGRES_SCOPED_RUNTIME_URL --confirm RUN_POSTGRES_SCOPED_RUNTIME_HTTP_SMOKE

Runs a disposable scoped Postgres smoke through the real /api/me HTTP surface.
Build first with npm run build:demo. This command refuses DATABASE_URL and NNZ_POSTGRES_URL, never prints database URLs, and attempts to delete its fixture user through /api/me/delete.`;

export interface ScopedRuntimeHttpSmokeCliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ScopedRuntimeHttpSmokeConfig {
  databaseUrl: string;
  host: string;
  port: number;
  serverEntry: string;
  timeoutMs: number;
  env: Record<string, string | undefined>;
}

export interface ScopedRuntimeHttpSmokeCliDeps {
  env: Record<string, string | undefined>;
  runSmoke: (config: ScopedRuntimeHttpSmokeConfig) => Promise<ScopedRuntimeHttpSmokeResult>;
}

export interface ScopedRuntimeHttpSmokeResult {
  kind: 'postgres-scoped-runtime-http-smoke';
  fixtureUsers: number;
  checks: {
    serverStarted: true;
    healthzScopedPostgres: true;
    registerLogin: true;
    personaCreate: true;
    memoryAppend: true;
    chatHistory: true;
    covenantTransitions: true;
    exportContainsOwnData: true;
    exportRedactsCredentialHash: true;
    deleteCurrentUser: true;
    cleanupAttempted: true;
  };
}

type ParsedArgs = {
  help: boolean;
  databaseUrlEnv?: string;
  confirm?: string;
  host: string;
  port: number;
  serverEntry: string;
  timeoutMs: number;
  error?: string;
};

interface ServerHandle {
  process: ChildProcess;
  output: () => string;
}

interface HttpResponse<T> {
  status: number;
  body: T;
  raw: string;
}

const DEFAULT_DEPS: ScopedRuntimeHttpSmokeCliDeps = {
  env: process.env,
  runSmoke: runPostgresScopedRuntimeHttpSmoke,
};

export async function runScopedRuntimeHttpSmokeCommand(
  args: string[],
  deps: ScopedRuntimeHttpSmokeCliDeps = DEFAULT_DEPS,
): Promise<ScopedRuntimeHttpSmokeCliResult> {
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

  try {
    const smokeResult = await deps.runSmoke({
      databaseUrl: readNonEmptyEnv(deps.env, ALLOWED_DATABASE_URL_ENV)!,
      host: parsedArgs.host,
      port: parsedArgs.port,
      serverEntry: parsedArgs.serverEntry,
      timeoutMs: parsedArgs.timeoutMs,
      env: deps.env,
    });
    return {
      exitCode: 0,
      stdout: formatSmokeSummary(smokeResult),
      stderr: '',
    };
  } catch (error) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: formatSmokeError(error),
    };
  }
}

export async function runPostgresScopedRuntimeHttpSmoke(
  config: ScopedRuntimeHttpSmokeConfig,
): Promise<ScopedRuntimeHttpSmokeResult> {
  const serverEntry = resolve(process.cwd(), config.serverEntry);
  if (!existsSync(serverEntry)) {
    throw new Error('demo server build output was not found');
  }

  const baseUrl = `http://${config.host}:${config.port}`;
  const runId = `runtime-http-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `${runId}@example.test`;
  const password = `SmokePass-${runId}`;
  const description = `private http smoke memory ${runId}`;
  const supplementalMemory = `private http smoke supplemental memory ${runId}`;
  const chatMessage = `private http smoke chat ${runId}`;
  const nodeName = `重要时刻 ${runId}`;
  let token = '';
  let cleanupAttempted = false;
  let server: ServerHandle | undefined;

  try {
    server = startDemoServer(config, serverEntry);
    await waitForHealthz(baseUrl, config.timeoutMs);

    const health = await requestJson<{
      ok?: boolean;
      persistence?: {
        mode?: string;
        runtimeMode?: string;
        scopedPostgresEnv?: string | null;
      };
    }>(baseUrl, '/healthz');
    assert(health.body.ok === true, 'healthz did not report ok');
    assert(health.body.persistence?.mode === 'scoped-postgres', 'healthz did not use scoped Postgres mode');
    assert(health.body.persistence?.runtimeMode === 'scoped', 'healthz did not report scoped runtime mode');
    assert(
      health.body.persistence?.scopedPostgresEnv === SCOPED_RUNTIME_POSTGRES_ENV,
      'healthz did not report the scoped runtime env key',
    );

    const registered = await requestJson<{ token?: string }>(baseUrl, '/api/register', {
      method: 'POST',
      body: { email, password },
    });
    assert(typeof registered.body.token === 'string', 'register did not return a token');
    token = registered.body.token;

    const persona = await requestJson<{ persona?: { id?: string } }>(baseUrl, '/api/me/persona', {
      method: 'POST',
      token,
      body: {
        displayName: '爸爸',
        relationship: '女儿',
        description,
        traits: { humorLevel: 'medium' },
        consentAccepted: true,
      },
    });
    const personaId = persona.body.persona?.id;
    assert(typeof personaId === 'string' && personaId.length > 0, 'persona create did not return an id');

    await requestJson(baseUrl, '/api/me/memory', {
      method: 'POST',
      token,
      body: { personaId, content: supplementalMemory },
    });

    await requestJson(baseUrl, '/api/me/chat', {
      method: 'POST',
      token,
      body: { personaId, message: chatMessage },
    });
    const history = await requestJson<{ messages?: unknown[] }>(
      baseUrl,
      `/api/me/chat-history?personaId=${encodeURIComponent(personaId)}`,
      { token },
    );
    assert(Array.isArray(history.body.messages) && history.body.messages.length >= 2, 'chat history did not round-trip');

    await requestJson(baseUrl, '/api/me/seal', {
      method: 'POST',
      token,
      body: { personaId },
    });
    await requestJson(baseUrl, '/api/me/activate-node', {
      method: 'POST',
      token,
      body: { personaId, nodeName },
    });
    await requestJson(baseUrl, '/api/me/complete-node', {
      method: 'POST',
      token,
      body: { personaId },
    });
    await requestJson(baseUrl, '/api/me/graduate', {
      method: 'POST',
      token,
      body: { personaId },
    });

    const exported = await requestJson<{ export?: unknown }>(baseUrl, '/api/me/export', { token });
    const exportedJson = JSON.stringify(exported.body);
    assert(exportedJson.includes(description), 'export did not include own memory text');
    assert(exportedJson.includes(supplementalMemory), 'export did not include supplemental memory text');
    assert(exportedJson.includes(chatMessage), 'export did not include own chat text');
    assert(!exportedJson.includes('passwordHash'), 'export leaked the credential hash key');
    assert(!exportedJson.includes(password), 'export leaked the raw password');

    cleanupAttempted = true;
    await requestJson(baseUrl, '/api/me/delete', {
      method: 'POST',
      token,
      body: { confirm: 'DELETE_MY_DATA' },
    });

    const afterDelete = await requestJson(baseUrl, '/api/me/export', {
      token,
      allowStatuses: [404],
    });
    assert(afterDelete.status === 404, 'deleted user export did not return 404');
    token = '';

    return {
      kind: 'postgres-scoped-runtime-http-smoke',
      fixtureUsers: 1,
      checks: {
        serverStarted: true,
        healthzScopedPostgres: true,
        registerLogin: true,
        personaCreate: true,
        memoryAppend: true,
        chatHistory: true,
        covenantTransitions: true,
        exportContainsOwnData: true,
        exportRedactsCredentialHash: true,
        deleteCurrentUser: true,
        cleanupAttempted: cleanupAttempted as true,
      },
    };
  } finally {
    if (token) {
      cleanupAttempted = true;
      await requestJson(baseUrl, '/api/me/delete', {
        method: 'POST',
        token,
        body: { confirm: 'DELETE_MY_DATA' },
        allowStatuses: [200, 404],
      }).catch(() => undefined);
    }
    if (server) {
      await stopDemoServer(server);
    }
  }
}

function parseArgs(args: string[]): ParsedArgs {
  let databaseUrlEnv: string | undefined;
  let confirm: string | undefined;
  let host = DEFAULT_HOST;
  let port = DEFAULT_PORT;
  let serverEntry = DEFAULT_SERVER_ENTRY;
  let timeoutMs = DEFAULT_TIMEOUT_MS;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === '--help' || arg === '-h') {
      return { help: true, host, port, serverEntry, timeoutMs };
    }
    if (
      arg === '--database-url-env'
      || arg === '--confirm'
      || arg === '--host'
      || arg === '--port'
      || arg === '--server-entry'
      || arg === '--timeout-ms'
    ) {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        return { help: false, host, port, serverEntry, timeoutMs, error: `Missing value after ${arg}.` };
      }
      if (arg === '--database-url-env') databaseUrlEnv = value;
      if (arg === '--confirm') confirm = value;
      if (arg === '--host') host = value;
      if (arg === '--port') {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65_535) {
          return { help: false, host, port, serverEntry, timeoutMs, error: '--port must be an integer from 1 to 65535.' };
        }
        port = parsed;
      }
      if (arg === '--server-entry') serverEntry = value;
      if (arg === '--timeout-ms') {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed < 1_000 || parsed > 120_000) {
          return { help: false, host, port, serverEntry, timeoutMs, error: '--timeout-ms must be an integer from 1000 to 120000.' };
        }
        timeoutMs = parsed;
      }
      index += 1;
      continue;
    }
    return { help: false, host, port, serverEntry, timeoutMs, error: `Unknown argument: ${arg}.` };
  }

  return {
    help: false,
    host,
    port,
    serverEntry,
    timeoutMs,
    ...(databaseUrlEnv ? { databaseUrlEnv } : {}),
    ...(confirm ? { confirm } : {}),
  };
}

function validateGuardrails(
  parsedArgs: ParsedArgs,
  env: Record<string, string | undefined>,
): string | undefined {
  if (parsedArgs.confirm !== HTTP_SMOKE_CONFIRM) {
    return `HTTP smoke requires --confirm ${HTTP_SMOKE_CONFIRM}.`;
  }
  if (parsedArgs.databaseUrlEnv !== ALLOWED_DATABASE_URL_ENV) {
    return `HTTP smoke requires --database-url-env ${ALLOWED_DATABASE_URL_ENV}; DATABASE_URL and NNZ_POSTGRES_URL are refused.`;
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

function startDemoServer(config: ScopedRuntimeHttpSmokeConfig, serverEntry: string): ServerHandle {
  const output: string[] = [];
  const childEnv = buildScopedRuntimeHttpSmokeChildEnv(config);
  const child = spawn(process.execPath, [serverEntry], {
    cwd: process.cwd(),
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => {
    output.push(String(chunk));
  });
  child.stderr.on('data', (chunk) => {
    output.push(String(chunk));
  });
  return {
    process: child,
    output: () => output.join('').slice(-4000),
  };
}

export function buildScopedRuntimeHttpSmokeChildEnv(config: ScopedRuntimeHttpSmokeConfig): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(config.env)) {
    if (value !== undefined) env[key] = value;
  }
  env[RUNTIME_PERSISTENCE_MODE_ENV] = 'scoped';
  env[SCOPED_RUNTIME_POSTGRES_ENV] = config.databaseUrl;
  env.HOST = config.host;
  env.PORT = String(config.port);
  env.DATABASE_URL = '';
  env.NNZ_POSTGRES_URL = '';
  env.NNZ_DB_PATH = '';
  env.NNZ_LLM_API_KEY = '';
  env.NNZ_LLM_BASE_URL = '';
  env.NNZ_LLM_MODEL = '';
  return env;
}

async function waitForHealthz(baseUrl: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const health = await requestJson(baseUrl, '/healthz', { allowStatuses: [200, 500] });
      if (health.status === 200) return;
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw Object.assign(new Error('server did not become ready'), { cause: lastError });
}

async function requestJson<T = unknown>(
  baseUrl: string,
  path: string,
  options: {
    method?: string;
    token?: string;
    body?: unknown;
    allowStatuses?: number[];
  } = {},
): Promise<HttpResponse<T>> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const raw = await response.text();
  const body = raw ? JSON.parse(raw) as T : {} as T;
  const allowed = options.allowStatuses ?? [200, 201];
  if (!allowed.includes(response.status)) {
    throw Object.assign(new Error('unexpected HTTP status'), { status: response.status });
  }
  return { status: response.status, body, raw };
}

async function stopDemoServer(server: ServerHandle): Promise<void> {
  if (server.process.exitCode !== null || server.process.killed) return;
  await new Promise<void>((resolveStop) => {
    const timeout = setTimeout(() => {
      if (!server.process.killed) server.process.kill('SIGKILL');
      resolveStop();
    }, 2000);
    server.process.once('exit', () => {
      clearTimeout(timeout);
      resolveStop();
    });
    server.process.kill('SIGTERM');
  });
}

function formatSmokeSummary(result: ScopedRuntimeHttpSmokeResult): string {
  const lines = [
    'Postgres scoped runtime HTTP disposable smoke',
    `fixtureUsers: ${result.fixtureUsers}`,
    '',
    'Checks:',
    ...Object.entries(result.checks).map(([key, value]) => `- ${key}: ${value ? 'yes' : 'no'}`),
  ];
  return `${lines.join('\n')}\n`;
}

function formatSmokeError(error: unknown): string {
  const status = isRecord(error) && typeof error['status'] === 'number' ? ` httpStatus=${error['status']}` : '';
  const code = isRecord(error) && typeof error['code'] === 'string' ? ` errorCode=${error['code']}` : '';
  return `Postgres scoped runtime HTTP smoke failed.${status}${code}\nNo database URL, token, email, password, memory text, chat content, credential hash, row payload, server log, or raw error details were printed.\n`;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const currentFilePath = process.argv[1] ? resolve(process.argv[1]) : '';
if (currentFilePath && currentFilePath === fileURLToPath(import.meta.url)) {
  const result = await runScopedRuntimeHttpSmokeCommand(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
