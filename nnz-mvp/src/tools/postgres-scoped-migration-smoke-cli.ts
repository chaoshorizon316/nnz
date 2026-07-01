import pg from 'pg';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { StoreSnapshot } from '../domain/persistence';
import {
  EXECUTE_POSTGRES_SCOPED_MIGRATION_CONFIRM,
  executePostgresScopedMigration,
  type PostgresScopedMigrationPool,
} from '../domain/postgres-scoped-migration-executor';
import {
  createPostgresScopedSoulRepositoryFromPool,
  type QueryablePool,
} from '../domain/postgres-scoped-soul-repository';
import { InMemorySoulStore } from '../domain/soul-store';
import type { NodeEvent, Persona, User } from '../domain/types';

const { Pool } = pg;

const ALLOWED_DATABASE_URL_ENV = 'NNZ_POSTGRES_INTEGRATION_URL';
const SMOKE_CONFIRM = 'RUN_POSTGRES_SCOPED_MIGRATION_SMOKE';

const USAGE = `Usage:
  npm run migration:smoke -- --database-url-env NNZ_POSTGRES_INTEGRATION_URL --confirm RUN_POSTGRES_SCOPED_MIGRATION_SMOKE

Runs a disposable Postgres smoke for scoped migration execution and repository readback.
This command refuses DATABASE_URL and NNZ_POSTGRES_URL, never prints database URLs, and always attempts to clean up fixture users and audit rows.`;

export interface MigrationSmokeCliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface MigrationSmokeCliDeps {
  env: Record<string, string | undefined>;
  createPool: (connectionString: string) => PostgresScopedMigrationSmokePool;
  runSmoke: (pool: PostgresScopedMigrationSmokePool) => Promise<PostgresScopedMigrationSmokeResult>;
}

export type PostgresScopedMigrationSmokePool = PostgresScopedMigrationPool & QueryablePool;

export interface PostgresScopedMigrationSmokeResult {
  kind: 'postgres-scoped-migration-smoke';
  committed: true;
  totalRows: number;
  checks: {
    idempotentExecution: true;
    repositoryReadback: true;
    crossScopeRejected: true;
    cascadeDelete: true;
    siblingScopePreserved: true;
    auditRowWritten: true;
    cleanupAttempted: true;
  };
}

const DEFAULT_DEPS: MigrationSmokeCliDeps = {
  env: process.env,
  createPool: (connectionString) => new Pool({
    connectionString,
    ssl: shouldUseSsl(connectionString) ? { rejectUnauthorized: false } : undefined,
  }) as unknown as PostgresScopedMigrationSmokePool,
  runSmoke: runPostgresScopedMigrationSmoke,
};

export async function runMigrationSmokeCommand(
  args: string[],
  deps: MigrationSmokeCliDeps = DEFAULT_DEPS,
): Promise<MigrationSmokeCliResult> {
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

  const pool = deps.createPool(deps.env[ALLOWED_DATABASE_URL_ENV]!);
  try {
    const result = await deps.runSmoke(pool);
    return {
      exitCode: 0,
      stdout: formatSmokeSummary(result),
      stderr: '',
    };
  } catch (error) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: formatSmokeError(error),
    };
  } finally {
    await pool.end();
  }
}

export async function runPostgresScopedMigrationSmoke(
  pool: PostgresScopedMigrationSmokePool,
): Promise<PostgresScopedMigrationSmokeResult> {
  const fixture = createSnapshotFixture();
  const userIds = [fixture.userA.id, fixture.userB.id];
  const auditIds = [fixture.auditId];

  try {
    const firstResult = await executePostgresScopedMigration(pool, fixture.snapshot, {
      confirm: EXECUTE_POSTGRES_SCOPED_MIGRATION_CONFIRM,
      migratedAt: '2026-07-01T00:00:00.000Z',
    });
    const secondResult = await executePostgresScopedMigration(pool, fixture.snapshot, {
      confirm: EXECUTE_POSTGRES_SCOPED_MIGRATION_CONFIRM,
      ensureSchema: false,
      migratedAt: '2026-07-01T00:00:00.000Z',
    });
    assert(firstResult.committed, 'migration did not commit');
    assert(secondResult.totalRows === firstResult.totalRows, 'migration was not idempotent');

    const repoA = createPostgresScopedSoulRepositoryFromPool(pool, {
      userId: fixture.userA.id,
      personaId: fixture.personaA.id,
    });
    const repoB = createPostgresScopedSoulRepositoryFromPool(pool, {
      userId: fixture.userB.id,
      personaId: fixture.personaB.id,
    });

    let crossScopeRejected = false;
    try {
      await repoB.addConversation({
        nodeId: fixture.nodeA.id,
        role: 'USER',
        content: 'This should never cross scope.',
      });
    } catch {
      crossScopeRejected = true;
    }
    assert(crossScopeRejected, 'cross-scope node conversation was accepted');

    const sessionA = await repoA.getRuntimeSession();
    const snapshotA = await repoA.getSoulSnapshot(fixture.soulSnapshotAId);
    const memoryA = await repoA.listMemory();
    const conversationsA = await repoA.listConversations();
    const proposalsA = await repoA.listSoulUpdateProposals();
    const credentialA = await repoA.getCredentialByEmail(fixture.emailA);
    const sessionB = await repoB.getRuntimeSession();
    const memoryB = await repoB.listMemory();

    assert(sessionA.state === 'NODE', 'user A session was not NODE');
    assert(sessionA.soulSnapshotId === fixture.soulSnapshotAId, 'user A session lost snapshot');
    assert(snapshotA.memoryIds.length === 1 && snapshotA.memoryIds[0] === fixture.memoryAId, 'snapshot memory ids did not round-trip');
    assert(memoryA.length === 2, 'user A memory count mismatch');
    assert(conversationsA.length === 2, 'user A conversation count mismatch');
    assert(proposalsA.length === 1 && proposalsA[0]?.status === 'PENDING', 'proposal did not round-trip');
    assert(credentialA?.userId === fixture.userA.id, 'credential did not round-trip');
    assert(sessionB.state === 'ACTIVE', 'user B session was not preserved as ACTIVE');
    assert(memoryB.length === 1, 'user B memory count mismatch');

    const auditCount = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM nnz_ops_audit_events WHERE id = $1',
      [fixture.auditId],
    );
    assert(Number(auditCount.rows[0]?.count ?? 0) === 1, 'audit row was not written');

    const countsBeforeDelete = await scopedCounts(pool, fixture.userA.id);
    assert(countsBeforeDelete['users'] === 1, 'user A was not written');
    assert(countsBeforeDelete['credentials'] === 1, 'user A credential was not written');

    await pool.query('DELETE FROM nnz_users WHERE id = $1', [fixture.userA.id]);
    userIds.splice(userIds.indexOf(fixture.userA.id), 1);

    const countsAfterDelete = await scopedCounts(pool, fixture.userA.id);
    assert(Object.values(countsAfterDelete).every((count) => count === 0), 'cascade delete left scoped rows behind');
    assert((await repoB.listMemory()).length === 1, 'sibling scope was not preserved');

    return {
      kind: 'postgres-scoped-migration-smoke',
      committed: true,
      totalRows: firstResult.totalRows,
      checks: {
        idempotentExecution: true,
        repositoryReadback: true,
        crossScopeRejected: true,
        cascadeDelete: true,
        siblingScopePreserved: true,
        auditRowWritten: true,
        cleanupAttempted: true,
      },
    };
  } finally {
    await cleanupSmokeRows(pool, userIds, auditIds);
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
  if (!env[ALLOWED_DATABASE_URL_ENV]) {
    return `${ALLOWED_DATABASE_URL_ENV} is not set. Use a disposable Postgres database only.`;
  }
  return undefined;
}

function formatSmokeSummary(result: PostgresScopedMigrationSmokeResult): string {
  const lines = [
    'Postgres scoped migration disposable smoke',
    `committed: ${result.committed ? 'yes' : 'no'}`,
    `totalRows: ${result.totalRows}`,
    '',
    'Checks:',
    ...Object.entries(result.checks).map(([key, value]) => `- ${key}: ${value ? 'yes' : 'no'}`),
  ];
  return `${lines.join('\n')}\n`;
}

function formatSmokeError(error: unknown): string {
  const code = isRecord(error) && typeof error['code'] === 'string' ? ` errorCode=${error['code']}` : '';
  return `Postgres scoped migration smoke failed.${code}\nNo database URL, fixture memory text, chat content, credential hash, row payload, or raw database error details were printed.\n`;
}

interface SnapshotFixture {
  snapshot: StoreSnapshot;
  userA: User;
  userB: User;
  personaA: Persona;
  personaB: Persona;
  nodeA: NodeEvent;
  soulSnapshotAId: string;
  memoryAId: string;
  emailA: string;
  auditId: string;
}

function createSnapshotFixture(): SnapshotFixture {
  const runId = `migration_smoke_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const store = new InMemorySoulStore();

  const userA = store.createUser(`迁移烟测 A ${runId}`);
  const userB = store.createUser(`迁移烟测 B ${runId}`);
  const personaA = store.createPersona({
    userId: userA.id,
    displayName: '爸爸',
    relationship: '女儿',
    type: 'DECEASED',
  });
  const personaB = store.createPersona({
    userId: userB.id,
    displayName: '爸爸',
    relationship: '儿子',
    type: 'DECEASED',
  });

  store.createSoulVersion({
    userId: userA.id,
    personaId: personaA.id,
    kernelJson: {
      affectModel: { humorLevel: 'low' },
      languageModel: { petPhrases: ['慢慢来'] },
    },
  });
  const memoryA = store.addMemory({
    userId: userA.id,
    personaId: personaA.id,
    type: 'CORRECTION',
    content: `A scoped memory ${runId}`,
    confidence: 1,
    enabledForSoul: true,
  });
  store.createSoulUpdateProposal({
    userId: userA.id,
    personaId: personaA.id,
    fieldPath: 'affectModel.humorLevel',
    newValue: 'medium',
    evidenceIds: [memoryA.id],
  });
  store.addConversation({
    userId: userA.id,
    personaId: personaA.id,
    role: 'USER',
    content: `before node ${runId}`,
  });
  const sealedA = store.sealSoul({ userId: userA.id, personaId: personaA.id });
  const nodeA = store.activateNode({ userId: userA.id, personaId: personaA.id }, `婚礼 ${runId}`).node;
  store.addConversation({
    userId: userA.id,
    personaId: personaA.id,
    nodeId: nodeA.id,
    role: 'USER',
    content: `node conversation ${runId}`,
  });

  store.createSoulVersion({
    userId: userB.id,
    personaId: personaB.id,
    kernelJson: {
      affectModel: { humorLevel: 'medium' },
      languageModel: { petPhrases: ['你自己拿主意'] },
    },
  });
  store.addMemory({
    userId: userB.id,
    personaId: personaB.id,
    type: 'DESCRIPTION',
    content: `B scoped memory ${runId}`,
    confidence: 1,
    enabledForSoul: true,
  });
  store.getRuntimeSession({ userId: userB.id, personaId: personaB.id });

  const emailA = `${runId}@example.test`;
  store.storeCredential(userA.id, emailA, `hash-${runId}`);
  const audit = store.recordOpsAuditEvent({
    action: 'OVERVIEW_READ',
    outcome: 'SUCCESS',
    actor: 'ops:migration-smoke',
    targetUserIds: [userA.id, userB.id],
    metadata: { runId },
  });

  return {
    snapshot: store.serialize(),
    userA,
    userB,
    personaA,
    personaB,
    nodeA,
    soulSnapshotAId: sealedA.snapshot.id,
    memoryAId: memoryA.id,
    emailA,
    auditId: audit.id,
  };
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

async function cleanupSmokeRows(
  pool: QueryablePool,
  userIds: string[],
  auditIds: string[],
): Promise<void> {
  for (const auditId of auditIds) {
    await pool.query('DELETE FROM nnz_ops_audit_events WHERE id = $1', [auditId]);
  }
  for (const userId of userIds) {
    await pool.query('DELETE FROM nnz_users WHERE id = $1', [userId]);
  }
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
  const result = await runMigrationSmokeCommand(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
