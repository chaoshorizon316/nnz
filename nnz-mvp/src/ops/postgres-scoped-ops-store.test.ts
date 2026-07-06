import { describe, expect, it } from 'vitest';

import type { QueryablePool } from '../domain/postgres-scoped-soul-repository';
import type { OpsAuditAction, OpsAuditOutcome } from '../domain/types';
import { createPostgresScopedOpsStoreFromPool } from './postgres-scoped-ops-store';

describe('Postgres scoped Ops store', () => {
  it('builds full Ops overview from scoped Postgres tables instead of fixture memory', async () => {
    const pool = new FakeScopedOpsPool();
    const store = createPostgresScopedOpsStoreFromPool(pool);

    const overview = await store.buildOverview({
      mode: 'scoped-postgres',
      runtimeMode: 'scoped',
      requestedRuntimeMode: 'scoped',
      postgresConfigured: false,
      postgresEnv: null,
      scopedPostgresConfigured: true,
      scopedPostgresEnv: 'NNZ_POSTGRES_SCOPED_RUNTIME_URL',
      sqliteConfigured: false,
      startupBlocked: false,
      startupBlockReason: null,
    });

    expect(overview.persistence.mode).toBe('scoped-postgres');
    expect(overview.totals).toMatchObject({
      users: 2,
      personas: 2,
      memories: 3,
      conversations: 3,
      credentials: 2,
      testUsers: 1,
    });
    expect(overview.users.map((user) => user.id)).toEqual(['user_smoke', 'user_real']);
    expect(overview.users.find((user) => user.id === 'user_smoke')).toMatchObject({
      isDemoUser: false,
      isTestUser: true,
      counts: {
        personas: 1,
        memories: 2,
        conversations: 2,
      },
    });
    expect(overview.users.find((user) => user.id === 'user_real')?.personas[0]?.maturity).toMatchObject({
      userId: 'user_real',
      personaId: 'persona_real',
      memoryCount: 1,
      runtimeState: 'ACTIVE',
    });
    expect(JSON.stringify(overview)).not.toContain('private memory text');
    expect(JSON.stringify(overview)).not.toContain('private chat text');
    expect(JSON.stringify(overview)).not.toContain('hash-');
  });

  it('builds a conservative cleanup plan from scoped Postgres tables', async () => {
    const pool = new FakeScopedOpsPool();
    const store = createPostgresScopedOpsStoreFromPool(pool);

    const plan = await store.buildTestUserCleanupPlan();

    expect(plan.users).toHaveLength(1);
    expect(plan.users[0]).toMatchObject({
      userId: 'user_smoke',
      email: 'codex-ops-smoke-20260703@example.test',
      reason: 'example.test smoke account',
      counts: {
        users: 1,
        personas: 1,
        soulVersions: 1,
        memories: 2,
        proposals: 1,
        nodes: 1,
        conversations: 2,
        sessions: 1,
        credentials: 1,
      },
    });
    expect(plan.totals.users).toBe(1);
    expect(plan.totals.credentials).toBe(1);
    expect(pool.deletedUserIds).toEqual([]);
    expect(JSON.stringify(plan)).not.toContain('hash-');
  });

  it('keeps dry-run read-only and deletes only planned smoke users when confirmed', async () => {
    const pool = new FakeScopedOpsPool();
    const store = createPostgresScopedOpsStoreFromPool(pool);

    const dryRun = await store.cleanupTestUsers(true);
    expect(dryRun.deletedUserIds).toEqual([]);
    expect(dryRun.receipts).toEqual([]);
    expect(pool.deletedUserIds).toEqual([]);

    const result = await store.cleanupTestUsers(false);
    expect(result.deletedUserIds).toEqual(['user_smoke']);
    expect(result.receipts).toHaveLength(1);
    expect(result.receipts[0]).toMatchObject({
      userId: 'user_smoke',
      email: 'codex-ops-smoke-20260703@example.test',
      status: 'DELETED',
    });
    expect(pool.deletedUserIds).toEqual(['user_smoke']);
    expect(pool.users.map((user) => user.id)).toEqual(['user_real']);
  });

  it('records and queries scoped Postgres ops audit events without raw secret fields', async () => {
    const pool = new FakeScopedOpsPool();
    const store = createPostgresScopedOpsStoreFromPool(pool);

    await store.recordOpsAuditEvent({
      action: 'OVERVIEW_READ',
      outcome: 'SUCCESS',
      actor: 'ops:viewer',
      metadata: { path: '/api/ops/overview' },
    });
    await store.recordOpsAuditEvent({
      action: 'CLEANUP_DRY_RUN',
      outcome: 'SUCCESS',
      actor: 'ops:operator',
      targetUserIds: ['user_smoke'],
      metadata: { candidateUsers: 1, dryRun: true },
    });
    await store.recordOpsAuditEvent({
      action: 'AUDIT_QUERY',
      outcome: 'SUCCESS',
      actor: 'ops:admin',
      targetUserIds: ['user_real'],
      metadata: { actorRole: 'admin' },
    });

    const audit = await store.queryOpsAuditEvents({ actor: 'ops:operator' });
    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]).toMatchObject({
      action: 'CLEANUP_DRY_RUN',
      actor: 'ops:operator',
      targetUserIds: ['user_smoke'],
    });
    expect(audit.filters).toEqual({
      action: null,
      actor: 'ops:operator',
      targetUserId: null,
    });

    const firstPage = await store.queryOpsAuditEvents({ limit: 2, offset: 0 });
    expect(firstPage.pagination).toMatchObject({
      limit: 2,
      offset: 0,
      total: 3,
      returned: 2,
      hasMore: true,
    });
    expect(firstPage.events.map((event) => event.action)).toEqual(['AUDIT_QUERY', 'CLEANUP_DRY_RUN']);

    const overview = await store.getAuditOverview();
    expect(overview.total).toBe(3);
    expect(overview.recent).toHaveLength(3);
    expect(JSON.stringify(overview)).not.toContain('token-secret');
    expect(JSON.stringify(overview)).not.toContain('hash-');
  });
});

interface FakeUserRow {
  id: string;
  display_name: string;
  created_at: Date;
  email: string | null;
}

interface FakeAuditRow {
  id: string;
  action: OpsAuditAction;
  outcome: OpsAuditOutcome;
  actor: string;
  target_user_ids: string[];
  metadata: Record<string, string | number | boolean | null>;
  created_at: Date;
}

class FakeScopedOpsPool implements QueryablePool {
  users: FakeUserRow[] = [
    {
      id: 'user_real',
      display_name: 'real.user@example.com',
      email: 'real.user@example.com',
      created_at: new Date('2026-07-03T00:00:00.000Z'),
    },
    {
      id: 'user_smoke',
      display_name: 'codex-ops-smoke-20260703@example.test',
      email: 'codex-ops-smoke-20260703@example.test',
      created_at: new Date('2026-07-03T00:01:00.000Z'),
    },
  ];
  readonly personas = [
    {
      id: 'persona_real',
      user_id: 'user_real',
      display_name: '妈妈',
      relationship: '孩子',
      type: 'DECEASED',
      created_at: new Date('2026-07-03T00:00:01.000Z'),
    },
    {
      id: 'persona_smoke',
      user_id: 'user_smoke',
      display_name: '爸爸',
      relationship: '孩子',
      type: 'DECEASED',
      created_at: new Date('2026-07-03T00:01:01.000Z'),
    },
  ];
  readonly soulVersions = [
    {
      id: 'soul_real',
      user_id: 'user_real',
      persona_id: 'persona_real',
      version: 1,
      kernel_json: { identityCore: { relationship: '孩子心中的母亲' }, affectModel: { humorLevel: 'medium' } },
      status: 'ACTIVE',
      knowledge_cutoff: null,
      created_at: new Date('2026-07-03T00:00:02.000Z'),
    },
    {
      id: 'soul_smoke',
      user_id: 'user_smoke',
      persona_id: 'persona_smoke',
      version: 1,
      kernel_json: { identityCore: { relationship: '孩子心中的父亲' }, affectModel: { humorLevel: 'low' } },
      status: 'ACTIVE',
      knowledge_cutoff: null,
      created_at: new Date('2026-07-03T00:01:02.000Z'),
    },
  ];
  readonly soulSnapshots = [
    {
      id: 'snapshot_smoke',
      user_id: 'user_smoke',
      persona_id: 'persona_smoke',
      soul_version_id: 'soul_smoke',
      kernel_json: { identityCore: { relationship: '孩子心中的父亲' } },
      memory_ids: ['memory_smoke_a'],
      sealed_at: new Date('2026-07-03T00:01:05.000Z'),
    },
  ];
  readonly memoryItems = [
    {
      id: 'memory_real',
      user_id: 'user_real',
      persona_id: 'persona_real',
      type: 'DESCRIPTION',
      source: 'USER_INPUT',
      content: 'private memory text real',
      confidence: 0.9,
      sensitivity: 'LOW',
      enabled_for_soul: true,
      enabled_for_runtime: true,
      enabled_for_soul_update: true,
      evidence_ids: [],
      created_by: 'USER',
      state: 'ACTIVE',
      created_at: new Date('2026-07-03T00:00:03.000Z'),
    },
    {
      id: 'memory_smoke_a',
      user_id: 'user_smoke',
      persona_id: 'persona_smoke',
      type: 'CORRECTION',
      source: 'CORRECTION',
      content: 'private memory text smoke',
      confidence: 1,
      sensitivity: 'LOW',
      enabled_for_soul: true,
      enabled_for_runtime: true,
      enabled_for_soul_update: true,
      evidence_ids: [],
      created_by: 'USER',
      state: 'ACTIVE',
      created_at: new Date('2026-07-03T00:01:03.000Z'),
    },
    {
      id: 'memory_smoke_b',
      user_id: 'user_smoke',
      persona_id: 'persona_smoke',
      type: 'NODE_MEMORY',
      source: 'NODE',
      content: 'private memory text node',
      confidence: 1,
      sensitivity: 'LOW',
      enabled_for_soul: false,
      enabled_for_runtime: true,
      enabled_for_soul_update: false,
      evidence_ids: [],
      created_by: 'USER',
      state: 'ACTIVE',
      created_at: new Date('2026-07-03T00:01:04.000Z'),
    },
  ];
  readonly proposals = [
    {
      id: 'proposal_smoke',
      user_id: 'user_smoke',
      persona_id: 'persona_smoke',
      field_path: 'affectModel.humorLevel',
      old_value: 'low',
      new_value: 'medium',
      evidence_ids: ['memory_smoke_a'],
      status: 'PENDING',
      created_at: new Date('2026-07-03T00:01:06.000Z'),
    },
  ];
  readonly nodes = [
    {
      id: 'node_smoke',
      user_id: 'user_smoke',
      persona_id: 'persona_smoke',
      name: '生日',
      status: 'ACTIVE',
      start_at: new Date('2026-07-03T00:01:07.000Z'),
      end_at: new Date('2026-07-06T00:01:07.000Z'),
    },
  ];
  readonly conversations = [
    {
      id: 'message_real',
      user_id: 'user_real',
      persona_id: 'persona_real',
      node_id: null,
      role: 'USER',
      content: 'private chat text real',
      created_at: new Date('2026-07-03T00:00:04.000Z'),
    },
    {
      id: 'message_smoke_user',
      user_id: 'user_smoke',
      persona_id: 'persona_smoke',
      node_id: 'node_smoke',
      role: 'USER',
      content: 'private chat text smoke user',
      created_at: new Date('2026-07-03T00:01:08.000Z'),
    },
    {
      id: 'message_smoke_assistant',
      user_id: 'user_smoke',
      persona_id: 'persona_smoke',
      node_id: 'node_smoke',
      role: 'ASSISTANT',
      content: 'private chat text smoke assistant',
      created_at: new Date('2026-07-03T00:01:09.000Z'),
    },
  ];
  readonly sessions = [
    {
      user_id: 'user_real',
      persona_id: 'persona_real',
      state: 'ACTIVE',
      soul_snapshot_id: null,
      node_id: null,
      node_name: null,
      daily_message_count: 1,
      last_message_date: '2026-07-03',
    },
    {
      user_id: 'user_smoke',
      persona_id: 'persona_smoke',
      state: 'NODE',
      soul_snapshot_id: 'snapshot_smoke',
      node_id: 'node_smoke',
      node_name: '生日',
      daily_message_count: 2,
      last_message_date: '2026-07-03',
    },
  ];
  readonly credentials = [
    {
      user_id: 'user_real',
      email: 'real.user@example.com',
      password_hash: 'hash-real',
      created_at: new Date('2026-07-03T00:00:00.500Z'),
    },
    {
      user_id: 'user_smoke',
      email: 'codex-ops-smoke-20260703@example.test',
      password_hash: 'hash-smoke',
      created_at: new Date('2026-07-03T00:01:00.500Z'),
    },
  ];
  readonly counts = new Map<string, Record<string, number>>([
    ['user_real', {
      users: 1,
      personas: 1,
      soulVersions: 1,
      snapshots: 0,
      memories: 1,
      proposals: 0,
      nodes: 0,
      conversations: 1,
      sessions: 1,
      credentials: 1,
    }],
    ['user_smoke', {
      users: 1,
      personas: 1,
      soulVersions: 1,
      snapshots: 0,
      memories: 2,
      proposals: 1,
      nodes: 1,
      conversations: 2,
      sessions: 1,
      credentials: 1,
    }],
  ]);
  readonly deletedUserIds: string[] = [];
  private readonly auditRows: FakeAuditRow[] = [];

  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<{ rows: T[] }> {
    const compactSql = sql.replace(/\s+/g, ' ').trim();
    if (compactSql.startsWith('SELECT u.id, u.display_name')) {
      return rows([...this.users].sort((left, right) => {
        const byDate = right.created_at.getTime() - left.created_at.getTime();
        return byDate || right.id.localeCompare(left.id);
      }) as T[]);
    }
    if (compactSql === 'SELECT id, display_name, created_at FROM nnz_users') {
      return rows(this.users.map(({ id, display_name, created_at }) => ({ id, display_name, created_at })) as T[]);
    }
    if (compactSql === 'SELECT id, user_id, display_name, relationship, type, created_at FROM nnz_personas') {
      return rows(this.personas as T[]);
    }
    if (compactSql.startsWith('SELECT id, user_id, persona_id, version, kernel_json, status, knowledge_cutoff, created_at FROM nnz_soul_versions')) {
      return rows(this.soulVersions as T[]);
    }
    if (compactSql.startsWith('SELECT id, user_id, persona_id, soul_version_id, kernel_json, memory_ids, sealed_at FROM nnz_soul_snapshots')) {
      return rows(this.soulSnapshots as T[]);
    }
    if (compactSql.startsWith('SELECT id, user_id, persona_id, type, source, content, confidence, sensitivity,')) {
      return rows(this.memoryItems as T[]);
    }
    if (compactSql.startsWith('SELECT id, user_id, persona_id, field_path, old_value, new_value, evidence_ids, status, created_at FROM nnz_soul_update_proposals')) {
      return rows(this.proposals as T[]);
    }
    if (compactSql === 'SELECT id, user_id, persona_id, name, status, start_at, end_at FROM nnz_node_events') {
      return rows(this.nodes as T[]);
    }
    if (compactSql === 'SELECT id, user_id, persona_id, node_id, role, content, created_at FROM nnz_conversation_messages') {
      return rows(this.conversations as T[]);
    }
    if (compactSql.startsWith('SELECT user_id, persona_id, state, soul_snapshot_id, node_id, node_name,')) {
      return rows(this.sessions as T[]);
    }
    if (compactSql === 'SELECT user_id, email, password_hash, created_at FROM nnz_credentials') {
      return rows(this.credentials as T[]);
    }
    if (compactSql.startsWith('WITH user_personas AS')) {
      const userId = String(params[0]);
      const counts = this.counts.get(userId) ?? {};
      return rows(Object.entries(counts).map(([table_name, count]) => ({
        table_name,
        count: String(count),
      })) as T[]);
    }
    if (compactSql === 'DELETE FROM nnz_users WHERE id = $1') {
      const userId = String(params[0]);
      this.deletedUserIds.push(userId);
      this.users = this.users.filter((user) => user.id !== userId);
      return rows([]);
    }
    if (compactSql.startsWith('INSERT INTO nnz_ops_audit_events')) {
      const [id, action, outcome, actor, targetUserIds, metadata, createdAt] = params;
      this.auditRows.push({
        id: String(id),
        action: action as OpsAuditAction,
        outcome: outcome as OpsAuditOutcome,
        actor: String(actor),
        target_user_ids: JSON.parse(String(targetUserIds)),
        metadata: JSON.parse(String(metadata)),
        created_at: new Date(new Date('2026-07-03T00:00:00.000Z').getTime() + this.auditRows.length),
      });
      return rows([]);
    }
    if (compactSql.startsWith('SELECT id, action, outcome, actor, target_user_ids, metadata, created_at FROM nnz_ops_audit_events')) {
      return rows([...this.auditRows].sort((left, right) => {
        const byDate = right.created_at.getTime() - left.created_at.getTime();
        return byDate || right.id.localeCompare(left.id);
      }) as T[]);
    }
    throw new Error(`Unexpected SQL: ${compactSql}`);
  }

  async end(): Promise<void> {
    return undefined;
  }
}

function rows<T>(rowsValue: T[]): { rows: T[] } {
  return { rows: rowsValue };
}
