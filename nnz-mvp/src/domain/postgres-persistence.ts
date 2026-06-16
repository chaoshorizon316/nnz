import pg from 'pg';

import type { InMemorySoulStore } from './soul-store';
import type { StoreSnapshot } from './persistence';

const { Pool } = pg;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS nnz_store_snapshots (
  id TEXT PRIMARY KEY,
  snapshot_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

const SNAPSHOT_ID = 'default';

interface QueryablePool {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  end(): Promise<void>;
}

export interface PostgresPersistence {
  mode: 'postgres';
  load(store: InMemorySoulStore): Promise<boolean>;
  save(store: InMemorySoulStore): Promise<void>;
  close(): Promise<void>;
}

export function createPostgresPersistence(
  connectionString: string,
  poolFactory: (connectionString: string) => QueryablePool = createPool,
): PostgresPersistence {
  const pool = poolFactory(connectionString);

  async function ensureSchema(): Promise<void> {
    await pool.query(SCHEMA);
  }

  return createPostgresPersistenceFromPool(pool, ensureSchema);
}

export function createPostgresPersistenceFromPool(
  pool: QueryablePool,
  ensureSchema: () => Promise<void> = async () => undefined,
): PostgresPersistence {
  return {
    mode: 'postgres',

    async load(store: InMemorySoulStore): Promise<boolean> {
      await ensureSchema();
      const result = await pool.query<{ snapshot_json: StoreSnapshot }>(
        'SELECT snapshot_json FROM nnz_store_snapshots WHERE id = $1',
        [SNAPSHOT_ID],
      );
      const row = result.rows[0];
      if (!row) return false;
      store.deserialize(normalizeSnapshot(row.snapshot_json));
      return true;
    },

    async save(store: InMemorySoulStore): Promise<void> {
      await ensureSchema();
      await pool.query(
        `INSERT INTO nnz_store_snapshots (id, snapshot_json, updated_at)
         VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (id)
         DO UPDATE SET snapshot_json = EXCLUDED.snapshot_json, updated_at = NOW()`,
        [SNAPSHOT_ID, JSON.stringify(store.serialize())],
      );
    },

    async close(): Promise<void> {
      await pool.end();
    },
  };
}

function createPool(connectionString: string): QueryablePool {
  return new Pool(
    shouldUseSsl(connectionString)
      ? { connectionString, ssl: { rejectUnauthorized: false } }
      : { connectionString },
  );
}

function shouldUseSsl(connectionString: string): boolean {
  if (connectionString.includes('sslmode=disable')) return false;
  return connectionString.startsWith('postgres://') || connectionString.startsWith('postgresql://');
}

function normalizeSnapshot(snapshot: StoreSnapshot): StoreSnapshot {
  return {
    users: snapshot.users.map((user) => ({ ...user, createdAt: new Date(user.createdAt) })),
    personas: snapshot.personas.map((persona) => ({ ...persona, createdAt: new Date(persona.createdAt) })),
    soulVersions: snapshot.soulVersions.map((version) => ({
      ...version,
      createdAt: new Date(version.createdAt),
      ...(version.knowledgeCutoff ? { knowledgeCutoff: new Date(version.knowledgeCutoff) } : {}),
    })),
    soulSnapshots: snapshot.soulSnapshots.map((item) => ({ ...item, sealedAt: new Date(item.sealedAt) })),
    memoryItems: snapshot.memoryItems.map((item) => ({ ...item, createdAt: new Date(item.createdAt) })),
    soulUpdateProposals: snapshot.soulUpdateProposals.map((proposal) => ({
      ...proposal,
      createdAt: new Date(proposal.createdAt),
    })),
    nodeEvents: snapshot.nodeEvents.map((node) => ({
      ...node,
      startAt: new Date(node.startAt),
      endAt: new Date(node.endAt),
    })),
    conversationMessages: snapshot.conversationMessages.map((message) => ({
      ...message,
      createdAt: new Date(message.createdAt),
    })),
    sessions: snapshot.sessions,
    credentials: snapshot.credentials,
    opsAuditEvents: (snapshot.opsAuditEvents ?? []).map((event) => ({
      ...event,
      createdAt: new Date(event.createdAt),
    })),
  };
}
