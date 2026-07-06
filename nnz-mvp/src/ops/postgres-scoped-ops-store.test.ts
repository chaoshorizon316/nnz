import { describe, expect, it } from 'vitest';

import type { QueryablePool } from '../domain/postgres-scoped-soul-repository';
import type { OpsAuditAction, OpsAuditOutcome } from '../domain/types';
import { createPostgresScopedOpsStoreFromPool } from './postgres-scoped-ops-store';

describe('Postgres scoped Ops store', () => {
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
