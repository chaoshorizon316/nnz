import pg from 'pg';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { QueryablePool } from '../domain/postgres-scoped-soul-repository';
import { findPostgresEnvAliasConflict, readNonEmptyEnv } from '../postgres-env-alias-guard';
import { createPostgresScopedRuntimePersistenceFromPool } from '../runtime/scoped-runtime-persistence';
import { SCOPED_RUNTIME_POSTGRES_ENV } from '../runtime-persistence-config';

const { Pool } = pg;

const ALLOWED_DATABASE_URL_ENV = SCOPED_RUNTIME_POSTGRES_ENV;
const SMOKE_CONFIRM = 'RUN_POSTGRES_SCOPED_RUNTIME_SMOKE';

const USAGE = `Usage:
  npm run runtime:smoke -- --database-url-env NNZ_POSTGRES_SCOPED_RUNTIME_URL --confirm RUN_POSTGRES_SCOPED_RUNTIME_SMOKE

Runs a disposable Postgres smoke for scoped runtime adapter read/write paths.
This command refuses DATABASE_URL and NNZ_POSTGRES_URL, never prints database URLs, and always attempts to clean up fixture users.`;

export interface ScopedRuntimeSmokeCliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ScopedRuntimeSmokeCliDeps {
  env: Record<string, string | undefined>;
  createPool: (connectionString: string) => PostgresScopedRuntimeSmokePool;
  runSmoke: (pool: PostgresScopedRuntimeSmokePool) => Promise<PostgresScopedRuntimeSmokeResult>;
}

export type PostgresScopedRuntimeSmokePool = QueryablePool;

export interface PostgresScopedRuntimeSmokeResult {
  kind: 'postgres-scoped-runtime-smoke';
  fixtureUsers: number;
  checks: {
    schemaReady: true;
    credentialReadback: true;
    personaReadback: true;
    runtimeContextReadback: true;
    covenantTransitions: true;
    crossScopeRejected: true;
    cascadeDelete: true;
    siblingScopePreserved: true;
    cleanupAttempted: true;
  };
}

const DEFAULT_DEPS: ScopedRuntimeSmokeCliDeps = {
  env: process.env,
  createPool: (connectionString) => new Pool({
    connectionString,
    ssl: shouldUseSsl(connectionString) ? { rejectUnauthorized: false } : undefined,
  }) as unknown as PostgresScopedRuntimeSmokePool,
  runSmoke: runPostgresScopedRuntimeSmoke,
};

export async function runScopedRuntimeSmokeCommand(
  args: string[],
  deps: ScopedRuntimeSmokeCliDeps = DEFAULT_DEPS,
): Promise<ScopedRuntimeSmokeCliResult> {
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

  const pool = deps.createPool(readNonEmptyEnv(deps.env, ALLOWED_DATABASE_URL_ENV)!);
  let result: ScopedRuntimeSmokeCliResult = { exitCode: 1, stdout: '', stderr: '' };
  try {
    const smokeResult = await deps.runSmoke(pool);
    result = {
      exitCode: 0,
      stdout: formatSmokeSummary(smokeResult),
      stderr: '',
    };
  } catch (error) {
    result = {
      exitCode: 1,
      stdout: '',
      stderr: formatSmokeError(error),
    };
  } finally {
    const closeError = await closeSmokePool(pool);
    if (closeError) {
      result = {
        exitCode: result.exitCode === 0 ? 1 : result.exitCode,
        stdout: result.stdout,
        stderr: `${result.stderr}${closeError}`,
      };
    }
  }
  return result;
}

export async function runPostgresScopedRuntimeSmoke(
  pool: PostgresScopedRuntimeSmokePool,
): Promise<PostgresScopedRuntimeSmokeResult> {
  const runId = `runtime_smoke_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const runtime = createPostgresScopedRuntimePersistenceFromPool(pool);
  const userIds: string[] = [];

  try {
    await runtime.ensureReady();
    const adapter = runtime.adapter;

    const userA = await adapter.createUser(`运行烟测 A ${runId}`);
    const userB = await adapter.createUser(`运行烟测 B ${runId}`);
    userIds.push(userA.id, userB.id);

    const emailA = `${runId}@example.test`;
    await adapter.storeCredential(userA.id, emailA, `hash-${runId}`);
    const credentialA = await adapter.getCredentialByEmail(emailA);
    assert(credentialA?.userId === userA.id, 'credential did not round-trip');

    const personaA = await adapter.createPersona({
      userId: userA.id,
      displayName: '爸爸',
      relationship: '女儿',
      type: 'DECEASED',
    });
    const personaB = await adapter.createPersona({
      userId: userB.id,
      displayName: '爸爸',
      relationship: '儿子',
      type: 'DECEASED',
    });
    const personasA = await adapter.listPersonasForUser(userA.id);
    assert(personasA.some((persona) => persona.id === personaA.id), 'persona did not round-trip');

    const scopedA = adapter.forPersona({ userId: userA.id, personaId: personaA.id });
    const scopedB = adapter.forPersona({ userId: userB.id, personaId: personaB.id });

    await scopedA.createSoulVersion({
      kernelJson: {
        affectModel: { humorLevel: 'low' },
        languageModel: { petPhrases: ['慢慢来'] },
      },
    });
    await scopedB.createSoulVersion({
      kernelJson: {
        affectModel: { humorLevel: 'medium' },
        languageModel: { petPhrases: ['你自己拿主意'] },
      },
    });

    const memoryA = await scopedA.addMemory({
      type: 'CORRECTION',
      content: `runtime scoped memory ${runId}`,
      confidence: 1,
      enabledForSoul: true,
    });
    await scopedA.addConversation({
      role: 'USER',
      content: `runtime scoped chat ${runId}`,
    });
    await scopedB.addMemory({
      type: 'DESCRIPTION',
      content: `sibling scoped memory ${runId}`,
      confidence: 1,
      enabledForSoul: true,
    });

    const activeContextA = await scopedA.getRuntimeContext();
    assert(activeContextA.state === 'ACTIVE', 'active runtime context did not round-trip');
    assert(
      activeContextA.memories.some((memory) => memory.id === memoryA.id),
      'active runtime memory did not round-trip',
    );

    const sealed = await scopedA.sealSoul();
    assert(sealed.session.state === 'SEALED', 'seal did not move session to SEALED');
    const nodeActivation = await scopedA.activateNode(`生日 ${runId}`);
    assert(nodeActivation.session.state === 'NODE', 'activateNode did not move session to NODE');
    await scopedA.addConversation({
      nodeId: nodeActivation.node.id,
      role: 'USER',
      content: `node scoped chat ${runId}`,
    });
    const nodeContextA = await scopedA.getRuntimeContext();
    assert(nodeContextA.state === 'NODE', 'node runtime context did not round-trip');
    assert(nodeContextA.nodeName === `生日 ${runId}`, 'node context name did not round-trip');

    let crossScopeRejected = false;
    try {
      await scopedB.addConversation({
        nodeId: nodeActivation.node.id,
        role: 'USER',
        content: 'This should never cross scope.',
      });
    } catch {
      crossScopeRejected = true;
    }
    assert(crossScopeRejected, 'cross-scope node conversation was accepted');

    const completed = await scopedA.completeNode();
    assert(completed.state === 'SEALED', 'completeNode did not move session back to SEALED');
    const graduatedB = await scopedB.graduateSoul();
    assert(graduatedB.state === 'GRADUATED', 'graduateSoul did not move sibling session to GRADUATED');
    assert((await scopedA.getRuntimeSession()).state === 'SEALED', 'sibling graduation affected user A');

    const countsBeforeDelete = await scopedCounts(pool, userA.id);
    assert(countsBeforeDelete['users'] === 1, 'user A was not written');
    assert(countsBeforeDelete['credentials'] === 1, 'user A credential was not written');

    await pool.query('DELETE FROM nnz_users WHERE id = $1', [userA.id]);
    removeValue(userIds, userA.id);

    const countsAfterDelete = await scopedCounts(pool, userA.id);
    assert(Object.values(countsAfterDelete).every((count) => count === 0), 'cascade delete left scoped rows behind');
    assert((await scopedB.listMemory()).length === 1, 'sibling scope was not preserved');

    return {
      kind: 'postgres-scoped-runtime-smoke',
      fixtureUsers: 2,
      checks: {
        schemaReady: true,
        credentialReadback: true,
        personaReadback: true,
        runtimeContextReadback: true,
        covenantTransitions: true,
        crossScopeRejected: true,
        cascadeDelete: true,
        siblingScopePreserved: true,
        cleanupAttempted: true,
      },
    };
  } finally {
    await cleanupSmokeRows(pool, userIds);
  }
}

type ParsedArgs = {
  help: boolean;
  databaseUrlEnv?: string;
  confirm?: string;
  error?: string;
};

function parseArgs(args: string[]): ParsedArgs {
  let databaseUrlEnv: string | undefined;
  let confirm: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--database-url-env' || arg === '--confirm') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        return { help: false, error: `Missing value after ${arg}.` };
      }
      if (arg === '--database-url-env') databaseUrlEnv = value;
      if (arg === '--confirm') confirm = value;
      index += 1;
      continue;
    }
    return { help: false, error: `Unknown argument: ${arg}.` };
  }

  return {
    help: false,
    ...(databaseUrlEnv ? { databaseUrlEnv } : {}),
    ...(confirm ? { confirm } : {}),
  };
}

function validateGuardrails(parsedArgs: ParsedArgs, env: Record<string, string | undefined>): string | undefined {
  if (parsedArgs.confirm !== SMOKE_CONFIRM) {
    return `Smoke requires --confirm ${SMOKE_CONFIRM}.`;
  }
  if (parsedArgs.databaseUrlEnv !== ALLOWED_DATABASE_URL_ENV) {
    return `Smoke requires --database-url-env ${ALLOWED_DATABASE_URL_ENV}; DATABASE_URL and NNZ_POSTGRES_URL are refused.`;
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

function formatSmokeSummary(result: PostgresScopedRuntimeSmokeResult): string {
  const lines = [
    'Postgres scoped runtime disposable smoke',
    `fixtureUsers: ${result.fixtureUsers}`,
    '',
    'Checks:',
    ...Object.entries(result.checks).map(([key, value]) => `- ${key}: ${value ? 'yes' : 'no'}`),
  ];
  return `${lines.join('\n')}\n`;
}

function formatSmokeError(error: unknown): string {
  const code = isRecord(error) && typeof error['code'] === 'string' ? ` errorCode=${error['code']}` : '';
  return `Postgres scoped runtime smoke failed.${code}\nNo database URL, fixture memory text, chat content, credential hash, row payload, or raw database error details were printed.\n`;
}

async function closeSmokePool(pool: PostgresScopedRuntimeSmokePool): Promise<string> {
  try {
    await pool.end();
    return '';
  } catch {
    return 'Postgres scoped runtime smoke failed while closing the database pool.\nNo database URL, fixture memory text, chat content, credential hash, row payload, or raw database error details were printed.\n';
  }
}

async function scopedCounts(pool: QueryablePool, userId: string): Promise<Record<string, number>> {
  const result = await pool.query<{ table_name: string; count: string }>(
    `SELECT table_name, row_count::text AS count
     FROM (
       SELECT 'users' AS table_name, COUNT(*) AS row_count FROM nnz_users WHERE id = $1
       UNION ALL
       SELECT 'personas', COUNT(*) FROM nnz_personas WHERE user_id = $1
       UNION ALL
       SELECT 'memory', COUNT(*) FROM nnz_memory_items WHERE user_id = $1
       UNION ALL
       SELECT 'soul_versions', COUNT(*) FROM nnz_soul_versions WHERE user_id = $1
       UNION ALL
       SELECT 'snapshots', COUNT(*) FROM nnz_soul_snapshots WHERE user_id = $1
       UNION ALL
       SELECT 'nodes', COUNT(*) FROM nnz_node_events WHERE user_id = $1
       UNION ALL
       SELECT 'conversations', COUNT(*) FROM nnz_conversation_messages WHERE user_id = $1
       UNION ALL
       SELECT 'sessions', COUNT(*) FROM nnz_runtime_sessions WHERE user_id = $1
       UNION ALL
       SELECT 'credentials', COUNT(*) FROM nnz_credentials WHERE user_id = $1
     ) counts`,
    [userId],
  );
  return Object.fromEntries(result.rows.map((row) => [row.table_name, Number(row.count)]));
}

async function cleanupSmokeRows(pool: QueryablePool, userIds: string[]): Promise<void> {
  for (const userId of userIds) {
    await pool.query('DELETE FROM nnz_users WHERE id = $1', [userId]);
  }
}

function removeValue(values: string[], value: string): void {
  const index = values.indexOf(value);
  if (index >= 0) values.splice(index, 1);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function shouldUseSsl(connectionString: string): boolean {
  if (connectionString.includes('sslmode=disable')) return false;
  return connectionString.startsWith('postgres://') || connectionString.startsWith('postgresql://');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const currentFilePath = process.argv[1] ? resolve(process.argv[1]) : '';
if (currentFilePath && currentFilePath === fileURLToPath(import.meta.url)) {
  const result = await runScopedRuntimeSmokeCommand(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
