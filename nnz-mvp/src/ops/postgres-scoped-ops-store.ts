import { randomUUID } from 'node:crypto';

import type { QueryablePool } from '../domain/postgres-scoped-soul-repository';
import type {
  OpsAuditAction,
  OpsAuditEvent,
  OpsAuditOutcome,
} from '../domain/types';
import type {
  OpsAuditOverview,
  OpsAuditQuery,
  OpsAuditQueryResult,
  OpsCleanupPlan,
  OpsCleanupReceipt,
  OpsCleanupResult,
  OpsCleanupUser,
} from './ops-console';

interface UserCredentialRow {
  id: string;
  display_name: string;
  created_at: string | Date;
  email: string | null;
}

interface CountRow {
  table_name: keyof OpsCleanupPlan['totals'];
  count: string | number;
}

interface OpsAuditRow {
  id: string;
  action: OpsAuditAction;
  outcome: OpsAuditOutcome;
  actor: string;
  target_user_ids: unknown;
  metadata: unknown;
  created_at: string | Date;
}

interface RecordOpsAuditEventInput {
  action: OpsAuditAction;
  outcome: OpsAuditOutcome;
  actor?: string;
  targetUserIds?: string[];
  metadata?: Record<string, string | number | boolean | null>;
}

export interface PostgresScopedOpsStore {
  buildTestUserCleanupPlan(): Promise<OpsCleanupPlan>;
  cleanupTestUsers(dryRun?: boolean): Promise<OpsCleanupResult>;
  recordOpsAuditEvent(input: RecordOpsAuditEventInput): Promise<OpsAuditEvent>;
  listOpsAuditEvents(limit?: number): Promise<OpsAuditEvent[]>;
  queryOpsAuditEvents(query?: OpsAuditQuery): Promise<OpsAuditQueryResult>;
  getAuditOverview(limit?: number): Promise<OpsAuditOverview>;
}

export function createPostgresScopedOpsStoreFromPool(pool: QueryablePool): PostgresScopedOpsStore {
  return {
    buildTestUserCleanupPlan: () => buildPostgresScopedTestUserCleanupPlan(pool),
    cleanupTestUsers: (dryRun = true) => cleanupPostgresScopedTestUsers(pool, dryRun),
    recordOpsAuditEvent: (input) => recordPostgresScopedOpsAuditEvent(pool, input),
    listOpsAuditEvents: (limit) => listPostgresScopedOpsAuditEvents(pool, limit),
    queryOpsAuditEvents: (query = {}) => queryPostgresScopedOpsAuditEvents(pool, query),
    getAuditOverview: (limit = 20) => getPostgresScopedAuditOverview(pool, limit),
  };
}

async function buildPostgresScopedTestUserCleanupPlan(pool: QueryablePool): Promise<OpsCleanupPlan> {
  const result = await pool.query<UserCredentialRow>(
    `SELECT u.id, u.display_name, u.created_at, c.email
     FROM nnz_users u
     LEFT JOIN nnz_credentials c ON c.user_id = u.id
     ORDER BY u.created_at DESC, u.id DESC`,
  );

  const users: OpsCleanupUser[] = [];
  for (const row of result.rows) {
    const reason = getTestUserReason(row.display_name, row.email);
    if (!reason) continue;
    users.push({
      userId: row.id,
      displayName: row.display_name,
      email: row.email ?? null,
      createdAt: toDate(row.created_at).toISOString(),
      reason,
      counts: await countScopedRowsForUser(pool, row.id),
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    users,
    totals: sumCleanupTotals(users),
  };
}

async function cleanupPostgresScopedTestUsers(
  pool: QueryablePool,
  dryRun = true,
): Promise<OpsCleanupResult> {
  const plan = await buildPostgresScopedTestUserCleanupPlan(pool);
  if (dryRun) {
    return { dryRun: true, plan, deletedUserIds: [], receipts: [] };
  }

  const deletedAt = new Date().toISOString();
  const deletedUserIds: string[] = [];
  const receipts: OpsCleanupReceipt[] = [];
  for (const user of plan.users) {
    await pool.query('DELETE FROM nnz_users WHERE id = $1', [user.userId]);
    deletedUserIds.push(user.userId);
    receipts.push({
      userId: user.userId,
      displayName: user.displayName,
      email: user.email,
      reason: user.reason,
      counts: user.counts,
      deletedAt,
      status: 'DELETED',
    });
  }

  return { dryRun: false, plan, deletedUserIds, receipts };
}

async function recordPostgresScopedOpsAuditEvent(
  pool: QueryablePool,
  input: RecordOpsAuditEventInput,
): Promise<OpsAuditEvent> {
  const event: OpsAuditEvent = {
    id: `ops_audit_${randomUUID()}`,
    action: input.action,
    outcome: input.outcome,
    actor: input.actor ?? 'ops-token',
    targetUserIds: [...new Set(input.targetUserIds ?? [])],
    metadata: cloneMetadata(input.metadata ?? {}),
    createdAt: new Date(),
  };
  await pool.query(
    `INSERT INTO nnz_ops_audit_events (
      id, action, outcome, actor, target_user_ids, metadata, created_at
    ) VALUES (
      $1, $2, $3, $4, $5::jsonb, $6::jsonb, $7
    )`,
    [
      event.id,
      event.action,
      event.outcome,
      event.actor,
      JSON.stringify(event.targetUserIds),
      JSON.stringify(event.metadata),
      event.createdAt,
    ],
  );
  return event;
}

async function listPostgresScopedOpsAuditEvents(
  pool: QueryablePool,
  limit?: number,
): Promise<OpsAuditEvent[]> {
  const result = await pool.query<OpsAuditRow>(
    `SELECT id, action, outcome, actor, target_user_ids, metadata, created_at
     FROM nnz_ops_audit_events
     ORDER BY created_at DESC, id DESC`,
  );
  const events = result.rows.map(mapOpsAuditRow);
  return limit === undefined ? events : events.slice(0, limit);
}

async function queryPostgresScopedOpsAuditEvents(
  pool: QueryablePool,
  query: OpsAuditQuery = {},
): Promise<OpsAuditQueryResult> {
  const limit = clampInteger(query.limit, 20, 1, 100);
  const offset = clampInteger(query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const actor = normalizeFilter(query.actor);
  const targetUserId = normalizeFilter(query.targetUserId);
  const events = (await listPostgresScopedOpsAuditEvents(pool)).filter((event) => {
    if (query.action && event.action !== query.action) return false;
    if (actor && event.actor !== actor) return false;
    if (targetUserId && !event.targetUserIds.includes(targetUserId)) return false;
    return true;
  });
  const page = events.slice(offset, offset + limit);

  return {
    generatedAt: new Date().toISOString(),
    filters: {
      action: query.action ?? null,
      actor: actor ?? null,
      targetUserId: targetUserId ?? null,
    },
    pagination: {
      limit,
      offset,
      total: events.length,
      returned: page.length,
      hasMore: offset + page.length < events.length,
    },
    events: page,
  };
}

async function getPostgresScopedAuditOverview(
  pool: QueryablePool,
  limit: number,
): Promise<OpsAuditOverview> {
  const events = await listPostgresScopedOpsAuditEvents(pool);
  return {
    total: events.length,
    recent: events.slice(0, limit),
  };
}

async function countScopedRowsForUser(
  pool: QueryablePool,
  userId: string,
): Promise<OpsCleanupPlan['totals']> {
  const result = await pool.query<CountRow>(
    `WITH user_personas AS (
       SELECT user_id, id AS persona_id
       FROM nnz_personas
       WHERE user_id = $1
     )
     SELECT table_name, row_count::text AS count
     FROM (
       SELECT 'users' AS table_name, COUNT(*) AS row_count FROM nnz_users WHERE id = $1
       UNION ALL
       SELECT 'personas', COUNT(*) FROM nnz_personas WHERE user_id = $1
       UNION ALL
       SELECT 'soulVersions', COUNT(*) FROM nnz_soul_versions rows
         JOIN user_personas p ON p.user_id = rows.user_id AND p.persona_id = rows.persona_id
       UNION ALL
       SELECT 'snapshots', COUNT(*) FROM nnz_soul_snapshots rows
         JOIN user_personas p ON p.user_id = rows.user_id AND p.persona_id = rows.persona_id
       UNION ALL
       SELECT 'memories', COUNT(*) FROM nnz_memory_items rows
         JOIN user_personas p ON p.user_id = rows.user_id AND p.persona_id = rows.persona_id
       UNION ALL
       SELECT 'proposals', COUNT(*) FROM nnz_soul_update_proposals rows
         JOIN user_personas p ON p.user_id = rows.user_id AND p.persona_id = rows.persona_id
       UNION ALL
       SELECT 'nodes', COUNT(*) FROM nnz_node_events rows
         JOIN user_personas p ON p.user_id = rows.user_id AND p.persona_id = rows.persona_id
       UNION ALL
       SELECT 'conversations', COUNT(*) FROM nnz_conversation_messages rows
         JOIN user_personas p ON p.user_id = rows.user_id AND p.persona_id = rows.persona_id
       UNION ALL
       SELECT 'sessions', COUNT(*) FROM nnz_runtime_sessions rows
         JOIN user_personas p ON p.user_id = rows.user_id AND p.persona_id = rows.persona_id
       UNION ALL
       SELECT 'credentials', COUNT(*) FROM nnz_credentials WHERE user_id = $1
     ) counts`,
    [userId],
  );
  const counts = emptyCleanupTotals();
  for (const row of result.rows) {
    counts[row.table_name] = Number(row.count);
  }
  return counts;
}

function getTestUserReason(displayName: string, email: string | null): string | null {
  const candidates = [displayName, email].filter((value): value is string => Boolean(value));
  for (const raw of candidates) {
    const value = raw.trim().toLowerCase();
    if (value.endsWith('@example.test')) return 'example.test smoke account';
    if (value.startsWith('codex-postgres-smoke-')) return 'codex postgres smoke account';
    if (value.startsWith('codex-ops-smoke-')) return 'codex ops smoke account';
    if (value.startsWith('nnz-smoke-')) return 'nnz smoke account';
  }
  return null;
}

function sumCleanupTotals(users: OpsCleanupUser[]): OpsCleanupPlan['totals'] {
  return users.reduce<OpsCleanupPlan['totals']>(
    (totals, user) => ({
      users: totals.users + user.counts.users,
      personas: totals.personas + user.counts.personas,
      soulVersions: totals.soulVersions + user.counts.soulVersions,
      snapshots: totals.snapshots + user.counts.snapshots,
      memories: totals.memories + user.counts.memories,
      proposals: totals.proposals + user.counts.proposals,
      nodes: totals.nodes + user.counts.nodes,
      conversations: totals.conversations + user.counts.conversations,
      sessions: totals.sessions + user.counts.sessions,
      credentials: totals.credentials + user.counts.credentials,
    }),
    emptyCleanupTotals(),
  );
}

function emptyCleanupTotals(): OpsCleanupPlan['totals'] {
  return {
    users: 0,
    personas: 0,
    soulVersions: 0,
    snapshots: 0,
    memories: 0,
    proposals: 0,
    nodes: 0,
    conversations: 0,
    sessions: 0,
    credentials: 0,
  };
}

function mapOpsAuditRow(row: OpsAuditRow): OpsAuditEvent {
  return {
    id: row.id,
    action: row.action,
    outcome: row.outcome,
    actor: row.actor,
    targetUserIds: normalizeStringArray(row.target_user_ids),
    metadata: normalizeMetadata(row.metadata),
    createdAt: toDate(row.created_at),
  };
}

function normalizeStringArray(value: unknown): string[] {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
}

function normalizeMetadata(value: unknown): Record<string, string | number | boolean | null> {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(parsed)) {
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean' || item === null) {
      result[key] = item;
    }
  }
  return result;
}

function cloneMetadata(
  value: Record<string, string | number | boolean | null>,
): Record<string, string | number | boolean | null> {
  return JSON.parse(JSON.stringify(value));
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value) || value === undefined) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function normalizeFilter(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}
