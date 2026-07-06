import { randomUUID } from 'node:crypto';

import type { CredentialRecord } from '../auth/auth';
import type { QueryablePool } from '../domain/postgres-scoped-soul-repository';
import { InMemorySoulStore } from '../domain/soul-store';
import type {
  ConversationMessage,
  MemoryItem,
  NodeEvent,
  OpsAuditAction,
  OpsAuditEvent,
  OpsAuditOutcome,
  Persona,
  RuntimeSession,
  SoulSnapshot,
  SoulUpdateProposal,
  SoulVersion,
  User,
} from '../domain/types';
import { buildOpsOverview } from './ops-console';
import type {
  OpsAuditOverview,
  OpsAuditQuery,
  OpsAuditQueryResult,
  OpsCleanupPlan,
  OpsCleanupReceipt,
  OpsCleanupResult,
  OpsCleanupUser,
  OpsOverview,
  OpsPersistenceInfo,
} from './ops-console';

interface UserCredentialRow {
  id: string;
  display_name: string;
  created_at: string | Date;
  email: string | null;
}

interface UserRow {
  id: string;
  display_name: string;
  created_at: string | Date;
}

interface PersonaRow {
  id: string;
  user_id: string;
  display_name: string;
  relationship: string;
  type: Persona['type'];
  created_at: string | Date;
}

interface MemoryRow {
  id: string;
  user_id: string;
  persona_id: string;
  type: MemoryItem['type'];
  source: MemoryItem['source'];
  content: string;
  confidence: number | string;
  sensitivity: MemoryItem['sensitivity'];
  enabled_for_soul: boolean;
  enabled_for_runtime: boolean;
  enabled_for_soul_update: boolean;
  evidence_ids: unknown;
  created_by: MemoryItem['createdBy'];
  state: MemoryItem['state'];
  created_at: string | Date;
}

interface SoulVersionRow {
  id: string;
  user_id: string;
  persona_id: string;
  version: number | string;
  kernel_json: unknown;
  status: SoulVersion['status'];
  knowledge_cutoff: string | Date | null;
  created_at: string | Date;
}

interface SoulSnapshotRow {
  id: string;
  user_id: string;
  persona_id: string;
  soul_version_id: string;
  kernel_json: unknown;
  memory_ids: unknown;
  sealed_at: string | Date;
}

interface SoulUpdateProposalRow {
  id: string;
  user_id: string;
  persona_id: string;
  field_path: string;
  old_value: unknown;
  new_value: unknown;
  evidence_ids: unknown;
  status: SoulUpdateProposal['status'];
  created_at: string | Date;
}

interface NodeEventRow {
  id: string;
  user_id: string;
  persona_id: string;
  name: string;
  status: NodeEvent['status'];
  start_at: string | Date;
  end_at: string | Date;
}

interface ConversationRow {
  id: string;
  user_id: string;
  persona_id: string;
  node_id: string | null;
  role: ConversationMessage['role'];
  content: string;
  created_at: string | Date;
}

interface RuntimeSessionRow {
  user_id: string;
  persona_id: string;
  state: RuntimeSession['state'];
  soul_snapshot_id: string | null;
  node_id: string | null;
  node_name: string | null;
  daily_message_count: number | string | null;
  last_message_date: string | null;
}

interface CredentialRow {
  user_id: string;
  email: string;
  password_hash: string;
  created_at: string | Date;
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
  buildOverview(persistence: OpsPersistenceInfo): Promise<OpsOverview>;
  buildTestUserCleanupPlan(): Promise<OpsCleanupPlan>;
  cleanupTestUsers(dryRun?: boolean): Promise<OpsCleanupResult>;
  recordOpsAuditEvent(input: RecordOpsAuditEventInput): Promise<OpsAuditEvent>;
  listOpsAuditEvents(limit?: number): Promise<OpsAuditEvent[]>;
  queryOpsAuditEvents(query?: OpsAuditQuery): Promise<OpsAuditQueryResult>;
  getAuditOverview(limit?: number): Promise<OpsAuditOverview>;
}

export function createPostgresScopedOpsStoreFromPool(pool: QueryablePool): PostgresScopedOpsStore {
  return {
    buildOverview: (persistence) => buildPostgresScopedOpsOverview(pool, persistence),
    buildTestUserCleanupPlan: () => buildPostgresScopedTestUserCleanupPlan(pool),
    cleanupTestUsers: (dryRun = true) => cleanupPostgresScopedTestUsers(pool, dryRun),
    recordOpsAuditEvent: (input) => recordPostgresScopedOpsAuditEvent(pool, input),
    listOpsAuditEvents: (limit) => listPostgresScopedOpsAuditEvents(pool, limit),
    queryOpsAuditEvents: (query = {}) => queryPostgresScopedOpsAuditEvents(pool, query),
    getAuditOverview: (limit = 20) => getPostgresScopedAuditOverview(pool, limit),
  };
}

async function buildPostgresScopedOpsOverview(
  pool: QueryablePool,
  persistence: OpsPersistenceInfo,
): Promise<OpsOverview> {
  const store = await loadPostgresScopedOpsSnapshot(pool);
  return buildOpsOverview(store, persistence);
}

async function loadPostgresScopedOpsSnapshot(pool: QueryablePool): Promise<InMemorySoulStore> {
  const [
    users,
    personas,
    soulVersions,
    soulSnapshots,
    memoryItems,
    soulUpdateProposals,
    nodeEvents,
    conversationMessages,
    sessions,
    credentials,
    opsAuditEvents,
  ] = await Promise.all([
    pool.query<UserRow>('SELECT id, display_name, created_at FROM nnz_users'),
    pool.query<PersonaRow>('SELECT id, user_id, display_name, relationship, type, created_at FROM nnz_personas'),
    pool.query<SoulVersionRow>(
      `SELECT id, user_id, persona_id, version, kernel_json, status, knowledge_cutoff, created_at
       FROM nnz_soul_versions`,
    ),
    pool.query<SoulSnapshotRow>(
      `SELECT id, user_id, persona_id, soul_version_id, kernel_json, memory_ids, sealed_at
       FROM nnz_soul_snapshots`,
    ),
    pool.query<MemoryRow>(
      `SELECT id, user_id, persona_id, type, source, content, confidence, sensitivity,
        enabled_for_soul, enabled_for_runtime, enabled_for_soul_update,
        evidence_ids, created_by, state, created_at
       FROM nnz_memory_items`,
    ),
    pool.query<SoulUpdateProposalRow>(
      `SELECT id, user_id, persona_id, field_path, old_value, new_value, evidence_ids, status, created_at
       FROM nnz_soul_update_proposals`,
    ),
    pool.query<NodeEventRow>('SELECT id, user_id, persona_id, name, status, start_at, end_at FROM nnz_node_events'),
    pool.query<ConversationRow>(
      'SELECT id, user_id, persona_id, node_id, role, content, created_at FROM nnz_conversation_messages',
    ),
    pool.query<RuntimeSessionRow>(
      `SELECT user_id, persona_id, state, soul_snapshot_id, node_id, node_name,
        daily_message_count, last_message_date
       FROM nnz_runtime_sessions`,
    ),
    pool.query<CredentialRow>('SELECT user_id, email, password_hash, created_at FROM nnz_credentials'),
    pool.query<OpsAuditRow>(
      `SELECT id, action, outcome, actor, target_user_ids, metadata, created_at
       FROM nnz_ops_audit_events`,
    ),
  ]);

  const store = new InMemorySoulStore();
  store.deserialize({
    users: users.rows.map(mapUserRow),
    personas: personas.rows.map(mapPersonaRow),
    soulVersions: soulVersions.rows.map(mapSoulVersionRow),
    soulSnapshots: soulSnapshots.rows.map(mapSoulSnapshotRow),
    memoryItems: memoryItems.rows.map(mapMemoryRow),
    soulUpdateProposals: soulUpdateProposals.rows.map(mapSoulUpdateProposalRow),
    nodeEvents: nodeEvents.rows.map(mapNodeEventRow),
    conversationMessages: conversationMessages.rows.map(mapConversationRow),
    sessions: sessions.rows.map(mapRuntimeSessionRowForSnapshot),
    credentials: credentials.rows.map(mapCredentialRow),
    opsAuditEvents: opsAuditEvents.rows.map(mapOpsAuditRow),
  });
  return store;
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

function mapUserRow(row: UserRow): User {
  return {
    id: row.id,
    displayName: row.display_name,
    createdAt: toDate(row.created_at),
  };
}

function mapPersonaRow(row: PersonaRow): Persona {
  return {
    id: row.id,
    userId: row.user_id,
    displayName: row.display_name,
    relationship: row.relationship,
    type: row.type,
    createdAt: toDate(row.created_at),
  };
}

function mapSoulVersionRow(row: SoulVersionRow): SoulVersion {
  const soulVersion: SoulVersion = {
    id: row.id,
    userId: row.user_id,
    personaId: row.persona_id,
    version: Number(row.version),
    kernelJson: normalizeJsonObject(row.kernel_json),
    status: row.status,
    createdAt: toDate(row.created_at),
  };
  if (row.knowledge_cutoff) {
    soulVersion.knowledgeCutoff = toDate(row.knowledge_cutoff);
  }
  return soulVersion;
}

function mapSoulSnapshotRow(row: SoulSnapshotRow): SoulSnapshot {
  return {
    id: row.id,
    userId: row.user_id,
    personaId: row.persona_id,
    soulVersionId: row.soul_version_id,
    kernelJson: normalizeJsonObject(row.kernel_json),
    memoryIds: normalizeStringArray(row.memory_ids),
    sealedAt: toDate(row.sealed_at),
  };
}

function mapMemoryRow(row: MemoryRow): MemoryItem {
  return {
    id: row.id,
    userId: row.user_id,
    personaId: row.persona_id,
    type: row.type,
    source: row.source,
    content: row.content,
    confidence: Number(row.confidence),
    sensitivity: row.sensitivity,
    enabledForSoul: row.enabled_for_soul,
    enabledForRuntime: row.enabled_for_runtime,
    enabledForSoulUpdate: row.enabled_for_soul_update,
    evidenceIds: normalizeStringArray(row.evidence_ids),
    createdBy: row.created_by,
    state: row.state,
    createdAt: toDate(row.created_at),
  };
}

function mapSoulUpdateProposalRow(row: SoulUpdateProposalRow): SoulUpdateProposal {
  return {
    id: row.id,
    userId: row.user_id,
    personaId: row.persona_id,
    fieldPath: row.field_path,
    oldValue: normalizeJsonValue(row.old_value),
    newValue: normalizeJsonValue(row.new_value),
    evidenceIds: normalizeStringArray(row.evidence_ids),
    status: row.status,
    createdAt: toDate(row.created_at),
  };
}

function mapNodeEventRow(row: NodeEventRow): NodeEvent {
  return {
    id: row.id,
    userId: row.user_id,
    personaId: row.persona_id,
    name: row.name,
    status: row.status,
    startAt: toDate(row.start_at),
    endAt: toDate(row.end_at),
  };
}

function mapConversationRow(row: ConversationRow): ConversationMessage {
  const message: ConversationMessage = {
    id: row.id,
    userId: row.user_id,
    personaId: row.persona_id,
    role: row.role,
    content: row.content,
    createdAt: toDate(row.created_at),
  };
  if (row.node_id) {
    message.nodeId = row.node_id;
  }
  return message;
}

function mapRuntimeSessionRowForSnapshot(row: RuntimeSessionRow): {
  scopeKey: string;
  userId: string;
  personaId: string;
  state: string;
  soulSnapshotId?: string;
  nodeId?: string;
  nodeName?: string;
  dailyMessageCount?: number;
  lastMessageDate?: string;
} {
  const session: {
    scopeKey: string;
    userId: string;
    personaId: string;
    state: string;
    soulSnapshotId?: string;
    nodeId?: string;
    nodeName?: string;
    dailyMessageCount?: number;
    lastMessageDate?: string;
  } = {
    scopeKey: `${row.user_id}:${row.persona_id}`,
    userId: row.user_id,
    personaId: row.persona_id,
    state: row.state,
  };
  if (row.soul_snapshot_id) session.soulSnapshotId = row.soul_snapshot_id;
  if (row.node_id && row.node_name) {
    session.nodeId = row.node_id;
    session.nodeName = row.node_name;
  }
  if (row.daily_message_count !== null) session.dailyMessageCount = Number(row.daily_message_count);
  if (row.last_message_date !== null) session.lastMessageDate = row.last_message_date;
  return session;
}

function mapCredentialRow(row: CredentialRow): CredentialRecord {
  return {
    userId: row.user_id,
    email: row.email,
    passwordHash: row.password_hash,
    createdAt: toDate(row.created_at).toISOString(),
  };
}

function normalizeStringArray(value: unknown): string[] {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
}

function normalizeJsonObject(value: unknown): Record<string, unknown> {
  const parsed = normalizeJsonValue(value);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}

function normalizeJsonValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
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
